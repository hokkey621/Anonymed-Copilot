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

        let start = item.start;
        let end = item.end;
        let original_target = &item.original;

        // Validation: Verify content at [start..end] matches 'original'
        // We assume UTF-8 byte indices first
        if end > processed.len() || start > end {
             // Fallback or Error
             // Try char indices?
             return Err(format!("Index out of bounds or invalid: {}..{} for len {}", start, end, processed.len()));
        }

        let slice = &processed[start..end];
        if slice != original_target {
             // Verification Failed
             // Try to be smart? For now, strict error as requested.
             // Maybe it resembles?
             return Err(format!(
                 "Verification Failed: Expected '{}' at {}..{}, found '{}'. This suggests index misalignment.",
                 original_target, start, end, slice
             ));
        }

        // Apply Replacement
        processed.replace_range(start..end, &item.replacement);
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
