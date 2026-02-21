use crate::domain::model::{AnonPlan, ReplacementEntry};
use crate::domain::skills::{build_prompt_with_skills, find_matching_skills, get_skill_names};
use crate::infrastructure::llm::{LlmClient, ModelProvider};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct AgentProgressEvent {
    pub step: String,   // "Planner", "Executor", "Reviewer"
    pub status: String, // "In Progress", "Completed", "Failed"
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AnonymizationStrategy {
    pub task_context: String,
    pub focus_areas: Vec<String>,
    pub date_handling: String, // "relative", "mask", "keep"
    pub name_handling: String, // "pseudonym", "replace_tag", "keep"
    pub specific_instructions: String,
}

#[derive(Deserialize)]
struct ExecutorOutput {
    replacements: Vec<ReplacementEntry>,
}

#[derive(Deserialize)]
struct LocalFastReplacementEntry {
    original: String,
    replacement: String,
    #[serde(default)]
    category: Option<String>,
}

#[derive(Deserialize)]
struct LocalFastExecutorOutput {
    replacements: Vec<LocalFastReplacementEntry>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct ReviewerOutput {
    approved: bool,
    feedback: String,
    refined_replacements: Option<Vec<ReplacementEntry>>,
}

pub struct AgentOrchestrator {
    handler: LlmClient,
}

impl AgentOrchestrator {
    pub fn new(app: &tauri::AppHandle, provider: ModelProvider) -> Result<Self, String> {
        let handler = LlmClient::from_app(app, provider)?;
        Ok(Self { handler })
    }

    fn local_fast_strategy(task_name: &str) -> AnonymizationStrategy {
        AnonymizationStrategy {
            task_context: if task_name.trim().is_empty() {
                "Medical Case Study".to_string()
            } else {
                task_name.to_string()
            },
            focus_areas: vec![
                "Patient Names".to_string(),
                "Dates".to_string(),
                "Identifiers".to_string(),
            ],
            date_handling: "relative".to_string(),
            name_handling: "replace_tag".to_string(),
            specific_instructions:
                "Preserve medical meaning while anonymizing personal information.".to_string(),
        }
    }

    pub fn is_local_gemma(&self) -> bool {
        self.handler.provider() == ModelProvider::LocalGemma
    }

    pub async fn plan_strategy_without_text(
        &self,
        task_name: &str,
        matching_skills: &[&crate::domain::skills::LoadedSkill],
    ) -> Result<AnonymizationStrategy, String> {
        if self.is_local_gemma() {
            return Ok(Self::local_fast_strategy(task_name));
        }
        self.plan_strategy(task_name, "", matching_skills).await
    }

    /// Step 1: Planner Agent
    /// Decides HOW to anonymize based on user input (task_name) and the text content.
    /// Enhanced with skill-based domain knowledge injection.
    pub async fn plan_strategy(
        &self,
        task_name: &str,
        text_preview: &str,
        matching_skills: &[&crate::domain::skills::LoadedSkill],
    ) -> Result<AnonymizationStrategy, String> {
        let base_prompt = crate::prompts::strategy_planner_prompt();

        // Inject skill-based domain knowledge into the prompt
        let system_prompt = build_prompt_with_skills(base_prompt, matching_skills);

        let user_prompt = format!(
            "Task: {}\n\nText Preview (first 1000 chars):\n{}",
            task_name, text_preview
        );

        self.handler
            .generate_structure::<AnonymizationStrategy>(&user_prompt, &system_prompt, None)
            .await
    }

    /// Step 2: Executor Agent
    /// Generates the actual replacement list based on the Strategy.
    pub async fn execute_strategy(
        &self,
        strategy: &AnonymizationStrategy,
        full_text: &str,
    ) -> Result<Vec<ReplacementEntry>, String> {
        if self.is_local_gemma() {
            let system_prompt = crate::prompts::strategy_executor_local_fast_prompt(
                strategy.task_context.as_str(),
                strategy.date_handling.as_str(),
                strategy.name_handling.as_str(),
                strategy.specific_instructions.as_str(),
            );

            let output = self
                .handler
                .generate_structure::<LocalFastExecutorOutput>(
                    "Extract PHI replacements for anonymization.",
                    &system_prompt,
                    Some(full_text),
                )
                .await?;

            let mut dedupe = std::collections::HashSet::<(String, String)>::new();
            let mapped = output
                .replacements
                .into_iter()
                .filter(|r| !r.original.trim().is_empty() && !r.replacement.trim().is_empty())
                .filter(|r| dedupe.insert((r.original.clone(), r.replacement.clone())))
                .map(|r| ReplacementEntry {
                    original: r.original,
                    replacement: r.replacement,
                    start: 0,
                    end: 0,
                    reason: "PII".to_string(),
                    category: r.category,
                })
                .collect::<Vec<_>>();

            return Ok(mapped);
        }

        let system_prompt = crate::prompts::strategy_executor_prompt(
            strategy.task_context.as_str(),
            strategy.date_handling.as_str(),
            strategy.name_handling.as_str(),
            strategy.specific_instructions.as_str(),
        );

        let output = self
            .handler
            .generate_structure::<ExecutorOutput>(
                "Please anonymize the following text:",
                &system_prompt,
                Some(full_text),
            )
            .await?;

        Ok(output.replacements)
    }

    /// Step 3: Reviewer Agent (Optional/Post-processing)
    /// Checks the plan for missed PII or over-redaction.
    /// For this version, we will just use it to validate/refine if needed, but to keep latency down we might skip unless requested.
    /// Let's implement a simple "Self-Correction" pass if the plan seems empty or too aggressive, but for now we'll skip to keep it simple.

    /// Main Orchestration Function
    /// Enhanced with skill-based domain knowledge injection
    pub async fn run_anonymization_pipeline(
        &self,
        app: &AppHandle,
        text: &str,
        user_task_input: &str,
    ) -> Result<AnonPlan, String> {
        // 0. Find matching skills based on user input
        let matching_skills = find_matching_skills(user_task_input);
        let skill_names = get_skill_names(&matching_skills);

        if !matching_skills.is_empty() {
            let _ = app.emit(
                "agent-progress",
                AgentProgressEvent {
                    step: "Skills".to_string(),
                    status: "Completed".to_string(),
                    message: format!("Matched skills: {}", skill_names.join(", ")),
                },
            );
        }

        let use_local_fast_path = self.is_local_gemma();

        // 1. Plan (with skill context)
        let strategy = if use_local_fast_path {
            let _ = app.emit(
                "agent-progress",
                AgentProgressEvent {
                    step: "Planner".to_string(),
                    status: "Completed".to_string(),
                    message: "Local Gemma fast mode: planner step skipped".to_string(),
                },
            );

            Self::local_fast_strategy(user_task_input)
        } else {
            let _ = app.emit(
                "agent-progress",
                AgentProgressEvent {
                    step: "Planner".to_string(),
                    status: "In Progress".to_string(),
                    message: "Analyzing context and designing strategy...".to_string(),
                },
            );

            let preview = text.chars().take(1000).collect::<String>();
            let strategy = self
                .plan_strategy(user_task_input, &preview, &matching_skills)
                .await;

            match strategy {
                Ok(s) => {
                    let _ = app.emit(
                        "agent-progress",
                        AgentProgressEvent {
                            step: "Planner".to_string(),
                            status: "Completed".to_string(),
                            message: format!(
                                "Strategy defined: {} ({})",
                                s.task_context,
                                s.focus_areas.len()
                            ),
                        },
                    );
                    s
                }
                Err(e) => {
                    let _ = app.emit(
                        "agent-progress",
                        AgentProgressEvent {
                            step: "Planner".to_string(),
                            status: "Failed".to_string(),
                            message: format!("Planning failed: {}", e),
                        },
                    );
                    return Err(e);
                }
            }
        };

        // 2. Execute
        let _ = app.emit(
            "agent-progress",
            AgentProgressEvent {
                step: "Executor".to_string(),
                status: "In Progress".to_string(),
                message: "Applying anonymization rules...".to_string(),
            },
        );

        let replacements = self.execute_strategy(&strategy, text).await;

        let replacements = match replacements {
            Ok(r) => {
                let _ = app.emit(
                    "agent-progress",
                    AgentProgressEvent {
                        step: "Executor".to_string(),
                        status: "Completed".to_string(),
                        message: format!("Generated {} replacements.", r.len()),
                    },
                );
                r
            }
            Err(e) => {
                let _ = app.emit(
                    "agent-progress",
                    AgentProgressEvent {
                        step: "Executor".to_string(),
                        status: "Failed".to_string(),
                        message: format!("Execution failed: {}", e),
                    },
                );
                return Err(e);
            }
        };

        // 3. Assemble Result (with applied skills)
        Ok(AnonPlan {
            task_name: strategy.task_context,
            global_rules: HashMap::new(),
            replacements,
            status: "draft".to_string(),
            applied_skills: skill_names,
        })
    }
}
