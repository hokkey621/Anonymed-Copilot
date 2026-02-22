use crate::domain::agent_orchestrator::AgentOrchestrator;
use crate::domain::model::AnonPlan;
use crate::domain::skills::{build_prompt_with_skills, find_matching_skills, get_skill_names};
use crate::infrastructure::llm::{LlmClient, LlmMessage, ModelProvider};
use crate::state::CancellationState;
use crate::utils::plan_apply::apply_plan_to_text;
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
use serde::Serialize;

#[derive(Clone, Copy, Debug, serde::Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatPhase {
    Discovery,
    Help,
    PurposeSelection,
    PlanPresented,
    ExecutionReady,
    Revision,
    Troubleshoot,
    OffTopic,
}

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

fn detect_purpose_in_text(content: &str) -> bool {
    use crate::prompts::PURPOSE_KEYWORDS;
    PURPOSE_KEYWORDS.iter().any(|kw| content.contains(kw))
}

/// Check if the user message indicates intent to create a plan
fn detect_planning_intent(messages: &[ChatMessage]) -> bool {
    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        return detect_planning_intent_text(&last_user_msg.content);
    }
    false
}

fn detect_planning_intent_text(content: &str) -> bool {
    use crate::prompts::EXECUTION_KEYWORDS;
    EXECUTION_KEYWORDS.iter().any(|kw| content.contains(kw))
}

fn detect_anonymization_intent(content: &str) -> bool {
    let lower = content.to_lowercase();
    content.contains("匿名化")
        || content.contains("実行")
        || content.contains("プラン")
        || content.contains("計画")
        || content.contains("個人情報")
        || content.contains("伏せ字")
        || content.contains("マスク")
        || lower.contains("anonym")
        || lower.contains("phi")
}

fn detect_revision_intent(content: &str) -> bool {
    let lower = content.to_lowercase();
    content.contains("修正")
        || content.contains("調整")
        || content.contains("見直")
        || content.contains("やり直")
        || content.contains("再実行")
        || content.contains("結果")
        || content.contains("おかしい")
        || content.contains("強すぎ")
        || content.contains("弱すぎ")
        || content.contains("変更")
        || lower.contains("fix")
        || lower.contains("revise")
}

fn detect_help_intent(content: &str) -> bool {
    let lower = content.to_lowercase();
    content.contains("使い方")
        || content.contains("ヘルプ")
        || content.contains("どうやって")
        || content.contains("開き方")
        || lower.contains("help")
}

fn detect_capability_intent(content: &str) -> bool {
    content.contains("今できること")
        || content.contains("何ができる")
        || content.contains("次に何をすれば")
}

fn detect_troubleshoot_intent(content: &str) -> bool {
    let lower = content.to_lowercase();
    content.contains("エラー")
        || content.contains("失敗")
        || content.contains("動かない")
        || content.contains("問題")
        || content.contains("おかしい")
        || content.contains("タイムアウト")
        || content.contains("接続できない")
        || lower.contains("error")
        || lower.contains("fail")
        || lower.contains("timeout")
}

fn detect_execute_intent(content: &str) -> bool {
    let normalized = content.split_whitespace().collect::<String>();
    normalized == "実行"
        || normalized == "この内容で実行"
        || normalized == "処理を開始"
        || normalized.ends_with("を実行")
}

fn detect_rule_tuning_intent(content: &str) -> bool {
    content.contains("年齢")
        || content.contains("日付")
        || content.contains("氏名")
        || content.contains("住所")
        || content.contains("病名")
        || content.contains("ルール")
        || content.contains("一般化")
        || content.contains("粒度")
        || content.contains("置換")
        || content.contains("マスク")
        || content.contains("五歳")
        || content.contains("5歳")
        || content.contains("刻み")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InteractionCategory {
    Onboarding,
    Help,
    Capability,
    PurposeSelection,
    PlanCreation,
    Execution,
    Revision,
    Troubleshoot,
    General,
}

fn infer_interaction_category(
    last_user_message: &str,
    has_purpose: bool,
    file_count: usize,
) -> InteractionCategory {
    if detect_troubleshoot_intent(last_user_message) {
        return InteractionCategory::Troubleshoot;
    }
    if detect_help_intent(last_user_message) {
        return InteractionCategory::Help;
    }
    if detect_capability_intent(last_user_message) {
        return InteractionCategory::Capability;
    }
    if detect_revision_intent(last_user_message) {
        return InteractionCategory::Revision;
    }
    if detect_execute_intent(last_user_message) {
        return InteractionCategory::Execution;
    }
    if file_count == 0 {
        return InteractionCategory::Onboarding;
    }
    if detect_purpose_in_text(last_user_message) {
        return InteractionCategory::PlanCreation;
    }
    if detect_anonymization_intent(last_user_message) && !has_purpose {
        return InteractionCategory::PurposeSelection;
    }
    if detect_planning_intent_text(last_user_message) {
        return InteractionCategory::PlanCreation;
    }
    InteractionCategory::General
}

fn infer_next_state(
    previous_state: Option<ChatPhase>,
    last_user_message: &str,
    file_count: usize,
    has_purpose: bool,
    is_bulk_request: bool,
    plan_created: bool,
) -> (ChatPhase, &'static str) {
    let has_plan_flow_context = matches!(
        previous_state,
        Some(ChatPhase::PlanPresented) | Some(ChatPhase::ExecutionReady) | Some(ChatPhase::Revision)
    );

    if detect_help_intent(last_user_message) {
        return (ChatPhase::Help, "help_intent");
    }

    if detect_capability_intent(last_user_message) {
        return (
            previous_state.unwrap_or(if file_count == 0 {
                ChatPhase::Discovery
            } else {
                ChatPhase::PurposeSelection
            }),
            "capability_intent",
        );
    }

    if detect_troubleshoot_intent(last_user_message) {
        return (ChatPhase::Troubleshoot, "troubleshoot_intent");
    }

    if detect_revision_intent(last_user_message)
        && matches!(
            previous_state,
            Some(ChatPhase::PlanPresented)
                | Some(ChatPhase::ExecutionReady)
                | Some(ChatPhase::Revision)
                | Some(ChatPhase::Troubleshoot)
        )
    {
        return (ChatPhase::Revision, "revision_intent");
    }

    if plan_created {
        return (ChatPhase::PlanPresented, "plan_created");
    }

    if is_bulk_request {
        return (ChatPhase::ExecutionReady, "bulk_request");
    }

    // Keep users in plan-edit flow once a plan has been presented.
    if has_plan_flow_context {
        if let Some(state) = previous_state {
            return (state, "keep_plan_flow");
        }
    }

    if has_purpose {
        return (ChatPhase::PurposeSelection, "purpose_context");
    }

    if detect_anonymization_intent(last_user_message) {
        if file_count == 0 {
            return (ChatPhase::Discovery, "needs_file");
        }
        return (ChatPhase::PurposeSelection, "needs_purpose");
    }

    if file_count == 0 {
        return (ChatPhase::Discovery, "no_file_context");
    }

    (ChatPhase::OffTopic, "off_topic")
}

fn suggestions_for_state(state: ChatPhase, has_purpose: bool, file_count: usize) -> Vec<String> {
    use crate::prompts;

    let top3 = |candidates: Vec<prompts::HintCandidate>| -> Vec<String> {
        candidates
            .into_iter()
            .take(3)
            .map(|c| c.label.to_string())
            .collect()
    };

    match state {
        ChatPhase::Discovery => {
            if file_count == 0 {
                prompts::help_suggestions()
            } else {
                prompts::create_plan_options()
            }
        }
        ChatPhase::Help => top3(prompts::help_hint_candidates(file_count)),
        ChatPhase::PurposeSelection => {
            if !has_purpose {
                prompts::anonymization_purpose_options()
            } else if file_count == 0 {
                prompts::help_suggestions()
            } else {
                prompts::create_plan_options()
            }
        }
        ChatPhase::PlanPresented | ChatPhase::ExecutionReady => prompts::plan_created_suggestions(),
        ChatPhase::Revision => prompts::revision_suggestions(),
        ChatPhase::Troubleshoot => top3(prompts::troubleshoot_hint_candidates()),
        ChatPhase::OffTopic => top3(prompts::off_topic_hint_candidates()),
    }
}

fn hint_candidates_for_state(
    state: ChatPhase,
    has_purpose: bool,
    file_count: usize,
) -> Vec<crate::prompts::HintCandidate> {
    use crate::prompts;

    match state {
        ChatPhase::Discovery => {
            if file_count == 0 {
                prompts::discovery_hint_candidates_without_files()
            } else {
                prompts::discovery_hint_candidates_with_files()
            }
        }
        ChatPhase::Help => prompts::help_hint_candidates(file_count),
        ChatPhase::PurposeSelection => {
            if !has_purpose {
                prompts::purpose_hint_candidates()
            } else if file_count == 0 {
                prompts::discovery_hint_candidates_without_files()
            } else {
                prompts::discovery_hint_candidates_with_files()
            }
        }
        ChatPhase::PlanPresented | ChatPhase::ExecutionReady => prompts::plan_hint_candidates(),
        ChatPhase::Revision => prompts::revision_hint_candidates(),
        ChatPhase::Troubleshoot => prompts::troubleshoot_hint_candidates(),
        ChatPhase::OffTopic => prompts::off_topic_hint_candidates(),
    }
}

fn hint_candidates_for_category(
    category: InteractionCategory,
    state: ChatPhase,
    has_purpose: bool,
    file_count: usize,
) -> Vec<crate::prompts::HintCandidate> {
    use crate::prompts;

    match category {
        InteractionCategory::Onboarding => prompts::discovery_hint_candidates_without_files(),
        InteractionCategory::Help => prompts::help_hint_candidates(file_count),
        InteractionCategory::Capability => {
            if file_count == 0 {
                prompts::discovery_hint_candidates_without_files()
            } else {
                prompts::discovery_hint_candidates_with_files()
            }
        }
        InteractionCategory::PurposeSelection => prompts::purpose_hint_candidates(),
        InteractionCategory::PlanCreation => {
            if matches!(state, ChatPhase::PlanPresented | ChatPhase::ExecutionReady) {
                prompts::plan_hint_candidates()
            } else {
                prompts::discovery_hint_candidates_with_files()
            }
        }
        InteractionCategory::Execution => prompts::plan_hint_candidates(),
        InteractionCategory::Revision => prompts::revision_hint_candidates(),
        InteractionCategory::Troubleshoot => prompts::troubleshoot_hint_candidates(),
        InteractionCategory::General => hint_candidates_for_state(state, has_purpose, file_count),
    }
}

fn contains_any(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|kw| text.contains(kw))
}

fn score_hint_id_by_message(
    hint_id: &str,
    category: InteractionCategory,
    has_purpose: bool,
    normalized_message: &str,
) -> i32 {
    let mut score = 0i32;
    let exact_open_command =
        normalized_message == "ファイルを開く" || normalized_message == "フォルダを開く";

    // state-prior baseline
    score += match category {
        InteractionCategory::Help => match hint_id {
            "open_file" => 18,
            "create_plan" => 14,
            "show_shortcut" => 12,
            "show_usage" => 10,
            _ => 0,
        },
        InteractionCategory::PurposeSelection if !has_purpose => match hint_id {
            "purpose_vaccine"
            | "purpose_education"
            | "purpose_case_report"
            | "purpose_research"
            | "purpose_standard" => 20,
            _ => -5,
        },
        InteractionCategory::PlanCreation | InteractionCategory::Execution => match hint_id {
            "run_plan" => 20,
            "revise_rules" | "revise_date" | "revise_age" => 14,
            "explain_plan" => 10,
            _ => 0,
        },
        InteractionCategory::Revision => match hint_id {
            "revise_date" | "revise_age" | "revise_name" => 16,
            "rerun" => 12,
            _ => 0,
        },
        InteractionCategory::Troubleshoot => match hint_id {
            "show_error" | "check_settings" => 18,
            "retry" | "check_ollama" => 14,
            _ => 0,
        },
        _ => 0,
    };

    // global intent boosts
    let wants_help = contains_any(
        normalized_message,
        &["使い方", "ヘルプ", "help", "できること"],
    );
    let wants_open = contains_any(
        normalized_message,
        &["開く", "ファイル", "フォルダ", "open"],
    );
    let wants_plan = contains_any(normalized_message, &["プラン", "計画", "匿名化", "anonym"]);
    let wants_run = contains_any(
        normalized_message,
        &["実行", "開始", "やって", "お願いします"],
    );
    let wants_revision = contains_any(
        normalized_message,
        &["修正", "調整", "見直", "変更", "再実行"],
    );
    let wants_trouble = contains_any(
        normalized_message,
        &[
            "エラー",
            "失敗",
            "動かない",
            "問題",
            "タイムアウト",
            "接続",
            "error",
            "fail",
            "timeout",
        ],
    );

    if wants_help && matches!(hint_id, "show_usage" | "show_shortcut" | "ask_capability") {
        score += 10;
    }
    if wants_open && matches!(hint_id, "open_file" | "open_folder" | "check_targets") {
        score += 10;
    }
    if exact_open_command && matches!(hint_id, "open_file" | "open_folder") {
        score -= 40;
    }
    if wants_plan
        && matches!(
            hint_id,
            "create_plan" | "create_plan_standard" | "ask_purpose"
        )
    {
        score += 12;
    }
    if wants_run && matches!(hint_id, "run_plan" | "retry" | "rerun") {
        score += 14;
    }
    if wants_revision
        && matches!(
            hint_id,
            "revise_rules" | "revise_date" | "revise_age" | "revise_name" | "rerun"
        )
    {
        score += 12;
    }
    if wants_trouble
        && matches!(
            hint_id,
            "show_error" | "check_settings" | "check_ollama" | "retry" | "switch_model"
        )
    {
        score += 16;
    }

    // purpose-specific boosts
    if contains_any(normalized_message, &["ワクチン", "vaccine"]) && hint_id == "purpose_vaccine"
    {
        score += 18;
    }
    if contains_any(normalized_message, &["教材", "教育"]) && hint_id == "purpose_education" {
        score += 18;
    }
    if contains_any(normalized_message, &["症例"]) && hint_id == "purpose_case_report" {
        score += 18;
    }
    if contains_any(normalized_message, &["研究", "論文"]) && hint_id == "purpose_research" {
        score += 18;
    }
    if contains_any(normalized_message, &["標準", "そのまま"]) && hint_id == "purpose_standard"
    {
        score += 18;
    }

    // once purpose is already provided, next best action is plan creation
    if has_purpose && matches!(hint_id, "create_plan" | "create_plan_standard" | "run_plan") {
        score += 8;
    }

    score
}

fn generate_contextual_suggestions(
    state: ChatPhase,
    category: InteractionCategory,
    has_purpose: bool,
    file_count: usize,
    last_user_message: &str,
) -> Vec<String> {
    let fallback = suggestions_for_state(state, has_purpose, file_count);
    let candidates = hint_candidates_for_category(category, state, has_purpose, file_count);
    if candidates.is_empty() {
        return fallback;
    }

    let normalized = last_user_message.to_lowercase();
    let mut scored = candidates
        .iter()
        .enumerate()
        .map(|(idx, candidate)| {
            (
                idx,
                score_hint_id_by_message(candidate.id, category, has_purpose, &normalized),
            )
        })
        .collect::<Vec<(usize, i32)>>();

    scored.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    let mut resolved = Vec::new();
    for (idx, _) in scored.into_iter().take(5) {
        let label = candidates[idx].label.to_string();
        if !resolved.contains(&label) {
            resolved.push(label);
        }
        if resolved.len() >= 3 {
            break;
        }
    }

    if resolved.is_empty() {
        fallback
    } else {
        resolved
    }
}

fn guidance_message_for_state(state: ChatPhase, file_count: usize, has_purpose: bool) -> String {
    match state {
        ChatPhase::Discovery if file_count == 0 => {
            "まず左上の「File」から匿名化したいファイルを開いてください。".to_string()
        }
        ChatPhase::Help => {
            "使い方: 1) ファイルを開く 2) 匿名化プランを作成 3) 内容を確認して実行".to_string()
        }
        ChatPhase::PurposeSelection if !has_purpose => {
            "匿名化の利用目的を選んでください（例: ワクチン研究、教材作成、標準）。".to_string()
        }
        ChatPhase::PurposeSelection => "目的を反映したプランを作成できます。".to_string(),
        ChatPhase::PlanPresented | ChatPhase::ExecutionReady => {
            "プランを確認できました。実行するか、修正して再実行できます。".to_string()
        }
        ChatPhase::Revision => {
            "修正ポイントを指定してください。日付・年齢などのルールを調整できます。".to_string()
        }
        ChatPhase::Troubleshoot => {
            "問題を切り分けます。発生したエラー内容と直前の操作を教えてください。".to_string()
        }
        ChatPhase::OffTopic => {
            "すみません。匿名化以外のご相談には対応していません。匿名化のお手伝いをしましょうか。".to_string()
        }
        _ => "続けて指示をお願いします。".to_string(),
    }
}

fn guidance_message_for_category(
    category: InteractionCategory,
    file_count: usize,
    has_purpose: bool,
) -> String {
    match category {
        InteractionCategory::Onboarding => {
            "まず左上の「File」から匿名化したいファイルを開いてください。".to_string()
        }
        InteractionCategory::Help => {
            "操作の流れ: 1) ファイルを開く 2) 匿名化プランを作成 3) 内容を確認して実行".to_string()
        }
        InteractionCategory::Capability => {
            if file_count == 0 {
                "ファイルを開く・使い方案内・匿名化プラン作成の準備ができます。".to_string()
            } else {
                "現在はプラン作成、ルール修正、実行前確認ができます。".to_string()
            }
        }
        InteractionCategory::PurposeSelection => {
            "匿名化の利用目的を選んでください（例: ワクチン研究、教材作成、標準）。".to_string()
        }
        InteractionCategory::PlanCreation => {
            if has_purpose {
                "目的を反映したプランを作成できます。内容を確認して実行へ進めます。".to_string()
            } else {
                "プラン作成の前に、利用目的を選んでください。".to_string()
            }
        }
        InteractionCategory::Execution => {
            "準備ができていれば実行できます。必要なら先にルールを修正してください。".to_string()
        }
        InteractionCategory::Revision => {
            "修正したい点を指定してください。日付・年齢・氏名ルールを調整できます。".to_string()
        }
        InteractionCategory::Troubleshoot => {
            "エラー内容をもとに切り分けます。直前の操作とエラーメッセージを教えてください。"
                .to_string()
        }
        InteractionCategory::General => {
            guidance_message_for_state(ChatPhase::OffTopic, file_count, has_purpose)
        }
    }
}

fn should_use_template_response(category: InteractionCategory) -> bool {
    matches!(
        category,
        InteractionCategory::Onboarding
            | InteractionCategory::Help
            | InteractionCategory::Capability
            | InteractionCategory::PurposeSelection
            | InteractionCategory::Troubleshoot
            | InteractionCategory::General
    )
}

fn infer_purpose_label(content: &str) -> &'static str {
    let lower = content.to_lowercase();
    if content.contains("ワクチン") || lower.contains("vaccine") {
        "ワクチン研究"
    } else if content.contains("教材") || content.contains("教育") {
        "教材作成"
    } else if content.contains("症例報告") || content.contains("症例") {
        "症例報告"
    } else if content.contains("研究") || content.contains("論文") {
        "研究データ共有"
    } else {
        "標準"
    }
}

fn policy_summary_for_purpose(content: &str) -> Vec<String> {
    let purpose = infer_purpose_label(content);
    match purpose {
        "ワクチン研究" => vec![
            "氏名・ID・連絡先 → 完全削除".to_string(),
            "日付 → 相対化または月単位へ一般化".to_string(),
            "住所 → 都道府県レベルへ一般化".to_string(),
            "自由記述の固有名詞 → 置換".to_string(),
        ],
        "教材作成" => vec![
            "氏名・ID・連絡先 → 置換".to_string(),
            "日付 → 年月または相対時制へ一般化".to_string(),
            "年齢 → 5歳刻みへ一般化".to_string(),
            "地名・施設名 → 一般化".to_string(),
        ],
        "症例報告" => vec![
            "氏名・ID・連絡先 → 完全削除".to_string(),
            "日付 → 期間関係を保った相対日付へ置換".to_string(),
            "年齢 → 年代または5歳刻みへ一般化".to_string(),
            "地理情報・施設名 → 発表要件に合わせて一般化".to_string(),
        ],
        "研究データ共有" => vec![
            "直接識別子（氏名・ID・連絡先）→ 完全削除".to_string(),
            "準識別子（日付・住所・年齢）→ 再識別リスクを下げる粒度へ一般化".to_string(),
            "自由記述の個人特定要素 → 置換または削除".to_string(),
        ],
        _ => crate::prompts::default_policy_summary(),
    }
}

fn plan_reason_for_purpose(content: &str) -> &'static str {
    match infer_purpose_label(content) {
        "ワクチン研究" => {
            "研究データの再識別リスクを下げつつ、時系列の分析性を残すためです。"
        }
        "教材作成" => {
            "学習に必要な臨床文脈を保ちながら、個人特定につながる情報を一般化するためです。"
        }
        "症例報告" => {
            "発表要件に合わせて識別子を除去し、経過の解釈に必要な情報だけを残すためです。"
        }
        "研究データ共有" => {
            "第三者提供時の再識別リスクを抑えつつ、統計解析に必要な粒度を確保するためです。"
        }
        _ => "標準的な匿名化方針で安全性と可読性のバランスを取るためです。",
    }
}

fn should_force_plan_from_response(
    category: InteractionCategory,
    file_count: usize,
    ai_response: &str,
) -> bool {
    file_count > 0
        && (category == InteractionCategory::PlanCreation || ai_response.contains("匿名化プラン"))
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
        Some(ChatPhase::PlanPresented) | Some(ChatPhase::ExecutionReady) | Some(ChatPhase::Revision)
    );
    if has_plan_flow_context
        && (category == InteractionCategory::General || detect_rule_tuning_intent(last_user_message))
    {
        category = InteractionCategory::Revision;
    }

    if category == InteractionCategory::PlanCreation && file_count > 0 {
        let effective_count = file_count;
        let skill_summary = crate::domain::skills::get_skill_policy_summary(&matching_skills);
        let policy_summary = if !skill_summary.is_empty() {
            skill_summary
        } else {
            policy_summary_for_purpose(last_user_message)
        };
        let bulk_plan = BulkExecutionPlan {
            target_count: effective_count,
            estimated_time_ms: (effective_count as u64) * 50,
            policy_summary,
        };
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

    if bulk_plan.is_none() && should_force_plan_from_response(category, file_count, &ai_response) {
        let effective_count = if file_count > 0 { file_count } else { 1 };
        let skill_summary = crate::domain::skills::get_skill_policy_summary(&matching_skills);
        let policy_summary = if !skill_summary.is_empty() {
            skill_summary
        } else {
            policy_summary_for_purpose(last_user_message)
        };
        bulk_plan = Some(BulkExecutionPlan {
            target_count: effective_count,
            estimated_time_ms: (effective_count as u64) * 50,
            policy_summary,
        });
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
        Some(ChatPhase::PlanPresented) | Some(ChatPhase::ExecutionReady) | Some(ChatPhase::Revision)
    );
    if has_plan_flow_context
        && (category == InteractionCategory::General || detect_rule_tuning_intent(last_user_message))
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
        let skill_summary = crate::domain::skills::get_skill_policy_summary(&matching_skills);
        let policy_summary = if !skill_summary.is_empty() {
            skill_summary
        } else {
            policy_summary_for_purpose(last_user_message)
        };
        let bulk_plan = BulkExecutionPlan {
            target_count: effective_count,
            estimated_time_ms: (effective_count as u64) * 10000,
            policy_summary,
        };
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

        // Extract bullet points from AI response
        let extracted_summary: Vec<String> = ai_response
            .lines()
            .filter(|line| {
                line.trim().starts_with("- ")
                    || line.trim().starts_with("・")
                    || line.trim().starts_with("* ")
            })
            .map(|line| {
                line.trim()
                    .trim_start_matches(|c| c == '-' || c == '*' || c == '・')
                    .trim()
                    .to_string()
            })
            .filter(|s| !s.is_empty())
            .take(5) // Limit to 5 items
            .collect();

        // Priority: 1. Skill-based summary, 2. AI extracted, 3. Default
        let skill_summary = crate::domain::skills::get_skill_policy_summary(&matching_skills);
        let policy_summary = if !skill_summary.is_empty() {
            skill_summary
        } else if !extracted_summary.is_empty() {
            extracted_summary
        } else {
            prompts::default_policy_summary()
        };

        let plan = BulkExecutionPlan {
            target_count: effective_count,
            estimated_time_ms: estimated_time,
            policy_summary,
        };

        let steps = prompts::default_workflow_steps(effective_count > 1);

        (Some(plan), Some(steps))
    } else {
        (None, None)
    };

    if bulk_plan.is_none() && should_force_plan_from_response(category, file_count, &ai_response) {
        let effective_count = if file_count > 0 { file_count } else { 1 };
        let skill_summary = crate::domain::skills::get_skill_policy_summary(&matching_skills);
        let policy_summary = if !skill_summary.is_empty() {
            skill_summary
        } else {
            policy_summary_for_purpose(last_user_message)
        };
        bulk_plan = Some(BulkExecutionPlan {
            target_count: effective_count,
            estimated_time_ms: (effective_count as u64) * 10000,
            policy_summary,
        });
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

        let message = guidance_message_for_state(ChatPhase::Help, 0, false);
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
        let candidates = hint_candidates_for_state(ChatPhase::PurposeSelection, false, 2);
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
