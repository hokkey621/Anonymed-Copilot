use crate::domain::model::AnonPlan;
use crate::infrastructure::gemini_handler::GeminiHandler;
use crate::infrastructure::gemini_handler::ReplacementItem;

#[tauri::command]
pub async fn analyze_text(text: String, task_context: String) -> Result<AnonPlan, String> {
    // Phase 4: Gemini API Anonymization
    let handler = GeminiHandler::new()?;
    let replacements = handler.analyze(&text, &task_context).await?;

    // Convert ReplacementItem to string or specialized structure
    // For MVP, we serialize ReplacementItem to JSON string in AnonPlan.items
    // Ideally AnonPlan should hold formatted objects, but to save refactoring domain/model.rs too much now:
    let items = replacements.iter().map(|r| serde_json::to_string(r).unwrap()).collect();

    Ok(AnonPlan { items })
}

#[tauri::command]
pub fn apply_plan(text: String, plan: AnonPlan) -> Result<String, String> {
    let mut replacements: Vec<ReplacementItem> = plan.items.iter()
        .filter_map(|s| serde_json::from_str(s).ok())
        .collect();

    // Sort by start index descending to replace from end (preserves indices)
    replacements.sort_by(|a, b| b.start.cmp(&a.start));

    let mut processed = text.clone();

    for item in replacements {
        if item.end > processed.len() { continue; } // Safety

        let start = item.start;
        let end = item.end;

        // Simple range replacement using character indices (Rust String is UTF-8 bytes!)
        // IMPORTANT: Gemini indices are likely unicode codepoints or byte offsets.
        // Generative models usually count "characters". We'll assume char indices for now.

        let char_indices: Vec<(usize, char)> = processed.char_indices().collect();
        if start < char_indices.len() && end <= char_indices.len() {
             let byte_start = char_indices[start].0;
             let byte_end = if end < char_indices.len() { char_indices[end].0 } else { processed.len() };

             processed.replace_range(byte_start..byte_end, &item.replacement);
        }
    }

    Ok(processed)
}
