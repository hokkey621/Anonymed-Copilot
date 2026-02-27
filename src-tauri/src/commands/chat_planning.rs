use crate::commands::chat_intent::InteractionCategory;

pub(crate) fn infer_purpose_label(content: &str) -> &'static str {
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

pub(crate) fn plan_reason_for_purpose(content: &str) -> &'static str {
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

pub(crate) fn should_force_plan_from_response(
    category: InteractionCategory,
    file_count: usize,
    ai_response: &str,
) -> bool {
    file_count > 0
        && (category == InteractionCategory::PlanCreation || ai_response.contains("匿名化プラン"))
}
