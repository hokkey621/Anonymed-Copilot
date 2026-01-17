use crate::domain::model::AnonPlan;
use crate::infrastructure::gemini_handler::GeminiHandler;
use crate::domain::agent_orchestrator::AgentOrchestrator;
use crate::utils::plan_apply::apply_plan_to_text;
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
    let processed = apply_plan_to_text(&text, &plan, true)?;
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

    handler.chat(history, None).await
}

use crate::domain::model::{BulkExecutionPlan, WorkflowStep};
use serde::Serialize;

/// Response from agent chat that may include bulk execution plan
#[derive(Serialize)]
pub struct AgentChatResponse {
    pub message: String,
    pub bulk_plan: Option<BulkExecutionPlan>,
    pub workflow_steps: Option<Vec<WorkflowStep>>,
    pub suggestions: Option<Vec<String>>,
}

/// Check if the user message indicates bulk execution intent
fn detect_bulk_intent(messages: &[ChatMessage]) -> bool {
    use crate::prompts::BULK_KEYWORDS;

    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        let lower_content = last_user_msg.content.to_lowercase();
        return BULK_KEYWORDS.iter().any(|kw| lower_content.contains(kw));
    }
    false
}

/// Check if the user has expressed anonymization purpose
fn detect_purpose_intent(messages: &[ChatMessage]) -> bool {
    use crate::prompts::PURPOSE_KEYWORDS;

    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        let content = &last_user_msg.content;
        return PURPOSE_KEYWORDS.iter().any(|kw| content.contains(kw));
    }
    false
}

/// Generate contextual suggestions based on conversation state
fn generate_contextual_suggestions(messages: &[ChatMessage], is_bulk_request: bool, has_purpose: bool) -> Option<Vec<String>> {
    use crate::prompts;

    // Count user messages to determine conversation phase
    let user_msg_count = messages.iter().filter(|m| m.role == "user").count();

    // Initial state - no user messages yet or first interaction
    if user_msg_count == 0 {
        return Some(prompts::initial_suggestions());
    }

    // Check if user is asking about usage
    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        let content = &last_user_msg.content;

        // Usage questions - provide help suggestions
        if content.contains("使い方") || content.contains("ヘルプ") || content.contains("help") {
            return Some(prompts::help_suggestions());
        }

        // Bulk request acknowledged - provide execution options
        if is_bulk_request {
            return Some(prompts::bulk_options());
        }

        // Purpose expressed - ask to create plan
        if has_purpose {
            return Some(prompts::create_plan_options());
        }

        // Anonymization intent expressed - ask for purpose
        if content.contains("匿名化") && !content.contains("用") {
            return Some(prompts::anonymization_purpose_options());
        }
    }

    // Default suggestions for continuing conversation
    Some(prompts::default_suggestions())
}

/// Enhanced agent chat that supports bulk execution planning
#[tauri::command]
pub async fn agent_chat(
    messages: Vec<ChatMessage>,
    file_count: usize,
    editor_content: Option<String>,
) -> Result<AgentChatResponse, String> {
    let handler = GeminiHandler::new()?;

    let is_bulk_request = detect_bulk_intent(&messages);

    // Generate system prompt using the centralized prompts module
    use crate::prompts;

    let base_prompt = if is_bulk_request {
        prompts::bulk_execution_prompt(file_count)
    } else {
        prompts::AGENT_BASE_PROMPT.to_string()
    };

    let system_context = if let Some(content) = editor_content.filter(|c| !c.is_empty()) {
        prompts::with_editor_context(&base_prompt, &content)
    } else {
        base_prompt
    };

    // Create history (no need to manually inject system prompt anymore)
    let history: Vec<Content> = messages.iter().map(|m| Content {
        role: if m.role == "assistant" { "model".to_string() } else { "user".to_string() },
        parts: vec![Part { text: m.content.clone() }],
    }).collect();

    let ai_response = handler.chat(history, Some(system_context.as_str())).await?;

    // Check if user has expressed anonymization purpose
    let has_purpose = detect_purpose_intent(&messages);

    // Generate execution plan when user requests bulk execution OR has expressed purpose
    let (bulk_plan, workflow_steps) = if is_bulk_request || has_purpose {
        let effective_count = if file_count > 0 { file_count } else { 1 };
        let estimated_time = (effective_count as u64) * 50;

        let plan = BulkExecutionPlan {
            target_count: effective_count,
            estimated_time_ms: estimated_time,
            policy_summary: prompts::default_policy_summary(),
        };

        let steps = prompts::default_workflow_steps(effective_count > 1);

        (Some(plan), Some(steps))
    } else {
        (None, None)
    };

    // Generate contextual suggestions based on conversation state
    let suggestions = generate_contextual_suggestions(&messages, is_bulk_request, has_purpose);

    Ok(AgentChatResponse {
        message: ai_response,
        bulk_plan,
        workflow_steps,
        suggestions,
    })
}

/// Streaming version of agent chat - emits chat-stream events
#[tauri::command]
pub async fn agent_chat_streaming(
    app: tauri::AppHandle,
    messages: Vec<ChatMessage>,
    file_count: usize,
    editor_content: Option<String>,
) -> Result<AgentChatResponse, String> {
    let handler = GeminiHandler::new()?;

    let is_bulk_request = detect_bulk_intent(&messages);
    let has_purpose = detect_purpose_intent(&messages);

    // Generate system prompt using the centralized prompts module
    use crate::prompts;

    let base_prompt = if is_bulk_request {
        prompts::bulk_execution_prompt(file_count)
    } else {
        prompts::AGENT_BASE_PROMPT.to_string()
    };

    let system_context = if let Some(content) = editor_content.filter(|c| !c.is_empty()) {
        prompts::with_editor_context(&base_prompt, &content)
    } else {
        base_prompt
    };

    // Create history (no need to manually inject system prompt anymore)
    let history: Vec<Content> = messages.iter().map(|m| Content {
        role: if m.role == "assistant" { "model".to_string() } else { "user".to_string() },
        parts: vec![Part { text: m.content.clone() }],
    }).collect();

    // Emit: Analyzing phase
    use tauri::Emitter;
    let _ = app.emit("thinking-phase", serde_json::json!({
        "phase": "analyzing",
        "message": "テキストを分析中..."
    }));

    // Use streaming chat
    // Use streaming chat with system instruction
    let ai_response = handler.chat_streaming(history, Some(system_context.as_str()), &app).await?;

    // Emit: Complete phase
    let _ = app.emit("thinking-phase", serde_json::json!({
        "phase": "complete",
        "message": "完了"
    }));

    // Generate execution plan when needed
    let (bulk_plan, workflow_steps) = if is_bulk_request || has_purpose {
        let effective_count = if file_count > 0 { file_count } else { 1 };
        let estimated_time = (effective_count as u64) * 50;

        let plan = BulkExecutionPlan {
            target_count: effective_count,
            estimated_time_ms: estimated_time,
            policy_summary: prompts::default_policy_summary(),
        };

        let steps = prompts::default_workflow_steps(effective_count > 1);

        (Some(plan), Some(steps))
    } else {
        (None, None)
    };

    let suggestions = generate_contextual_suggestions(&messages, is_bulk_request, has_purpose);

    Ok(AgentChatResponse {
        message: ai_response,
        bulk_plan,
        workflow_steps,
        suggestions,
    })
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
