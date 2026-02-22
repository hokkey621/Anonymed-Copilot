use crate::commands::chat_intent::{
    detect_anonymization_intent, detect_capability_intent, detect_help_intent,
    detect_revision_intent, detect_troubleshoot_intent, InteractionCategory,
};
use crate::commands::chat_types::ChatPhase;

pub(crate) fn infer_next_state(
    previous_state: Option<ChatPhase>,
    last_user_message: &str,
    file_count: usize,
    has_purpose: bool,
    is_bulk_request: bool,
    plan_created: bool,
) -> (ChatPhase, &'static str) {
    let has_plan_flow_context = matches!(
        previous_state,
        Some(ChatPhase::PlanPresented)
            | Some(ChatPhase::ExecutionReady)
            | Some(ChatPhase::Revision)
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

pub(crate) fn suggestions_for_state(
    state: ChatPhase,
    has_purpose: bool,
    file_count: usize,
) -> Vec<String> {
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

pub(crate) fn hint_candidates_for_state(
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

    if has_purpose && matches!(hint_id, "create_plan" | "create_plan_standard" | "run_plan") {
        score += 8;
    }

    score
}

pub(crate) fn generate_contextual_suggestions(
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

pub(crate) fn guidance_message_for_state(
    state: ChatPhase,
    file_count: usize,
    has_purpose: bool,
) -> String {
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
            "すみません。匿名化以外のご相談には対応していません。匿名化のお手伝いをしましょうか。"
                .to_string()
        }
        _ => "続けて指示をお願いします。".to_string(),
    }
}

pub(crate) fn guidance_message_for_category(
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

pub(crate) fn should_use_template_response(category: InteractionCategory) -> bool {
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
