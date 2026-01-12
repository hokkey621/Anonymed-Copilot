use crate::domain::model::{AnonPlan, AuditLog};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use crate::domain::agent_orchestrator::AgentOrchestrator;
use serde::Serialize;
use tauri::Emitter;
use rayon::prelude::*;
use sha2::{Sha256, Digest};

#[derive(serde::Serialize)]
pub struct BatchResult {
    pub processed_count: usize,
    pub error_count: usize,
    pub logs: Vec<AuditLog>,
}

/// Progress event for bulk execution
#[derive(Clone, Serialize)]
pub struct BulkProgressEvent {
    pub completed: usize,
    pub total: usize,
    pub current_file: String,
    pub step_id: String,
    pub step_status: String,
}

/// Result of a dry run validation
#[derive(Clone, Serialize)]
pub struct DryRunResult {
    pub total_files: usize,
    pub success_count: usize,
    pub error_files: Vec<String>,
}

/// Apply replacement plan to text (no API calls - fast rule-based)
fn apply_plan_to_text(text: &str, plan: &AnonPlan) -> Result<String, String> {
    let mut replacements = plan.replacements.clone();
    replacements.sort_by(|a, b| b.start.cmp(&a.start));

    let mut processed = text.to_string();

    for item in replacements {
        let suggested_start = item.start;
        let original_target = &item.original;

        if processed.get(suggested_start..suggested_start + original_target.len()) == Some(original_target) {
            processed.replace_range(suggested_start..suggested_start + original_target.len(), &item.replacement);
        } else {
            // Fallback: fuzzy search
            let mut best_start = None;
            let mut min_distance = usize::MAX;

            for (found_idx, _) in processed.match_indices(original_target) {
                let distance = (found_idx as isize - suggested_start as isize).unsigned_abs();
                if distance < min_distance {
                    min_distance = distance;
                    best_start = Some(found_idx);
                }
            }

            if let Some(actual_start) = best_start {
                processed.replace_range(actual_start..actual_start + original_target.len(), &item.replacement);
            }
            // If not found, skip this replacement (some files may not have all patterns)
        }
    }

    Ok(processed)
}

/// Calculate SHA-256 hash of content
fn sha256_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Dry run validation - check which files can be processed
#[tauri::command]
pub async fn bulk_dry_run(
    dir_path: String,
) -> Result<DryRunResult, String> {
    let path = Path::new(&dir_path);
    if !path.is_dir() {
        return Err("Path is not a directory".into());
    }

    let entries: Vec<_> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|res| res.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "txt"))
        .collect();

    let total_files = entries.len();
    let mut error_files = Vec::new();

    for entry in &entries {
        let file_path = entry.path();
        if fs::read_to_string(&file_path).is_err() {
            error_files.push(file_path.display().to_string());
        }
    }

    Ok(DryRunResult {
        total_files,
        success_count: total_files - error_files.len(),
        error_files,
    })
}

/// Bulk execute with pre-computed plan (no API calls per file - fast!)
#[tauri::command]
pub async fn bulk_execute(
    app: tauri::AppHandle,
    dir_path: String,
    plan: AnonPlan,
    task_name: String,
) -> Result<BatchResult, String> {
    let path = Path::new(&dir_path);
    if !path.is_dir() {
        return Err("Path is not a directory".into());
    }

    // Create output directory: anonymized_outputs/[task_name]_[timestamp]
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let output_dir = path.join("anonymized_outputs").join(format!("{}_{}", task_name, timestamp));
    fs::create_dir_all(&output_dir).map_err(|e| format!("Failed to create output directory: {}", e))?;

    // Emit: Validation step starting
    let _ = app.emit("bulk-progress", BulkProgressEvent {
        completed: 0,
        total: 0,
        current_file: "".to_string(),
        step_id: "validation".to_string(),
        step_status: "running".to_string(),
    });

    // Collect files
    let entries: Vec<_> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|res| res.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "txt"))
        .collect();

    let total = entries.len();

    // Emit: Validation complete, execution starting
    let _ = app.emit("bulk-progress", BulkProgressEvent {
        completed: 0,
        total,
        current_file: "".to_string(),
        step_id: "validation".to_string(),
        step_status: "completed".to_string(),
    });

    let _ = app.emit("bulk-progress", BulkProgressEvent {
        completed: 0,
        total,
        current_file: "".to_string(),
        step_id: "execution".to_string(),
        step_status: "running".to_string(),
    });

    // Shared counters for parallel progress
    let completed_count = Arc::new(AtomicUsize::new(0));
    let error_count = Arc::new(AtomicUsize::new(0));

    // Process files in parallel using rayon
    let logs: Vec<Option<AuditLog>> = entries.par_iter().map(|entry| {
        let file_path = entry.path();
        let file_name = file_path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Read original content
        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => {
                error_count.fetch_add(1, Ordering::Relaxed);
                return None;
            }
        };

        // Calculate original hash for audit
        let original_hash = sha256_hash(&content);

        // Apply plan (fast rule-based, no API)
        let processed = match apply_plan_to_text(&content, &plan) {
            Ok(p) => p,
            Err(_) => {
                error_count.fetch_add(1, Ordering::Relaxed);
                return None;
            }
        };

        // Calculate processed hash
        let processed_hash = sha256_hash(&processed);

        // Write to output directory
        let output_path = output_dir.join(&file_name);
        if fs::write(&output_path, &processed).is_err() {
            error_count.fetch_add(1, Ordering::Relaxed);
            return None;
        }

        // Update progress
        let current = completed_count.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = app.emit("bulk-progress", BulkProgressEvent {
            completed: current,
            total,
            current_file: file_name.clone(),
            step_id: "execution".to_string(),
            step_status: "running".to_string(),
        });

        // Create audit log
        let applied_rules: Vec<String> = plan.replacements.iter()
            .map(|r| format!("{} -> {} ({})", r.original, r.replacement, r.reason))
            .collect();

        Some(AuditLog {
            task_context: task_name.clone(),
            applied_rules,
            user_overrides: vec![],
            privacy_score: 0.9,
            data_hash: format!("orig:{} -> anon:{}", original_hash, processed_hash),
            timestamp: chrono::Utc::now().to_rfc3339(),
            signature: None,
        })
    }).collect();

    // Emit: Execution complete
    let _ = app.emit("bulk-progress", BulkProgressEvent {
        completed: total,
        total,
        current_file: "".to_string(),
        step_id: "execution".to_string(),
        step_status: "completed".to_string(),
    });

    // Emit: Audit step
    let _ = app.emit("bulk-progress", BulkProgressEvent {
        completed: total,
        total,
        current_file: "".to_string(),
        step_id: "audit".to_string(),
        step_status: "running".to_string(),
    });

    let valid_logs: Vec<AuditLog> = logs.into_iter().flatten().collect();
    let final_error_count = error_count.load(Ordering::Relaxed);

    // Emit: Audit complete
    let _ = app.emit("bulk-progress", BulkProgressEvent {
        completed: total,
        total,
        current_file: output_dir.display().to_string(),
        step_id: "audit".to_string(),
        step_status: "completed".to_string(),
    });

    Ok(BatchResult {
        processed_count: valid_logs.len(),
        error_count: final_error_count,
        logs: valid_logs,
    })
}

#[tauri::command]
pub async fn process_bulk(
    app: tauri::AppHandle,
    dir_path: String,
    model_version_hash: String, // Traceability
) -> Result<BatchResult, String> {
    let path = Path::new(&dir_path);
    if !path.is_dir() {
        return Err("Path is not a directory".into());
    }

    // 1. Initialize Orchestrator
    let orchestrator = AgentOrchestrator::new()?;

    // 2. List files
    let entries: Vec<_> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|res| res.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "txt")) // Only .txt for now
        .collect();

    // 3. Process Loop (Async Sequential for Gemini/API limits)
    let mut logs = Vec::new();
    let mut error_count = 0;

    for entry in entries {
        let file_path = entry.path();

        // Read file content directly
        let content = match fs::read_to_string(&file_path) {
             Ok(c) => c,
             Err(_) => {
                 error_count += 1;
                 continue;
             }
        };

        // Analyze with Orchestrator
        // We use the same task context format as in interactive mode
        let task_context = format!("Bulk Anonymization (Trace: {})", model_version_hash);
        let analysis_result = orchestrator.run_anonymization_pipeline(&app, &content, &task_context).await;

        match analysis_result {
            Ok(plan) => {
                 let applied_rules: Vec<String> = plan.replacements.iter()
                    .map(|r| format!("{} -> {} ({})", r.original, r.replacement, r.reason))
                    .collect();

                let log = AuditLog {
                    task_context: task_context.clone(),
                    applied_rules,
                    user_overrides: vec![],
                    privacy_score: 0.8, // Mock
                    data_hash: format!("{:x}", md5::compute(content.as_bytes())), // Simple hash for ID
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    signature: None,
                };
                logs.push(log);
            },
            Err(e) => {
                println!("Error processing file {}: {}", file_path.display(), e);
                error_count += 1;
            }
        }
    }

    Ok(BatchResult {
        processed_count: logs.len(),
        error_count,
        logs,
    })
}
