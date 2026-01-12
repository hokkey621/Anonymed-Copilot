use crate::domain::model::{AnonPlan, ReplacementEntry};
use tauri::{AppHandle, Emitter};
use crate::infrastructure::gemini_handler::GeminiHandler;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Clone)]
pub struct AgentProgressEvent {
    pub step: String, // "Planner", "Executor", "Reviewer"
    pub status: String, // "In Progress", "Completed", "Failed"
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug)]
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

#[allow(dead_code)]
#[derive(Deserialize)]
struct ReviewerOutput {
    approved: bool,
    feedback: String,
    refined_replacements: Option<Vec<ReplacementEntry>>,
}

pub struct AgentOrchestrator {
    handler: GeminiHandler,
}

impl AgentOrchestrator {
    pub fn new() -> Result<Self, String> {
        let handler = GeminiHandler::new()?;
        Ok(Self { handler })
    }

    /// Step 1: Planner Agent
    /// Decides HOW to anonymize based on user input (task_name) and the text content.
    pub async fn plan_strategy(&self, task_name: &str, text_preview: &str) -> Result<AnonymizationStrategy, String> {
        let system_prompt = r#"
        You are a Senior Privacy Architect. Your job is to design an Anonymization Strategy.
        Analyze the task name and the provided text preview.
        Determine:
        1. Context of the document (Medical, Legal, Educational, etc.)
        2. Strictness level.
        3. How to handle Dates (relative days vs masking).
        4. How to handle Names (pseudonyms vs tags).

        Return JSON matching this structure:
        {
            "task_context": "Refined context name",
            "focus_areas": ["Patient Names", "Hospital IDs", ...],
            "date_handling": "relative" | "mask" | "keep",
            "name_handling": "pseudonym" | "replace_tag" | "keep",
            "specific_instructions": "Additional custom rules..."
        }
        "#;

        let user_prompt = format!("Task: {}\n\nText Preview (first 1000 chars):\n{}", task_name, text_preview);

        self.handler.generate_structure::<AnonymizationStrategy>(
            &user_prompt,
            system_prompt,
            None
        ).await
    }

    /// Step 2: Executor Agent
    /// Generates the actual replacement list based on the Strategy.
    pub async fn execute_strategy(&self, strategy: &AnonymizationStrategy, full_text: &str) -> Result<Vec<ReplacementEntry>, String> {
        let system_prompt = format!(
            r#"
            You are an Expert Anonymization Executor.
            Follow this STRATEGY strictly:
            Context: {}
            Date Handling: {}
            Name Handling: {}
            Instructions: {}

            Task: Identify ALL strings that need replacement in the text.
            Return a JSON object with a 'replacements' array.
            Each replacement must have:
            - original: exact matching substring
            - replacement: the new string
            - start: start index (optional hint)
            - end: end index (optional hint)
            - reason: brief explanation
            - category: PER, LOC, DATE, ID, etc.

            Output format: {{ "replacements": [...] }}
            "#,
            strategy.task_context,
            strategy.date_handling,
            strategy.name_handling,
            strategy.specific_instructions
        );

        let output = self.handler.generate_structure::<ExecutorOutput>(
            "Please anonymize the following text:",
            &system_prompt,
            Some(full_text)
        ).await?;

        Ok(output.replacements)
    }

    /// Step 3: Reviewer Agent (Optional/Post-processing)
    /// Checks the plan for missed PII or over-redaction.
    /// For this version, we will just use it to validate/refine if needed, but to keep latency down we might skip unless requested.
    /// Let's implement a simple "Self-Correction" pass if the plan seems empty or too aggressive, but for now we'll skip to keep it simple.

    /// Main Orchestratration Function
    pub async fn run_anonymization_pipeline(&self, app: &AppHandle, text: &str, user_task_input: &str) -> Result<AnonPlan, String> {
        // 1. Plan
        let _ = app.emit("agent-progress", AgentProgressEvent {
            step: "Planner".to_string(),
            status: "In Progress".to_string(),
            message: "Analyzing context and designing strategy...".to_string(),
        });

        let preview = if text.len() > 1000 { &text[0..1000] } else { text };
        let strategy = self.plan_strategy(user_task_input, preview).await;

        let strategy = match strategy {
            Ok(s) => {
                 let _ = app.emit("agent-progress", AgentProgressEvent {
                    step: "Planner".to_string(),
                    status: "Completed".to_string(),
                    message: format!("Strategy defined: {} ({})", s.task_context, s.focus_areas.len()),
                });
                s
            },
            Err(e) => {
                 let _ = app.emit("agent-progress", AgentProgressEvent {
                    step: "Planner".to_string(),
                    status: "Failed".to_string(),
                    message: format!("Planning failed: {}", e),
                });
                return Err(e);
            }
        };

        // 2. Execute
        let _ = app.emit("agent-progress", AgentProgressEvent {
            step: "Executor".to_string(),
            status: "In Progress".to_string(),
            message: "Applying anonymization rules...".to_string(),
        });

        let replacements = self.execute_strategy(&strategy, text).await;

        let replacements = match replacements {
             Ok(r) => {
                 let _ = app.emit("agent-progress", AgentProgressEvent {
                    step: "Executor".to_string(),
                    status: "Completed".to_string(),
                    message: format!("Generated {} replacements.", r.len()),
                });
                r
             },
             Err(e) => {
                 let _ = app.emit("agent-progress", AgentProgressEvent {
                    step: "Executor".to_string(),
                    status: "Failed".to_string(),
                    message: format!("Execution failed: {}", e),
                });
                return Err(e);
             }
        };

        // 3. Assemble Result
        Ok(AnonPlan {
            task_name: strategy.task_context,
            global_rules: HashMap::new(),
            replacements,
            status: "draft".to_string(),
        })
    }
}
