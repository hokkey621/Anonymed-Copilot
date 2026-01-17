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

    handler.chat(history).await
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
    let bulk_keywords = [
        "全件", "全て", "すべて", "一括", "バルク", "まとめて",
        "apply to all", "bulk", "all files", "batch"
    ];

    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        let lower_content = last_user_msg.content.to_lowercase();
        return bulk_keywords.iter().any(|kw| lower_content.contains(kw));
    }
    false
}

/// Check if the user has expressed anonymization purpose
fn detect_purpose_intent(messages: &[ChatMessage]) -> bool {
    let purpose_keywords = [
        "ワクチン", "教材", "教育", "症例報告", "研究", "開発用", "作成用",
        "学会", "論文", "公開", "データ分析", "計画を立てて", "実行して"
    ];

    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        let content = &last_user_msg.content;
        return purpose_keywords.iter().any(|kw| content.contains(kw));
    }
    false
}

/// Generate contextual suggestions based on conversation state
fn generate_contextual_suggestions(messages: &[ChatMessage], is_bulk_request: bool, has_purpose: bool) -> Option<Vec<String>> {
    // Count user messages to determine conversation phase
    let user_msg_count = messages.iter().filter(|m| m.role == "user").count();

    // Initial state - no user messages yet or first interaction
    if user_msg_count == 0 {
        return Some(vec![
            "匿名化したい".to_string(),
            "使い方が知りたい".to_string(),
        ]);
    }

    // Check if user is asking about usage
    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        let content = &last_user_msg.content;

        // Usage questions - provide help suggestions
        if content.contains("使い方") || content.contains("ヘルプ") || content.contains("help") {
            return Some(vec![
                "ファイルを開きたい".to_string(),
                "匿名化を開始".to_string(),
            ]);
        }

        // Bulk request acknowledged - provide execution options
        if is_bulk_request {
            return Some(vec![
                "実行して".to_string(),
                "キャンセル".to_string(),
            ]);
        }

        // Purpose expressed - ask to create plan
        if has_purpose {
            return Some(vec![
                "計画を立てて".to_string(),
                "もう少し詳しく".to_string(),
            ]);
        }

        // Anonymization intent expressed - ask for purpose
        if content.contains("匿名化") && !content.contains("用") {
            return Some(vec![
                "ワクチン開発用".to_string(),
                "教材作成用".to_string(),
                "症例報告用".to_string(),
            ]);
        }
    }

    // Default suggestions for continuing conversation
    Some(vec![
        "計画を立てて".to_string(),
        "詳しく教えて".to_string(),
    ])
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

    // Build editor context if content is provided (simplified - no JSON format request)
    let editor_context = editor_content
        .filter(|c| !c.is_empty())
        .map(|c| format!(
            r#"

【現在エディタに表示されているテキスト】
```
{}
```

上記のテキストに含まれる個人情報の種類と対応策を簡潔に説明してください。"#,
            c
        ))
        .unwrap_or_default();

    // Enhanced system prompt for bulk execution
    let system_context = if is_bulk_request {
        format!(
            r#"あなたは医療データ匿名化の専門エージェントです。ユーザーは{}件のファイルの一括処理を希望しています。

【重要】回答は3文以内で簡潔に。長い説明は不要です。

例: 「{}件のファイルを検証後、並列処理します。元データは変更せずanonymized_outputsに出力します。」{}
"#,
            file_count, file_count, editor_context
        )
    } else {
        format!(
            "あなたは医療データ匿名化の専門エージェントです。【重要】回答は2-3文以内で簡潔に。{}",
            editor_context
        )
    };


    // Prepend system context to first user message
    let mut history: Vec<Content> = messages.iter().map(|m| Content {
        role: if m.role == "assistant" { "model".to_string() } else { "user".to_string() },
        parts: vec![Part { text: m.content.clone() }],
    }).collect();

    if !history.is_empty() {
        if let Some(first) = history.first_mut() {
            first.parts[0].text = format!("[System]: {}\n\n{}", system_context, first.parts[0].text);
        }
    }

    let ai_response = handler.chat(history).await?;

    // Check if user has expressed anonymization purpose
    let has_purpose = detect_purpose_intent(&messages);

    // Generate execution plan when user requests bulk execution OR has expressed purpose
    let (bulk_plan, workflow_steps) = if is_bulk_request || has_purpose {
        let effective_count = if file_count > 0 { file_count } else { 1 };
        let estimated_time = (effective_count as u64) * 50;

        let plan = BulkExecutionPlan {
            target_count: effective_count,
            estimated_time_ms: estimated_time,
            policy_summary: vec![
                "氏名 → 削除".to_string(),
                "年齢 → 5歳刻み".to_string(),
                "日付 → 月単位".to_string(),
                "住所 → 都道府県のみ".to_string(),
                "病名 → 一般化".to_string(),
            ],
        };

        let steps = vec![
            WorkflowStep {
                id: "validation".to_string(),
                label: "Validation (Dry Run)".to_string(),
                status: "pending".to_string(),
            },
            WorkflowStep {
                id: "execution".to_string(),
                label: if effective_count > 1 { "Parallel Execution".to_string() } else { "Execution".to_string() },
                status: "pending".to_string(),
            },
            WorkflowStep {
                id: "audit".to_string(),
                label: "Audit Log Generation".to_string(),
                status: "pending".to_string(),
            },
        ];

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

    // Build editor context if content is provided (simplified)
    let editor_context = editor_content
        .filter(|c| !c.is_empty())
        .map(|c| format!(
            r#"

【現在エディタに表示されているテキスト】
```
{}
```

上記のテキストに含まれる個人情報の種類と対応策を簡潔に説明してください。"#,
            c
        ))
        .unwrap_or_default();

    // Concise system prompt
    let system_context = if is_bulk_request {
        format!(
            r#"あなたは医療データ匿名化の専門エージェントです。ユーザーは{}件のファイルの一括処理を希望しています。

【重要】回答は3文以内で簡潔に。長い説明は不要です。

例: 「{}件のファイルを検証後、並列処理します。元データは変更せずanonymized_outputsに出力します。」{}
"#,
            file_count, file_count, editor_context
        )
    } else {
        format!(
            "あなたは医療データ匿名化の専門エージェントです。【重要】回答は2-3文以内で簡潔に。{}",
            editor_context
        )
    };

    // Prepend system context to first user message
    let mut history: Vec<Content> = messages.iter().map(|m| Content {
        role: if m.role == "assistant" { "model".to_string() } else { "user".to_string() },
        parts: vec![Part { text: m.content.clone() }],
    }).collect();

    if !history.is_empty() {
        if let Some(first) = history.first_mut() {
            first.parts[0].text = format!("[System]: {}\n\n{}", system_context, first.parts[0].text);
        }
    }

    // Use streaming chat
    let ai_response = handler.chat_streaming(history, &app).await?;

    // Generate execution plan when needed
    let (bulk_plan, workflow_steps) = if is_bulk_request || has_purpose {
        let effective_count = if file_count > 0 { file_count } else { 1 };
        let estimated_time = (effective_count as u64) * 50;

        let plan = BulkExecutionPlan {
            target_count: effective_count,
            estimated_time_ms: estimated_time,
            policy_summary: vec![
                "氏名 → 削除".to_string(),
                "年齢 → 5歳刻み".to_string(),
                "日付 → 月単位".to_string(),
                "住所 → 都道府県のみ".to_string(),
                "病名 → 一般化".to_string(),
            ],
        };

        let steps = vec![
            WorkflowStep {
                id: "validation".to_string(),
                label: "Validation (Dry Run)".to_string(),
                status: "pending".to_string(),
            },
            WorkflowStep {
                id: "execution".to_string(),
                label: if effective_count > 1 { "Parallel Execution".to_string() } else { "Execution".to_string() },
                status: "pending".to_string(),
            },
            WorkflowStep {
                id: "audit".to_string(),
                label: "Audit Log Generation".to_string(),
                status: "pending".to_string(),
            },
        ];

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
