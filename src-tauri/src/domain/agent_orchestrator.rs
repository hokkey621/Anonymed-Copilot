use crate::domain::model::{AnonPlan, ReplacementEntry};
use crate::domain::skills::{build_prompt_with_skills, find_matching_skills, get_skill_names};
use crate::infrastructure::llm::{LlmClient, ModelProvider};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
    fn normalize_category(raw: Option<&str>) -> Option<String> {
        let normalized = raw
            .map(|v| v.trim().to_ascii_uppercase())
            .filter(|v| !v.is_empty())?;

        let category = match normalized.as_str() {
            "P_NAME" | "PATIENT_NAME" | "PATIENT" | "PER" | "PERSON" => "P_NAME",
            "S_NAME" | "STAFF_NAME" | "DOCTOR_NAME" | "FAMILY_NAME" => "S_NAME",
            "HOSP" | "HOSPITAL" | "ORG" | "ORGANIZATION" => "HOSP",
            "LOC" | "LOCATION" | "ADDRESS" | "ADDR" => "LOC",
            "DATE" | "DATETIME" | "TIME" => "DATE",
            "AGE" => "AGE",
            _ => return Some(normalized),
        };
        Some(category.to_string())
    }

    fn is_symbolic_placeholder(value: &str) -> bool {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
            return false;
        }
        if !trimmed.chars().any(|c| c.is_ascii_alphabetic()) {
            return false;
        }
        trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '<' | '>' | ':' | '/'))
    }

    fn canonical_label(category: Option<&str>, index: usize) -> String {
        let base = match category {
            Some("P_NAME") => "P_NAME",
            Some("S_NAME") => "S_NAME",
            Some("HOSP") => "HOSP",
            Some("LOC") => "LOC",
            Some("DATE") => "DATE",
            Some("AGE") => "AGE",
            Some(other) => other,
            None => "ENTITY",
        };
        format!("{}_{:03}", base, index)
    }

    fn allow_non_mask_replacement(category: Option<&str>, instructions: &str) -> bool {
        let lower = instructions.to_lowercase();
        let has_user_or_skill_override = lower.contains("user_locked_policy")
            || lower.contains("skill")
            || lower.contains("特記事項")
            || lower.contains("置換");

        if !has_user_or_skill_override {
            return false;
        }

        match category.unwrap_or("OTHER") {
            "AGE" => {
                lower.contains("10歳刻み")
                    || lower.contains("5歳刻み")
                    || lower.contains("年代")
                    || lower.contains("年齢") && lower.contains("一般化")
            }
            "DATE" => {
                lower.contains("相対")
                    || lower.contains("day ")
                    || lower.contains("visit")
                    || lower.contains("年月")
                    || lower.contains("年のみ")
            }
            "P_NAME" | "S_NAME" => {
                lower.contains("subject-")
                    || lower.contains("仮名")
                    || lower.contains("replace_tag")
                    || lower.contains("pseudonym")
                    || lower.contains("タグ")
            }
            "LOC" | "HOSP" => {
                lower.contains("都道府県")
                    || lower.contains("地方")
                    || lower.contains("施設a")
                    || lower.contains("施設b")
                    || lower.contains("一般化")
            }
            "ID" | "PHONE" | "EMAIL" => {
                lower.contains("トークン")
                    || lower.contains("ハッシュ")
                    || lower.contains("末尾")
            }
            _ => false,
        }
    }

    fn has_birth_year_only_override(instructions: &str) -> bool {
        let lower = instructions.to_lowercase();
        (lower.contains("生年月日") || lower.contains("dob") || lower.contains("birth"))
            && (lower.contains("年のみ")
                || lower.contains("年だけ")
                || lower.contains("年のみ保持")
                || lower.contains("年生"))
    }

    fn is_birthdate_context(full_text: &str, start: usize, end: usize, original: &str) -> bool {
        if start > full_text.len() || end > full_text.len() || start > end {
            return false;
        }
        let before = full_text[..start]
            .chars()
            .rev()
            .take(16)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>();
        let after = full_text[end..].chars().take(16).collect::<String>();
        let window = format!("{}{}{}", before, original, after).to_lowercase();
        window.contains("生年月日")
            || window.contains("生年")
            || window.contains("dob")
            || window.contains("birth")
    }

    fn extract_four_digit_year(value: &str) -> Option<String> {
        let chars: Vec<char> = value.chars().collect();
        for i in 0..chars.len().saturating_sub(3) {
            let slice = &chars[i..i + 4];
            if slice.iter().all(|c| c.is_ascii_digit()) {
                let year_str: String = slice.iter().collect();
                if let Ok(year) = year_str.parse::<u32>() {
                    if (1800..=2100).contains(&year) {
                        return Some(year.to_string());
                    }
                }
            }
        }
        None
    }

    pub fn new(app: &tauri::AppHandle, provider: ModelProvider) -> Result<Self, String> {
        let handler = LlmClient::from_app(app, provider)?;
        Ok(Self { handler })
    }

    fn extract_user_locked_policy(task_input: &str) -> Vec<String> {
        let start_tag = "[USER_LOCKED_POLICY]";
        let end_tag = "[/USER_LOCKED_POLICY]";
        let Some(start) = task_input.find(start_tag) else {
            return Vec::new();
        };
        let Some(end) = task_input.find(end_tag) else {
            return Vec::new();
        };
        if end <= start {
            return Vec::new();
        }
        let body = &task_input[start + start_tag.len()..end];
        body.lines()
            .map(|line| line.trim().trim_start_matches("- ").trim().to_string())
            .filter(|line| !line.is_empty())
            .collect()
    }

    fn strip_user_locked_policy(task_input: &str) -> String {
        let start_tag = "[USER_LOCKED_POLICY]";
        let end_tag = "[/USER_LOCKED_POLICY]";
        if let (Some(start), Some(_end)) = (task_input.find(start_tag), task_input.find(end_tag)) {
            let mut base = task_input[..start].trim().to_string();
            if base.is_empty() {
                base = "Medical Case Study".to_string();
            }
            return base;
        }
        task_input.trim().to_string()
    }

    fn local_fast_strategy(task_name: &str) -> AnonymizationStrategy {
        let locked_policy = Self::extract_user_locked_policy(task_name);
        let base_task = Self::strip_user_locked_policy(task_name);
        let specific_instructions = if locked_policy.is_empty() {
            "Preserve medical meaning while anonymizing personal information. Default replacement is **** for all PHI unless explicitly overridden by skill or user request.".to_string()
        } else {
            format!(
                "Preserve medical meaning while anonymizing personal information. \
Follow USER_LOCKED_POLICY strictly and do not change unspecified rules. \
Default replacement is **** for all PHI unless USER_LOCKED_POLICY explicitly overrides a category.\n{}",
                locked_policy
                    .iter()
                    .map(|line| format!("- {}", line))
                    .collect::<Vec<String>>()
                    .join("\n")
            )
        };

        AnonymizationStrategy {
            task_context: if base_task.trim().is_empty() {
                "Medical Case Study".to_string()
            } else {
                base_task
            },
            focus_areas: vec![
                "Patient Names".to_string(),
                "Dates".to_string(),
                "Identifiers".to_string(),
            ],
            date_handling: "relative".to_string(),
            name_handling: "replace_tag".to_string(),
            specific_instructions,
        }
    }

    pub fn is_local_gemma(&self) -> bool {
        self.handler.provider() == ModelProvider::LocalGemma
    }

    pub async fn plan_strategy_without_text(
        &self,
        task_name: &str,
        _matching_skills: &[&crate::domain::skills::LoadedSkill],
    ) -> Result<AnonymizationStrategy, String> {
        // Unified strategy path for all providers to keep behavior consistent.
        Ok(Self::local_fast_strategy(task_name))
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

        let mut indexed = output
            .replacements
            .into_iter()
            .filter_map(|r| {
                if r.original.trim().is_empty() || r.replacement.trim().is_empty() {
                    return None;
                }
                let start = full_text.find(&r.original)?;
                let end = start + r.original.len();
                Some((
                    start,
                    end,
                    r.original,
                    r.replacement,
                    Self::normalize_category(r.category.as_deref()),
                ))
            })
            .collect::<Vec<_>>();

        indexed.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then_with(|| b.2.len().cmp(&a.2.len()))
                .then_with(|| a.2.cmp(&b.2))
        });

        let mut category_counters: HashMap<String, usize> = HashMap::new();
        let mut canonical_by_key: HashMap<(String, String), String> = HashMap::new();
        let mut dedupe: HashSet<(usize, String, String)> = HashSet::new();
        let mut mapped = Vec::new();

        for (start, end, original, replacement, category) in indexed {
            let allow_non_mask =
                Self::allow_non_mask_replacement(category.as_deref(), &strategy.specific_instructions);
            let force_birth_year = category.as_deref() == Some("DATE")
                && allow_non_mask
                && Self::has_birth_year_only_override(&strategy.specific_instructions)
                && Self::is_birthdate_context(full_text, start, end, &original);

            let normalized_replacement = if force_birth_year {
                if let Some(year) = Self::extract_four_digit_year(&original) {
                    format!("{}年生", year)
                } else if replacement.trim().is_empty() {
                    "****".to_string()
                } else {
                    replacement
                }
            } else if Self::is_symbolic_placeholder(&replacement) {
                if !allow_non_mask {
                    "****".to_string()
                } else {
                    let category_key = category.clone().unwrap_or_else(|| "ENTITY".to_string());
                    let map_key = (category_key.clone(), original.clone());
                    if let Some(existing) = canonical_by_key.get(&map_key) {
                        existing.clone()
                    } else {
                        let next = category_counters.entry(category_key).or_insert(0);
                        *next += 1;
                        let label = Self::canonical_label(category.as_deref(), *next);
                        canonical_by_key.insert(map_key, label.clone());
                        label
                    }
                }
            } else if !allow_non_mask {
                "****".to_string()
            } else {
                replacement
            };

            if !dedupe.insert((start, original.clone(), normalized_replacement.clone())) {
                continue;
            }

            mapped.push(ReplacementEntry {
                original,
                replacement: normalized_replacement,
                start,
                end,
                reason: "PII".to_string(),
                category,
            });
        }

        Ok(mapped)
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

        // 1. Plan (unified strategy path for consistent output across providers)
        let _ = app.emit(
            "agent-progress",
            AgentProgressEvent {
                step: "Planner".to_string(),
                status: "Completed".to_string(),
                message: "Unified strategy mode: planner step skipped".to_string(),
            },
        );
        let strategy = Self::local_fast_strategy(user_task_input);

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
