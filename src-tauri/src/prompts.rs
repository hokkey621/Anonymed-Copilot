use crate::domain::model::WorkflowStep;

/// System prompts for the Anonymed Copilot AI agent
///
/// This module centralizes all prompts, text resources, and keywords for easier prompt engineering.

/// Base system prompt for the medical data anonymization agent
pub const AGENT_BASE_PROMPT: &str = include_str!("../prompts/agent_base_prompt.md");
const BULK_EXECUTION_SUFFIX: &str = include_str!("../prompts/bulk_execution_suffix.md");
const EDITOR_CONTEXT_SUFFIX: &str = include_str!("../prompts/editor_context_suffix.md");
const STRATEGY_PLANNER_PROMPT: &str = include_str!("../prompts/strategy_planner_system_prompt.md");
const STRATEGY_EXECUTOR_PROMPT: &str =
    include_str!("../prompts/strategy_executor_system_prompt.md");
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

/// Executor prompt for anonymization replacement extraction
pub fn strategy_executor_prompt(
    task_context: &str,
    date_handling: &str,
    name_handling: &str,
    specific_instructions: &str,
) -> String {
    STRATEGY_EXECUTOR_PROMPT
        .replace("{{task_context}}", task_context)
        .replace("{{date_handling}}", date_handling)
        .replace("{{name_handling}}", name_handling)
        .replace("{{specific_instructions}}", specific_instructions)
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
        "氏名 → 削除".to_string(),
        "年齢 → 5歳刻み".to_string(),
        "日付 → 月単位".to_string(),
        "住所 → 都道府県のみ".to_string(),
        "病名 → 一般化".to_string(),
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

/// Suggestion chips
pub fn initial_suggestions() -> Vec<String> {
    vec!["匿名化したい".to_string(), "使い方が知りたい".to_string()]
}

pub fn help_suggestions() -> Vec<String> {
    vec!["ファイルを開きたい".to_string(), "匿名化を開始".to_string()]
}

pub fn bulk_options() -> Vec<String> {
    vec!["処理を開始".to_string(), "キャンセル".to_string()]
}

pub fn create_plan_options() -> Vec<String> {
    vec!["変更内容を確認".to_string(), "もう少し詳しく".to_string()]
}

pub fn anonymization_purpose_options() -> Vec<String> {
    vec![
        "ワクチン開発用".to_string(),
        "教材作成用".to_string(),
        "匿名化プランを作成 (標準)".to_string(),
    ]
}

pub fn default_suggestions() -> Vec<String> {
    vec![
        "内容を確認する".to_string(),
        "詳しく教えて".to_string(),
        "匿名化プランを作成".to_string(),
    ]
}

pub fn plan_created_suggestions() -> Vec<String> {
    vec![
        "変更を適用".to_string(),
        "修正したい".to_string(),
        "詳しく説明して".to_string(),
    ]
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
