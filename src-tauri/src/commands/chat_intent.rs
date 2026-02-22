#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InteractionCategory {
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

pub(crate) fn detect_purpose_in_text(content: &str) -> bool {
    use crate::prompts::PURPOSE_KEYWORDS;
    PURPOSE_KEYWORDS.iter().any(|kw| content.contains(kw))
}

pub(crate) fn detect_planning_intent_text(content: &str) -> bool {
    use crate::prompts::EXECUTION_KEYWORDS;
    EXECUTION_KEYWORDS.iter().any(|kw| content.contains(kw))
}

pub(crate) fn detect_anonymization_intent(content: &str) -> bool {
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

pub(crate) fn detect_revision_intent(content: &str) -> bool {
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

pub(crate) fn detect_help_intent(content: &str) -> bool {
    let lower = content.to_lowercase();
    content.contains("使い方")
        || content.contains("ヘルプ")
        || content.contains("どうやって")
        || content.contains("開き方")
        || lower.contains("help")
}

pub(crate) fn detect_capability_intent(content: &str) -> bool {
    content.contains("今できること")
        || content.contains("何ができる")
        || content.contains("次に何をすれば")
}

pub(crate) fn detect_troubleshoot_intent(content: &str) -> bool {
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

pub(crate) fn detect_execute_intent(content: &str) -> bool {
    let normalized = content.split_whitespace().collect::<String>();
    normalized == "実行"
        || normalized == "この内容で実行"
        || normalized == "処理を開始"
        || normalized.ends_with("を実行")
}

pub(crate) fn detect_rule_tuning_intent(content: &str) -> bool {
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

pub(crate) fn infer_interaction_category(
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
