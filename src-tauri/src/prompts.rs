use crate::domain::model::WorkflowStep;

/// System prompts for the Anonymed Copilot AI agent
///
/// This module centralizes all prompts, text resources, and keywords for easier prompt engineering.

/// Base system prompt for the medical data anonymization agent
pub const AGENT_BASE_PROMPT: &str = include_str!("../prompts/agent_base_prompt.md");
const BULK_EXECUTION_SUFFIX: &str = include_str!("../prompts/bulk_execution_suffix.md");
const EDITOR_CONTEXT_SUFFIX: &str = include_str!("../prompts/editor_context_suffix.md");
const STRATEGY_PLANNER_PROMPT: &str = include_str!("../prompts/strategy_planner_system_prompt.md");
const STRATEGY_EXECUTOR_LOCAL_FAST_PROMPT: &str =
    include_str!("../prompts/strategy_executor_local_fast_system_prompt.md");

/// System prompt for bulk execution mode
pub fn bulk_execution_prompt(file_count: usize) -> String {
    let suffix = BULK_EXECUTION_SUFFIX.replace("{{file_count}}", &file_count.to_string());
    format!("{}\n\n{}", AGENT_BASE_PROMPT.trim(), suffix.trim())
}

/// System prompt when editor content is available
pub fn with_editor_context(base_prompt: &str, content: &str) -> String {
    let max_chars = 4000usize;
    let content_chars = content.chars().count();
    let clipped = if content_chars > max_chars {
        let excerpt = content.chars().take(max_chars).collect::<String>();
        format!(
            "{}\n\n(省略: 全{}文字のうち先頭{}文字を表示)",
            excerpt, content_chars, max_chars
        )
    } else {
        content.to_string()
    };

    let suffix = EDITOR_CONTEXT_SUFFIX.replace("{{editor_content}}", clipped.as_str());
    format!("{}\n\n{}", base_prompt.trim(), suffix.trim())
}

/// Planner prompt for anonymization strategy generation
pub fn strategy_planner_prompt() -> &'static str {
    STRATEGY_PLANNER_PROMPT
}

/// Executor prompt specialized for local Gemma fast mode
pub fn strategy_executor_local_fast_prompt(
    task_context: &str,
    date_handling: &str,
    name_handling: &str,
    specific_instructions: &str,
) -> String {
    STRATEGY_EXECUTOR_LOCAL_FAST_PROMPT
        .replace("{{task_context}}", task_context)
        .replace("{{date_handling}}", date_handling)
        .replace("{{name_handling}}", name_handling)
        .replace("{{specific_instructions}}", specific_instructions)
}

/// Default anonymization policy summary
pub fn default_policy_summary() -> Vec<String> {
    vec![
        "患者本人の氏名 → **** で置換".to_string(),
        "医療従事者・家族・関係者の氏名 → **** で置換".to_string(),
        "病院/診療所/施設の固有名詞 → **** で置換".to_string(),
        "地名・住所の固有名詞 → **** で置換".to_string(),
        "具体的な日付・時刻・和暦表現 → **** で置換".to_string(),
        "年齢表現 → **** で置換".to_string(),
        "電話番号・個人番号（マイナンバー等） → **** で置換".to_string(),
    ]
}

/// Keywords for intent detection
pub const BULK_KEYWORDS: &[&str] = &[
    "全件",
    "全て",
    "すべて",
    "一括",
    "バルク",
    "まとめて",
    "apply to all",
    "bulk",
    "all files",
    "batch",
];

pub const PURPOSE_KEYWORDS: &[&str] = &[
    "ワクチン",
    "教材",
    "教育",
    "症例報告",
    "研究",
    "開発用",
    "作成用",
    "学会",
    "論文",
    "公開",
    "データ分析",
    // "Standard" fallback can be handled by "そのままで" or "標準"
    "標準",
    "そのまま",
];

pub const EXECUTION_KEYWORDS: &[&str] = &[
    "実行",
    "開始",
    "やって",
    "お願いします",
    "プラン",
    "計画",
    "匿名化して",
    "匿名化を実行",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HintCandidate {
    pub id: &'static str,
    pub label: &'static str,
}

impl HintCandidate {
    pub const fn new(id: &'static str, label: &'static str) -> Self {
        Self { id, label }
    }
}

pub fn discovery_hint_candidates_without_files() -> Vec<HintCandidate> {
    vec![
        HintCandidate::new("open_file", "ファイルを開く"),
        HintCandidate::new("open_folder", "フォルダを開く"),
        HintCandidate::new("show_usage", "使い方を教えて"),
        HintCandidate::new("ask_capability", "今できることを教えて"),
        HintCandidate::new("show_shortcut", "最短の操作を教えて"),
    ]
}

pub fn discovery_hint_candidates_with_files() -> Vec<HintCandidate> {
    vec![
        HintCandidate::new("create_plan", "匿名化プランを作成"),
        HintCandidate::new("create_plan_standard", "標準ルールで作成"),
        HintCandidate::new("check_targets", "処理対象を確認"),
        HintCandidate::new("ask_purpose", "利用目的を選ぶ"),
        HintCandidate::new("show_shortcut", "最短の操作を教えて"),
    ]
}

pub fn help_hint_candidates(file_count: usize) -> Vec<HintCandidate> {
    if file_count == 0 {
        vec![
            HintCandidate::new("open_file", "ファイルを開く"),
            HintCandidate::new("check_targets", "処理対象を確認"),
            HintCandidate::new("create_plan", "匿名化プランを作成"),
            HintCandidate::new("show_usage", "使い方を教えて"),
            HintCandidate::new("show_shortcut", "最短の操作を教えて"),
        ]
    } else {
        vec![
            HintCandidate::new("check_targets", "処理対象を確認"),
            HintCandidate::new("create_plan", "匿名化プランを作成"),
            HintCandidate::new("create_plan_standard", "標準ルールで作成"),
            HintCandidate::new("ask_purpose", "利用目的を選ぶ"),
            HintCandidate::new("show_shortcut", "最短の操作を教えて"),
        ]
    }
}

pub fn purpose_hint_candidates() -> Vec<HintCandidate> {
    vec![
        HintCandidate::new("purpose_vaccine", "ワクチン研究用"),
        HintCandidate::new("purpose_education", "教材作成用"),
        HintCandidate::new("purpose_case_report", "症例報告用"),
        HintCandidate::new("purpose_research", "研究データ共有用"),
        HintCandidate::new("purpose_standard", "標準ルールで作成"),
    ]
}

pub fn plan_hint_candidates() -> Vec<HintCandidate> {
    vec![
        HintCandidate::new("run_plan", "この内容で実行"),
        HintCandidate::new("revise_rules", "一部ルールを修正"),
        HintCandidate::new("explain_plan", "変更点を説明して"),
        HintCandidate::new("revise_date", "日付ルールを調整"),
        HintCandidate::new("revise_age", "年齢ルールを調整"),
    ]
}

pub fn revision_hint_candidates() -> Vec<HintCandidate> {
    vec![
        HintCandidate::new("revise_date", "日付ルールを調整"),
        HintCandidate::new("revise_age", "年齢ルールを調整"),
        HintCandidate::new("revise_name", "氏名ルールを調整"),
        HintCandidate::new("rerun", "修正して再実行"),
        HintCandidate::new("show_diff", "変更点を説明して"),
    ]
}

pub fn troubleshoot_hint_candidates() -> Vec<HintCandidate> {
    vec![
        HintCandidate::new("show_error", "エラー原因を確認"),
        HintCandidate::new("check_settings", "設定を見直す"),
        HintCandidate::new("retry", "修正して再実行"),
        HintCandidate::new("check_ollama", "Ollama接続を確認"),
        HintCandidate::new("switch_model", "モデルを変更する"),
    ]
}

pub fn off_topic_hint_candidates() -> Vec<HintCandidate> {
    vec![
        HintCandidate::new("create_plan", "匿名化プランを作成"),
        HintCandidate::new("check_targets", "処理対象を確認"),
        HintCandidate::new("show_usage", "使い方を教えて"),
        HintCandidate::new("ask_capability", "今できることを教えて"),
    ]
}

/// Suggestion chips
pub fn initial_suggestions() -> Vec<String> {
    vec!["匿名化したい".to_string(), "使い方が知りたい".to_string()]
}

pub fn help_suggestions() -> Vec<String> {
    vec![
        "ファイルを開く".to_string(),
        "選択ファイルを確認".to_string(),
    ]
}

pub fn bulk_options() -> Vec<String> {
    vec!["処理を開始".to_string(), "キャンセル".to_string()]
}

pub fn create_plan_options() -> Vec<String> {
    discovery_hint_candidates_with_files()
        .into_iter()
        .take(3)
        .map(|c| c.label.to_string())
        .collect()
}

pub fn anonymization_purpose_options() -> Vec<String> {
    purpose_hint_candidates()
        .into_iter()
        .take(3)
        .map(|c| c.label.to_string())
        .collect()
}

pub fn default_suggestions() -> Vec<String> {
    vec![
        "匿名化プランを作成".to_string(),
        "標準ルールで作成".to_string(),
        "処理対象を確認".to_string(),
    ]
}

pub fn plan_created_suggestions() -> Vec<String> {
    plan_hint_candidates()
        .into_iter()
        .take(3)
        .map(|c| c.label.to_string())
        .collect()
}

pub fn revision_suggestions() -> Vec<String> {
    revision_hint_candidates()
        .into_iter()
        .take(3)
        .map(|c| c.label.to_string())
        .collect()
}

/// Default workflow steps
pub fn default_workflow_steps(parallel_execution: bool) -> Vec<WorkflowStep> {
    vec![
        WorkflowStep {
            id: "validation".to_string(),
            label: "Validation (Dry Run)".to_string(),
            status: "pending".to_string(),
        },
        WorkflowStep {
            id: "execution".to_string(),
            label: if parallel_execution {
                "Parallel Execution".to_string()
            } else {
                "Execution".to_string()
            },
            status: "pending".to_string(),
        },
        WorkflowStep {
            id: "audit".to_string(),
            label: "Audit Log Generation".to_string(),
            status: "pending".to_string(),
        },
    ]
}
