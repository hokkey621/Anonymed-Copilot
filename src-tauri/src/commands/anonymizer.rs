use crate::domain::agent_orchestrator::AgentOrchestrator;
use crate::domain::model::AnonPlan;
use crate::domain::skills::{build_prompt_with_skills, find_matching_skills, get_skill_names};
use crate::infrastructure::llm::{LlmClient, LlmMessage, ModelProvider};
use crate::state::CancellationState;
use crate::utils::plan_apply::apply_plan_to_text;
use sha2::{Digest, Sha256};
use tauri::{Emitter, State};
use zeroize::Zeroize;

/// Analyze text and generate an anonymization plan using Multi-Agent Orchestrator
#[tauri::command]
pub async fn analyze_text(
    app: tauri::AppHandle,
    text: String,
    task_context: String,
    provider: Option<ModelProvider>,
) -> Result<AnonPlan, String> {
    let orchestrator = AgentOrchestrator::new(&app, provider.unwrap_or_default())?;
    // The user's input "task_context" here is effectively the prompt for the Planner (e.g. "Vaccine Study")
    let plan = orchestrator
        .run_anonymization_pipeline(&app, &text, &task_context)
        .await?;
    Ok(plan)
}

/// Apply the anonymization plan to the text
#[tauri::command]
pub fn apply_plan(mut text: String, plan: AnonPlan) -> Result<String, String> {
    let processed = apply_plan_to_text(&text, &plan, true)?;
    unsafe {
        text.as_mut_vec().zeroize();
    }
    Ok(processed)
}

#[derive(serde::Deserialize)]
pub struct ChatMessage {
    role: String,
    content: String,
}

fn to_history(messages: &[ChatMessage]) -> Vec<LlmMessage> {
    messages
        .iter()
        .map(|m| LlmMessage {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect()
}

/// Conversational chat with AI (supports history)
#[tauri::command]
pub async fn chat_with_ai(
    app: tauri::AppHandle,
    messages: Vec<ChatMessage>,
    provider: Option<ModelProvider>,
) -> Result<String, String> {
    let handler = LlmClient::from_app(&app, provider.unwrap_or_default())?;
    let history = to_history(&messages);

    handler.chat(history, None).await
}

use crate::domain::model::{BulkExecutionPlan, WorkflowStep};
use serde::{Deserialize, Serialize};

use crate::commands::chat_intent::{
    detect_purpose_in_text, detect_revision_intent, detect_rule_tuning_intent,
    infer_interaction_category, InteractionCategory,
};
use crate::commands::chat_planning::{
    infer_purpose_label, plan_reason_for_purpose, should_force_plan_from_response,
};
use crate::commands::chat_state::{
    generate_contextual_suggestions, guidance_message_for_category, infer_next_state,
    should_use_template_response, suggestions_for_state,
};
use crate::commands::chat_types::ChatPhase;

/// Response from agent chat that may include bulk execution plan
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatResponse {
    pub message: String,
    pub bulk_plan: Option<BulkExecutionPlan>,
    pub workflow_steps: Option<Vec<WorkflowStep>>,
    pub suggestions: Option<Vec<String>>,
    pub next_state: ChatPhase,
    pub state_reason: String,
    pub applied_skills: Vec<String>,
}

#[derive(Deserialize)]
struct PlanRevisionOutput {
    locked_plan_text: String,
}

fn build_locked_plan_text(policy_summary: &[String]) -> String {
    let mut lines = vec![
        "初期計画: 患者本人の氏名、医療従事者・家族・関係者の氏名、病院/診療所/施設の固有名詞、地名・住所の固有名詞、具体的なカレンダー日付・時刻・和暦を含む日付表現、年齢表現、電話番号やマイナンバーなどの個人番号をアスタリスク（****）で置換する。".to_string(),
        "優先順位: ユーザー編集 > skill 指示 > 初期計画。".to_string(),
    ];
    for rule in policy_summary {
        let trimmed = rule.trim();
        if !trimmed.is_empty() {
            lines.push(format!("- {}", trimmed));
        }
    }
    lines.join("\n")
}

fn normalize_policy_summary(policy_summary: &[String]) -> Vec<String> {
    policy_summary
        .iter()
        .map(|line| line.trim().trim_start_matches('-').trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

fn extract_policy_summary_from_locked_plan(locked_plan_text: &str) -> Vec<String> {
    let extracted: Vec<String> = locked_plan_text
        .lines()
        .map(str::trim)
        .filter_map(|line| {
            if line.starts_with("- ") {
                Some(line.trim_start_matches("- ").trim().to_string())
            } else {
                None
            }
        })
        .filter(|line| !line.is_empty())
        .collect();

    if extracted.is_empty() {
        crate::prompts::default_policy_summary()
    } else {
        extracted
    }
}

fn hash_plan_text(plan_text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(plan_text.as_bytes());
    hex::encode(hasher.finalize())
}

fn build_bulk_plan(target_count: usize, estimated_time_ms: u64, policy_summary: Vec<String>) -> BulkExecutionPlan {
    let normalized = normalize_policy_summary(&policy_summary);
    let locked_plan_text = build_locked_plan_text(&normalized);
    BulkExecutionPlan {
        target_count,
        estimated_time_ms,
        policy_summary: normalized,
        plan_version: 1,
        plan_hash: hash_plan_text(&locked_plan_text),
        locked_plan_text,
    }
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
    messages
        .iter()
        .rev()
        .filter(|m| m.role == "user")
        .take(3)
        .any(|m| PURPOSE_KEYWORDS.iter().any(|kw| m.content.contains(kw)))
}

fn detect_planning_intent(messages: &[ChatMessage]) -> bool {
    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        return crate::commands::chat_intent::detect_planning_intent_text(&last_user_msg.content);
    }
    false
}

fn compose_plan_policy_summary(matching_skills: &[&crate::domain::skills::LoadedSkill], user_input: &str) -> Vec<String> {
    let _ = user_input;
    let mut summary = crate::prompts::default_policy_summary();
    let skill_summary = crate::domain::skills::get_skill_policy_summary(matching_skills);

    for item in skill_summary {
        let category = item
            .split('→')
            .next()
            .map(str::trim)
            .unwrap_or("");

        let mapped_keyword = match category {
            "氏名" => Some("氏名"),
            "年齢" => Some("年齢"),
            "生年月日" => Some("日付"),
            "住所" => Some("住所"),
            "電話番号" => Some("電話番号"),
            "個人番号" => Some("個人番号"),
            "治験施設名" => Some("病院/診療所/施設"),
            _ => None,
        };

        if let Some(keyword) = mapped_keyword {
            if let Some(index) = summary.iter().position(|line| line.contains(keyword)) {
                summary[index] = item.clone();
                continue;
            }
        }

        if !summary.iter().any(|existing| existing == &item) {
            summary.push(item);
        }
    }
    summary
}

#[tauri::command]
pub async fn revise_bulk_plan(
    app: tauri::AppHandle,
    plan: BulkExecutionPlan,
    user_request: String,
    provider: Option<ModelProvider>,
) -> Result<BulkExecutionPlan, String> {
    let handler = LlmClient::from_app(&app, provider.unwrap_or_default())?;

    let current_locked_plan = if plan.locked_plan_text.trim().is_empty() {
        build_locked_plan_text(&plan.policy_summary)
    } else {
        plan.locked_plan_text.clone()
    };

    let system_prompt = "You revise anonymization plans in Japanese.\nRules:\n- Keep unchanged parts exactly unless requested.\n- Default replacement policy must remain mask with **** for PHI.\n- Only change replacement method when user explicitly asks, or when the current plan already states a skill-specific exception.\n- Preserve policy priority: user edits > skill instructions > default plan.\n- Return JSON only.";

    let user_prompt = format!(
        "Current plan:\n{}\n\nUser edit request:\n{}\n\nReturn JSON:\n{{\"locked_plan_text\":\"...\"}}",
        current_locked_plan, user_request
    );

    let revised = handler
        .generate_structure::<PlanRevisionOutput>(&user_prompt, system_prompt, None)
        .await?;

    let locked_plan_text = revised.locked_plan_text.trim().to_string();
    if locked_plan_text.is_empty() {
        return Err("編集後の計画が空です。もう一度具体的に指示してください。".to_string());
    }

    let policy_summary = extract_policy_summary_from_locked_plan(&locked_plan_text);
    let plan_hash = hash_plan_text(&locked_plan_text);
    let next_version = plan.plan_version.saturating_add(1);

    Ok(BulkExecutionPlan {
        target_count: plan.target_count,
        estimated_time_ms: plan.estimated_time_ms,
        policy_summary,
        locked_plan_text,
        plan_version: next_version,
        plan_hash,
    })
}

/// Enhanced agent chat that supports bulk execution planning
#[tauri::command]
pub async fn agent_chat(
    app: tauri::AppHandle,
    messages: Vec<ChatMessage>,
    file_count: usize,
    editor_content: Option<String>,
    provider: Option<ModelProvider>,
    chat_phase: Option<ChatPhase>,
) -> Result<AgentChatResponse, String> {
    let handler = LlmClient::from_app(&app, provider.unwrap_or_default())?;

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

    // Find matching skills based on user's last message
    let last_user_message = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("");
    let matching_skills = find_matching_skills(last_user_message);
    let skill_names = get_skill_names(&matching_skills);
    let has_purpose = detect_purpose_intent(&messages);
    let mut category = infer_interaction_category(last_user_message, has_purpose, file_count);
    let has_plan_flow_context = matches!(
        chat_phase,
        Some(ChatPhase::PlanPresented)
            | Some(ChatPhase::ExecutionReady)
            | Some(ChatPhase::Revision)
    );
    if has_plan_flow_context
        && (category == InteractionCategory::General
            || detect_rule_tuning_intent(last_user_message))
    {
        category = InteractionCategory::Revision;
    }

    if category == InteractionCategory::PlanCreation && file_count > 0 {
        let effective_count = file_count;
        let policy_summary = compose_plan_policy_summary(&matching_skills, last_user_message);
        let bulk_plan = build_bulk_plan(effective_count, (effective_count as u64) * 50, policy_summary);
        let workflow_steps = prompts::default_workflow_steps(effective_count > 1);
        let next_state = ChatPhase::PlanPresented;
        let suggestions = prompts::plan_created_suggestions();

        return Ok(AgentChatResponse {
            message: format!(
                "{}向けの匿名化プランを作成しました。理由: {} 内容を確認して問題なければ実行してください。",
                infer_purpose_label(last_user_message),
                plan_reason_for_purpose(last_user_message)
            ),
            bulk_plan: Some(bulk_plan),
            workflow_steps: Some(workflow_steps),
            suggestions: Some(suggestions),
            next_state,
            state_reason: "plan_created".to_string(),
            applied_skills: skill_names,
        });
    }

    if should_use_template_response(category) {
        let (next_state, state_reason_key) = infer_next_state(
            chat_phase,
            last_user_message,
            file_count,
            has_purpose,
            false,
            false,
        );
        let suggestions = generate_contextual_suggestions(
            next_state,
            category,
            has_purpose,
            file_count,
            last_user_message,
        );
        return Ok(AgentChatResponse {
            message: guidance_message_for_category(category, file_count, has_purpose),
            bulk_plan: None,
            workflow_steps: None,
            suggestions: Some(suggestions),
            next_state,
            state_reason: state_reason_key.to_string(),
            applied_skills: skill_names,
        });
    }

    // Inject skill context into prompt if any matched
    let final_prompt = if !matching_skills.is_empty() {
        build_prompt_with_skills(&system_context, &matching_skills)
    } else {
        system_context
    };

    // Create history
    let history = to_history(&messages);

    let ai_response = handler.chat(history, Some(final_prompt.as_str())).await?;

    // Check if user has expressed anonymization purpose
    let planning_intent = detect_planning_intent(&messages);
    let revision_intent = detect_revision_intent(last_user_message);
    let should_auto_plan = detect_purpose_in_text(last_user_message);
    let should_create_plan = is_bulk_request
        || ((has_purpose && planning_intent) && !revision_intent)
        || should_auto_plan;

    // Generate execution plan when user explicitly asks for planning/execution
    let (mut bulk_plan, mut workflow_steps) = if should_create_plan {
        let effective_count = if file_count > 0 { file_count } else { 1 };
        let estimated_time = (effective_count as u64) * 50;

        let plan = build_bulk_plan(effective_count, estimated_time, prompts::default_policy_summary());

        let steps = prompts::default_workflow_steps(effective_count > 1);

        (Some(plan), Some(steps))
    } else {
        (None, None)
    };

    if bulk_plan.is_none() && should_force_plan_from_response(category, file_count, &ai_response) {
        let effective_count = if file_count > 0 { file_count } else { 1 };
        let policy_summary = compose_plan_policy_summary(&matching_skills, last_user_message);
        bulk_plan = Some(build_bulk_plan(
            effective_count,
            (effective_count as u64) * 50,
            policy_summary,
        ));
        workflow_steps = Some(prompts::default_workflow_steps(effective_count > 1));
    }

    let (next_state, state_reason_key) = infer_next_state(
        chat_phase,
        last_user_message,
        file_count,
        has_purpose,
        is_bulk_request,
        bulk_plan.is_some(),
    );
    let suggestions = generate_contextual_suggestions(
        next_state,
        category,
        has_purpose,
        file_count,
        last_user_message,
    );
    Ok(AgentChatResponse {
        message: ai_response,
        bulk_plan,
        workflow_steps,
        suggestions: Some(suggestions),
        next_state,
        state_reason: state_reason_key.to_string(),
        applied_skills: skill_names,
    })
}

/// Streaming version of agent chat - emits chat-stream events
#[tauri::command]
pub async fn agent_chat_streaming(
    app: tauri::AppHandle,
    messages: Vec<ChatMessage>,
    file_count: usize,
    editor_content: Option<String>,
    provider: Option<ModelProvider>,
    chat_phase: Option<ChatPhase>,
    cancellation_state: State<'_, CancellationState>,
) -> Result<AgentChatResponse, String> {
    cancellation_state.reset_chat();
    let handler = LlmClient::from_app(&app, provider.unwrap_or_default())?;

    let is_bulk_request = detect_bulk_intent(&messages);
    // let has_purpose = detect_purpose_intent(&messages); // Moved to later check

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

    // Find matching skills based on user's last message
    let last_user_message = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("");
    let matching_skills = find_matching_skills(last_user_message);
    let skill_names = get_skill_names(&matching_skills);
    let has_purpose = detect_purpose_intent(&messages);
    let mut category = infer_interaction_category(last_user_message, has_purpose, file_count);
    let has_plan_flow_context = matches!(
        chat_phase,
        Some(ChatPhase::PlanPresented)
            | Some(ChatPhase::ExecutionReady)
            | Some(ChatPhase::Revision)
    );
    if has_plan_flow_context
        && (category == InteractionCategory::General
            || detect_rule_tuning_intent(last_user_message))
    {
        category = InteractionCategory::Revision;
    }

    if category == InteractionCategory::PlanCreation && file_count > 0 {
        let _ = app.emit(
            "thinking-phase",
            serde_json::json!({
                "phase": "complete",
                "message": "完了"
            }),
        );
        let effective_count = file_count;
        let policy_summary = compose_plan_policy_summary(&matching_skills, last_user_message);
        let bulk_plan = build_bulk_plan(
            effective_count,
            (effective_count as u64) * 10000,
            policy_summary,
        );
        let workflow_steps = prompts::default_workflow_steps(effective_count > 1);
        let next_state = ChatPhase::PlanPresented;
        let suggestions = prompts::plan_created_suggestions();

        return Ok(AgentChatResponse {
            message: format!(
                "{}向けの匿名化プランを作成しました。理由: {} 内容を確認して問題なければ実行してください。",
                infer_purpose_label(last_user_message),
                plan_reason_for_purpose(last_user_message)
            ),
            bulk_plan: Some(bulk_plan),
            workflow_steps: Some(workflow_steps),
            suggestions: Some(suggestions),
            next_state,
            state_reason: "plan_created".to_string(),
            applied_skills: skill_names,
        });
    }

    if should_use_template_response(category) {
        let (next_state, state_reason_key) = infer_next_state(
            chat_phase,
            last_user_message,
            file_count,
            has_purpose,
            false,
            false,
        );
        let _ = app.emit(
            "thinking-phase",
            serde_json::json!({
                "phase": "complete",
                "message": "完了"
            }),
        );
        let suggestions = generate_contextual_suggestions(
            next_state,
            category,
            has_purpose,
            file_count,
            last_user_message,
        );
        return Ok(AgentChatResponse {
            message: guidance_message_for_category(category, file_count, has_purpose),
            bulk_plan: None,
            workflow_steps: None,
            suggestions: Some(suggestions),
            next_state,
            state_reason: state_reason_key.to_string(),
            applied_skills: skill_names,
        });
    }

    // Inject skill context into prompt if any matched
    let final_prompt = if !matching_skills.is_empty() {
        build_prompt_with_skills(&system_context, &matching_skills)
    } else {
        system_context
    };

    // Create history
    let history = to_history(&messages);

    // Emit skill match event if any matched
    if !skill_names.is_empty() {
        let _ = app.emit(
            "agent-progress",
            serde_json::json!({
                "step": "Skills",
                "status": "Completed",
                "message": format!("Matched skills: {}", skill_names.join(", "))
            }),
        );
    }

    // Emit: Analyzing phase
    let _ = app.emit(
        "thinking-phase",
        serde_json::json!({
            "phase": "analyzing",
            "message": "テキストを分析中..."
        }),
    );

    // Use streaming chat with system instruction (including skill context)
    let stream_result = handler
        .chat_streaming(history, Some(final_prompt.as_str()), &app)
        .await;
    let was_cancelled = cancellation_state.is_chat_cancelled();
    cancellation_state.reset_chat();
    let ai_response = stream_result?;

    // Emit: Complete phase
    let _ = app.emit(
        "thinking-phase",
        serde_json::json!({
            "phase": "complete",
            "message": if was_cancelled { "停止しました" } else { "完了" }
        }),
    );

    if was_cancelled {
        let stable_state = chat_phase.unwrap_or(ChatPhase::Discovery);
        return Ok(AgentChatResponse {
            message: ai_response,
            bulk_plan: None,
            workflow_steps: None,
            suggestions: Some(suggestions_for_state(stable_state, false, file_count)),
            next_state: stable_state,
            state_reason: "cancelled".to_string(),
            applied_skills: skill_names,
        });
    }

    let planning_intent = detect_planning_intent(&messages);
    let revision_intent = detect_revision_intent(last_user_message);
    let should_auto_plan = detect_purpose_in_text(last_user_message);
    let should_create_plan = is_bulk_request
        || ((has_purpose && planning_intent) && !revision_intent)
        || should_auto_plan;

    let (mut bulk_plan, mut workflow_steps) = if should_create_plan {
        let effective_count = if file_count > 0 { file_count } else { 1 };
        // Estimate 10 seconds per file for LLM processing + overhead
        let estimated_time = (effective_count as u64) * 10000;

        let policy_summary = compose_plan_policy_summary(&matching_skills, last_user_message);

        let plan = build_bulk_plan(effective_count, estimated_time, policy_summary);

        let steps = prompts::default_workflow_steps(effective_count > 1);

        (Some(plan), Some(steps))
    } else {
        (None, None)
    };

    if bulk_plan.is_none() && should_force_plan_from_response(category, file_count, &ai_response) {
        let effective_count = if file_count > 0 { file_count } else { 1 };
        let policy_summary = compose_plan_policy_summary(&matching_skills, last_user_message);
        bulk_plan = Some(build_bulk_plan(
            effective_count,
            (effective_count as u64) * 10000,
            policy_summary,
        ));
        workflow_steps = Some(prompts::default_workflow_steps(effective_count > 1));
    }

    let (next_state, state_reason_key) = infer_next_state(
        chat_phase,
        last_user_message,
        file_count,
        has_purpose,
        is_bulk_request,
        bulk_plan.is_some(),
    );
    let suggestions = generate_contextual_suggestions(
        next_state,
        category,
        has_purpose,
        file_count,
        last_user_message,
    );
    Ok(AgentChatResponse {
        message: ai_response,
        bulk_plan,
        workflow_steps,
        suggestions: Some(suggestions),
        next_state,
        state_reason: state_reason_key.to_string(),
        applied_skills: skill_names,
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
            applied_skills: vec![],
        };

        let result = apply_plan(original_text, plan).unwrap();
        assert_eq!(result, "Patient **NAME** visited Site A on Day 0.");
    }

    #[test]
    fn test_state_inference_for_help() {
        let (state, reason) = infer_next_state(
            Some(ChatPhase::OffTopic),
            "使い方を教えて",
            1,
            false,
            false,
            false,
        );
        assert_eq!(state, ChatPhase::Help);
        assert_eq!(reason, "help_intent");
    }

    #[test]
    fn test_state_inference_for_purpose_selection() {
        let (state, reason) = infer_next_state(
            Some(ChatPhase::Discovery),
            "匿名化したい",
            2,
            false,
            false,
            false,
        );
        assert_eq!(state, ChatPhase::PurposeSelection);
        assert_eq!(reason, "needs_purpose");
    }

    #[test]
    fn test_state_inference_for_purpose_context_only() {
        let (state, reason) = infer_next_state(
            Some(ChatPhase::PurposeSelection),
            "標準で",
            2,
            true,
            false,
            false,
        );
        assert_eq!(state, ChatPhase::PurposeSelection);
        assert_eq!(reason, "purpose_context");
    }

    #[test]
    fn test_auto_plan_condition_when_purpose_exists() {
        let has_purpose = true;
        let planning_intent = false;
        let revision_intent = false;
        let file_count = 2usize;
        let is_bulk_request = false;
        let should_auto_plan = has_purpose && file_count > 0;
        let should_create_plan = is_bulk_request
            || ((has_purpose && planning_intent) && !revision_intent)
            || should_auto_plan;
        assert!(should_create_plan);
    }

    #[test]
    fn test_state_inference_for_plan_review() {
        let (state, reason) = infer_next_state(
            Some(ChatPhase::PurposeSelection),
            "ワクチン研究向けでプラン作成",
            2,
            true,
            false,
            true,
        );
        assert_eq!(state, ChatPhase::PlanPresented);
        assert_eq!(reason, "plan_created");
    }

    #[test]
    fn test_state_inference_for_revision() {
        let (state, reason) = infer_next_state(
            Some(ChatPhase::PlanPresented),
            "日付ルールを修正したい",
            2,
            true,
            false,
            false,
        );
        assert_eq!(state, ChatPhase::Revision);
        assert_eq!(reason, "revision_intent");
    }

    #[test]
    fn test_suggestions_for_revision_state() {
        let suggestions = suggestions_for_state(ChatPhase::Revision, true, 2);
        assert_eq!(suggestions, crate::prompts::revision_suggestions());
    }

    #[test]
    fn test_help_state_guidance_and_suggestions() {
        let suggestions = suggestions_for_state(ChatPhase::Help, false, 0);
        assert_eq!(
            suggestions,
            vec![
                "ファイルを開く".to_string(),
                "処理対象を確認".to_string(),
                "匿名化プランを作成".to_string()
            ]
        );

        let message =
            crate::commands::chat_state::guidance_message_for_state(ChatPhase::Help, 0, false);
        assert!(message.contains("使い方"));
        assert!(message.contains("匿名化プラン"));
    }

    #[test]
    fn test_suggestions_for_purpose_state_without_files() {
        let suggestions = suggestions_for_state(ChatPhase::PurposeSelection, false, 0);
        assert_eq!(suggestions, crate::prompts::anonymization_purpose_options());
    }

    #[test]
    fn test_suggestions_for_offtopic_state() {
        let suggestions = suggestions_for_state(ChatPhase::OffTopic, false, 2);
        assert!(suggestions.contains(&"匿名化プランを作成".to_string()));
    }

    #[test]
    fn test_hint_candidates_for_purpose_state() {
        let candidates = crate::commands::chat_state::hint_candidates_for_state(
            ChatPhase::PurposeSelection,
            false,
            2,
        );
        assert!(!candidates.is_empty());
        assert!(candidates.iter().any(|c| c.label == "ワクチン研究用"));
    }

    #[test]
    fn test_infer_interaction_category_for_help() {
        let category = infer_interaction_category("使い方を教えて", false, 0);
        assert_eq!(category, InteractionCategory::Help);
    }

    #[test]
    fn test_generate_contextual_suggestions_for_purpose_message() {
        let suggestions = generate_contextual_suggestions(
            ChatPhase::PurposeSelection,
            InteractionCategory::PlanCreation,
            true,
            2,
            "ワクチン開発が目的です",
        );
        assert!(!suggestions.is_empty());
        assert!(
            suggestions.contains(&"匿名化プランを作成".to_string())
                || suggestions.contains(&"標準ルールで作成".to_string())
        );
    }
}
