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

pub(crate) fn policy_summary_for_purpose(content: &str) -> Vec<String> {
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

pub(crate) fn extract_summary_from_ai_response(ai_response: &str) -> Vec<String> {
    ai_response
        .lines()
        .filter(|line| {
            line.trim().starts_with("- ")
                || line.trim().starts_with('・')
                || line.trim().starts_with("* ")
        })
        .map(|line| {
            line.trim()
                .trim_start_matches(|c| c == '-' || c == '*' || c == '・')
                .trim()
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .take(5)
        .collect()
}
