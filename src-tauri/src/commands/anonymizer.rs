use crate::domain::model::AnonPlan;
use crate::infrastructure::gemini_handler::GeminiHandler;
use crate::infrastructure::gemini_handler::ReplacementItem;
use zeroize::Zeroize;

#[tauri::command]
pub async fn analyze_text(text: String, task_context: String) -> Result<AnonPlan, String> {
    // Phase 4: Gemini API Anonymization
    let handler = GeminiHandler::new()?;
    let replacements = handler.analyze(&text, &task_context).await?;

    // Serialize items to JSON strings for AnonPlan
    let items = replacements.iter().map(|r| serde_json::to_string(r).unwrap()).collect();

    Ok(AnonPlan { items })
}

#[tauri::command]
pub fn apply_plan(mut text: String, plan: AnonPlan) -> Result<String, String> {
    let mut replacements: Vec<ReplacementItem> = plan.items.iter()
        .filter_map(|s| serde_json::from_str(s).ok())
        .collect();

    // 1. Sort by start index descending (Reverse Order Strategy)
    replacements.sort_by(|a, b| b.start.cmp(&a.start));

    let mut processed = text.clone();

    for item in replacements {
        let suggested_start = item.start;
        let original_target = &item.original;

        // Find closest matching occurrence (handles Gemini index misalignment)

        let mut best_start = None;
        let mut min_distance = usize::MAX;

        for (found_idx, _) in processed.match_indices(original_target) {
            let distance = if found_idx > suggested_start {
                found_idx - suggested_start
            } else {
                suggested_start - found_idx
            };

            if distance < min_distance {
                min_distance = distance;
                best_start = Some(found_idx);
            }
        }

        let actual_start = match best_start {
            Some(idx) => idx,
            None => {
                 return Err(format!("Could not find original text '{}' in document.", original_target));
            }
        };

        let actual_end = actual_start + original_target.len();
        processed.replace_range(actual_start..actual_end, &item.replacement);
    }

    // Security: Zeroize original text buffer
    // Rust String doesn't implement Zeroize directly, but Vec<u8> does.
    unsafe { text.as_mut_vec().zeroize(); }

    Ok(processed)
}

#[tauri::command]
pub async fn chat_with_ai(message: String) -> Result<String, String> {
    let handler = GeminiHandler::new()?;
    handler.chat(&message).await
}
