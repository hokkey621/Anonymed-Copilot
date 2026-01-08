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

    // Check if indices are likely char indices or byte indices
    // We assume Gemini returns CHAR indices often, but we asked for byte.
    // We will verify.

    for item in replacements {
        // Since we are replacing from the end, indices of *earlier* parts are valid for the *original* string (or rather, consistent relative to start).
        // Wait, if we modify the string in place, and we go from back to front:
        // Text: "Hello World" (Len 11)
        // Apply: "World" -> "Earth" at 6..11
        // "Hello Earth"
        // Apply: "Hello" -> "Hi" at 0..5
        // "Hi Earth"
        // Indices are preserved for upstream items. Correct.

        let suggested_start = item.start;
        let original_target = &item.original;

        // Robust Index Finding:
        // Gemini often miscounts indices (mixing chars vs bytes).
        // Instead of blindly trusting `start`, we find all occurrences of `original`
        // and pick the one geometrically closest to `suggested_start`.

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

        // Optional: Warn if deviation is huge?
        // For now, trust the closest match.

        // Check for overlap collisions if needed (but we are replacing ranges,
        // sorting by start desc might be tricky if indices shift drastically).
        // Actually, if we use find-closest strategy, we should probably re-sort or handle overlaps.
        // But since we process in reverse intended order, finding the *closest* to the intended index is usually safe.
        // Wait, if we use `match_indices`, we get byte indices.

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
