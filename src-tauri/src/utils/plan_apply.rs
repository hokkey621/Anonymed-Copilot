use crate::domain::model::AnonPlan;

pub fn apply_plan_to_text(text: &str, plan: &AnonPlan, error_on_missing: bool) -> Result<String, String> {
    let mut replacements = plan.replacements.clone();
    replacements.sort_by(|a, b| b.start.cmp(&a.start));

    let mut processed = text.to_string();

    for item in replacements {
        let suggested_start = item.start;
        let original_target = &item.original;

        if processed.get(suggested_start..suggested_start + original_target.len()) == Some(original_target) {
            processed.replace_range(suggested_start..suggested_start + original_target.len(), &item.replacement);
        } else {
            let mut best_start = None;
            let mut min_distance = usize::MAX;

            for (found_idx, _) in processed.match_indices(original_target) {
                let distance = (found_idx as isize - suggested_start as isize).unsigned_abs();
                if distance < min_distance {
                    min_distance = distance;
                    best_start = Some(found_idx);
                }
            }

            match best_start {
                Some(actual_start) => {
                    processed.replace_range(actual_start..actual_start + original_target.len(), &item.replacement);
                }
                None => {
                    if error_on_missing {
                        return Err(format!("Could not find original text '{}' in document.", original_target));
                    }
                }
            }
        }
    }

    Ok(processed)
}
