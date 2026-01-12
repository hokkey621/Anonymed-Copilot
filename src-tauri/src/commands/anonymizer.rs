use crate::domain::model::AnonPlan;
use crate::infrastructure::gemini_handler::GeminiHandler;
use crate::domain::agent_orchestrator::AgentOrchestrator;
use zeroize::Zeroize;

/// Analyze text and generate an anonymization plan using Multi-Agent Orchestrator
#[tauri::command]
pub async fn analyze_text(app: tauri::AppHandle, text: String, task_context: String) -> Result<AnonPlan, String> {
    let orchestrator = AgentOrchestrator::new()?;
    // The user's input "task_context" here is effectively the prompt for the Planner (e.g. "Vaccine Study")
    let plan = orchestrator.run_anonymization_pipeline(&app, &text, &task_context).await?;
    Ok(plan)
}

/// Apply the anonymization plan to the text
#[tauri::command]
pub fn apply_plan(mut text: String, plan: AnonPlan) -> Result<String, String> {
    let mut replacements = plan.replacements.clone();
    replacements.sort_by(|a, b| b.start.cmp(&a.start));

    let mut processed = text.clone();

    for item in replacements {
        let suggested_start = item.start;
        let original_target = &item.original;

        if processed.get(suggested_start..suggested_start + original_target.len()) == Some(original_target) {
            processed.replace_range(suggested_start..suggested_start + original_target.len(), &item.replacement);
        } else {
            // Fallback: fuzzy search
            let mut best_start = None;
            let mut min_distance = usize::MAX;

            for (found_idx, _) in processed.match_indices(original_target) {
                let distance = (found_idx as isize - suggested_start as isize).unsigned_abs();
                if distance < min_distance {
                    min_distance = distance;
                    best_start = Some(found_idx);
                }
            }

            let actual_start = match best_start {
                Some(idx) => idx,
                None => return Err(format!("Could not find original text '{}' in document.", original_target)),
            };
            processed.replace_range(actual_start..actual_start + original_target.len(), &item.replacement);
        }
    }

    unsafe { text.as_mut_vec().zeroize(); }
    Ok(processed)
}

#[derive(serde::Deserialize)]
pub struct ChatMessage {
    role: String,
    content: String,
}

use crate::infrastructure::gemini_handler::{Content, Part};

/// Conversational chat with AI (supports history)
#[tauri::command]
pub async fn chat_with_ai(messages: Vec<ChatMessage>) -> Result<String, String> {
    let handler = GeminiHandler::new()?;

    let history: Vec<Content> = messages.into_iter().map(|m| Content {
        role: if m.role == "assistant" { "model".to_string() } else { "user".to_string() },
        parts: vec![Part { text: m.content }],
    }).collect();

    handler.chat(history).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::model::{AnonPlan, ReplacementEntry};
    use std::collections::HashMap;

    #[test]
    fn test_apply_plan_index_invariance() {
        let original_text = "Patient John Doe visited Site A on 2023-01-01.".to_string();

        let replacements = vec![
            ReplacementEntry {
                original: "John Doe".to_string(),
                replacement: "**NAME**".to_string(),
                start: 8,
                end: 16,
                reason: "Name".to_string(),
                category: Some("PER".to_string()),
            },
            ReplacementEntry {
                original: "2023-01-01".to_string(),
                replacement: "Day 0".to_string(),
                start: 35,
                end: 45,
                reason: "Date".to_string(),
                category: Some("DATE".to_string()),
            },
        ];

        let plan = AnonPlan {
            task_name: "test".to_string(),
            global_rules: HashMap::new(),
            replacements,
            status: "draft".to_string(),
        };

        let result = apply_plan(original_text, plan).unwrap();
        assert_eq!(result, "Patient **NAME** visited Site A on Day 0.");
    }
}
