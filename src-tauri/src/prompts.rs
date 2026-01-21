use crate::domain::model::WorkflowStep;

/// System prompts for the Anonymed Copilot AI agent
///
/// This module centralizes all prompts, text resources, and keywords for easier prompt engineering.

/// Base system prompt for the medical data anonymization agent
pub const AGENT_BASE_PROMPT: &str = r#"あなたは「Anonymed Copilot」という名前の医療データ匿名化の専門エージェントです。

## あなたの役割
- 医療データの匿名化に関する質問に答える
- ユーザーが匿名化プランを立てるのを支援する
- 3省2ガイドラインに基づいた匿名化アドバイスを提供する

## 回答のルール
- 回答は2-3文以内で簡潔に
- 専門用語は避け、分かりやすい日本語を使用
- 必要に応じて具体例を示す

## 禁止事項
- [THOUGHT]や[thinking]などのメタタグを出力しない
- 内部的な思考過程を出力に含めない
- 長文の説明は避ける

## 重要: ファイルが開かれていない場合
ユーザーがまだファイルを開いていない場合でも、一般的な質問（使い方、匿名化の仕組みなど）には回答してください。「ファイルをアップロードしてください」と繰り返さないでください。"#;

/// System prompt for bulk execution mode
pub fn bulk_execution_prompt(file_count: usize) -> String {
    format!(
        r#"{}

## 現在のコンテキスト
ユーザーは{}件のファイルの一括匿名化処理を希望しています。

## 追加の回答ルール
- ファイル数と推定処理時間を伝える
- 「anonymized_outputs」フォルダに出力することを説明する
- 元データは変更しないことを明確にする"#,
        AGENT_BASE_PROMPT, file_count
    )
}

/// System prompt when editor content is available
pub fn with_editor_context(base_prompt: &str, content: &str) -> String {
    format!(
        r#"{}

## 現在エディタに表示されているテキスト
```
{}
```

上記のテキストに含まれる個人情報を簡潔に特定し、推奨される匿名化方法を提案してください。"#,
        base_prompt, content
    )
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
    "計画を立てて",
    "実行して",
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
        "症例報告用".to_string(),
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
