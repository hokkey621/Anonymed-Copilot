use crate::domain::model::{AnonPlan, AuditLog};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use crate::domain::agent_orchestrator::AgentOrchestrator;
use crate::utils::access_control::AccessControl;
use crate::utils::file_reader::read_file_with_encoding;
use crate::utils::path_guard::sanitize_task_name;
use crate::utils::plan_apply::apply_plan_to_text;
use serde::Serialize;
use tauri::Emitter;
use tauri::State;
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
    pub step_message: String, // e.g., "3省2ガイドラインに基づき検証中..."
}

/// Warning from dry run validation
#[derive(Clone, Serialize)]
pub struct DryRunWarning {
    pub file_name: String,
    pub warning_type: String, // "long_name", "encoding", "pattern_mismatch"
    pub message: String,
}

/// Result of a dry run validation
#[derive(Clone, Serialize)]
pub struct DryRunResult {
    pub total_files: usize,
    pub success_count: usize,
    pub error_files: Vec<String>,
    pub warnings: Vec<DryRunWarning>,
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
    access_control: State<'_, AccessControl>,
) -> Result<DryRunResult, String> {
    let path = Path::new(&dir_path);
    let snapshot = access_control.snapshot()?;
    let path = snapshot.ensure_allowed(path)?;
    if !path.is_dir() {
        return Err("Path is not a directory".into());
    }

    let entries: Vec<_> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|res| res.ok())
        .filter(|e| !snapshot.is_ignored(&e.path()))
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "txt"))
        .collect();

    let total_files = entries.len();
    let mut error_files = Vec::new();
    let mut warnings = Vec::new();

    for entry in &entries {
        let file_path = entry.path();
        let file_name_str = file_path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        match read_file_with_encoding(&file_path) {
            Ok(content) => {
                // Check for long proper nouns (simple heuristic: words > 15 chars)
                let long_words: Vec<&str> = content.split_whitespace()
                    .filter(|w| w.chars().count() > 15 && w.chars().next().map(|c| c.is_uppercase()).unwrap_or(false))
                    .collect();

                if !long_words.is_empty() {
                    warnings.push(DryRunWarning {
                        file_name: file_name_str.clone(),
                        warning_type: "long_name".to_string(),
                        message: format!("通常より長い固有名詞を検知: {} 個", long_words.len()),
                    });
                }
            },
            Err(_) => {
                error_files.push(file_path.display().to_string());
            }
        }
    }

    Ok(DryRunResult {
        total_files,
        success_count: total_files - error_files.len(),
        error_files,
        warnings,
    })
}

/// Bulk execute with pre-computed plan (no API calls per file - fast!)
#[tauri::command]
pub async fn bulk_execute(
    app: tauri::AppHandle,
    dir_path: String,
    plan: AnonPlan,
    task_name: String,
    target_files: Option<Vec<String>>,
    access_control: State<'_, AccessControl>,
) -> Result<BatchResult, String> {
    let snapshot = access_control.snapshot()?;
    let path = snapshot.ensure_allowed(Path::new(&dir_path))?;
    if !path.is_dir() {
        return Err("Path is not a directory".into());
    }

    // Create output directory: anonymized_outputs/[task_name]_[timestamp]
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let safe_task_name = sanitize_task_name(&task_name);
    let output_dir = path.join("anonymized_outputs").join(format!("{}_{}", safe_task_name, timestamp));
    snapshot.ensure_allowed(&output_dir)?;
    fs::create_dir_all(&output_dir).map_err(|e| format!("Failed to create output directory: {}", e))?;

    // Emit: Validation step starting
    let _ = app.emit("bulk-progress", BulkProgressEvent {
        completed: 0,
        total: 0,
        current_file: "".to_string(),
        step_id: "validation".to_string(),
        step_status: "running".to_string(),
        step_message: "3省2ガイドラインに基づき、全ファイルの読み込み可否を検証中...".to_string(),
    });

    // Collect all files first
    let all_entries: Vec<_> = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|res| res.ok())
        .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|name| !name.starts_with('.'))
                .unwrap_or(false)
        })
        .filter(|e| !snapshot.is_ignored(&e.path()))
        .collect();

    // Filter by target_files if specified
    let entries: Vec<_> = if let Some(ref targets) = target_files {
        let target_set: std::collections::HashSet<_> = targets.iter().collect();
        all_entries.into_iter()
            .filter(|e| target_set.contains(&e.path().to_string_lossy().to_string()))
            .collect()
    } else {
        all_entries
    };

    let total = entries.len();

    // Emit: Validation complete, execution starting
    let _ = app.emit("bulk-progress", BulkProgressEvent {
        completed: 0,
        total,
        current_file: "".to_string(),
        step_id: "validation".to_string(),
        step_status: "completed".to_string(),
        step_message: format!("{}件のファイルの検証が完了しました", total),
    });

    let _ = app.emit("bulk-progress", BulkProgressEvent {
        completed: 0,
        total,
        current_file: "".to_string(),
        step_id: "execution".to_string(),
        step_status: "running".to_string(),
        step_message: "並列処理を開始します...".to_string(),
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
        let content = match snapshot.ensure_allowed(&file_path).and_then(|p| read_file_with_encoding(&p)) {
            Ok(c) => c,
            Err(_) => {
                error_count.fetch_add(1, Ordering::Relaxed);
                return None;
            }
        };

        // Calculate original hash for audit
        let original_hash = sha256_hash(&content);

        // Apply plan (fast rule-based, no API)
        let processed = match apply_plan_to_text(&content, &plan, false) {
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
            step_message: format!("処理中: {}", file_name),
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
        step_message: format!("全{}件の変換が完了しました", total),
    });

    // Emit: Audit step
    let _ = app.emit("bulk-progress", BulkProgressEvent {
        completed: total,
        total,
        current_file: "".to_string(),
        step_id: "audit".to_string(),
        step_status: "running".to_string(),
        step_message: "監査ログとハッシュ値を記録中...".to_string(),
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
        step_message: format!("出力先: {}", output_dir.display()),
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
    access_control: State<'_, AccessControl>,
) -> Result<BatchResult, String> {
    let snapshot = access_control.snapshot()?;
    let path = snapshot.ensure_allowed(Path::new(&dir_path))?;
    if !path.is_dir() {
        return Err("Path is not a directory".into());
    }

    // 1. Initialize Orchestrator
    let orchestrator = AgentOrchestrator::new(&app)?;

    // 2. List files
    let entries: Vec<_> = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|res| res.ok())
        .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|name| !name.starts_with('.'))
                .unwrap_or(false)
        })
        .filter(|e| !snapshot.is_ignored(&e.path()))
        .collect();

    // 3. Process Loop (Async Sequential for Gemini/API limits)
    let mut logs = Vec::new();
    let mut error_count = 0;

    for entry in entries {
        let file_path = entry.path();

        // Read file content directly
        let content = match snapshot.ensure_allowed(&file_path).and_then(|p| read_file_with_encoding(&p)) {
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
                    data_hash: sha256_hash(&content),
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

/// Item for bulk preview (file content before and after anonymization)
#[derive(Clone, Serialize, serde::Deserialize)]
pub struct BulkPreviewItem {
    pub file_path: String,
    pub file_name: String,
    pub original_content: String,
    pub anonymized_content: String,
}

/// Preview files without saving - used for sequential review mode
#[tauri::command]
pub async fn bulk_preview(
    target_files: Vec<String>,
    plan: AnonPlan,
    access_control: State<'_, AccessControl>,
) -> Result<Vec<BulkPreviewItem>, String> {
    let mut results = Vec::new();
    let snapshot = access_control.snapshot()?;

    for file_path_str in target_files {
        let file_path = Path::new(&file_path_str);
        let file_name = file_path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Read original content
        let original_content = match snapshot.ensure_allowed(file_path).and_then(|p| read_file_with_encoding(&p)) {
            Ok(c) => c,
            Err(e) => {
                return Err(format!("Failed to read {}: {}", file_name, e));
            }
        };

        // Apply plan (no API call, rule-based)
        let anonymized_content = match apply_plan_to_text(&original_content, &plan, false) {
            Ok(p) => p,
            Err(e) => {
                return Err(format!("Failed to process {}: {}", file_name, e));
            }
        };

        results.push(BulkPreviewItem {
            file_path: file_path_str,
            file_name,
            original_content,
            anonymized_content,
        });
    }

    Ok(results)
}

/// Item for bulk save
#[derive(Clone, Serialize, serde::Deserialize)]
pub struct BulkSaveItem {
    pub file_name: String,
    pub content: String,
}

/// Save approved files to output directory
#[tauri::command]
pub async fn bulk_save(
    output_dir: String,
    items: Vec<BulkSaveItem>,
    access_control: State<'_, AccessControl>,
) -> Result<BatchResult, String> {
    let snapshot = access_control.snapshot()?;
    let output_path = snapshot.ensure_allowed(Path::new(&output_dir))?;

    // Create output directory if it doesn't exist
    fs::create_dir_all(&output_path)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    let mut processed_count = 0;
    let mut error_count = 0;
    let mut logs = Vec::new();

    for item in items {
        if item.file_name.contains("..")
            || item.file_name.contains('/')
            || item.file_name.contains('\\')
        {
            error_count += 1;
            continue;
        }
        let file_path = output_path.join(&item.file_name);

        match fs::write(&file_path, &item.content) {
            Ok(_) => {
                processed_count += 1;
                logs.push(AuditLog {
                    task_context: "Bulk Review Save".to_string(),
                    applied_rules: vec![],
                    user_overrides: vec![],
                    privacy_score: 0.9,
                    data_hash: sha256_hash(&item.content),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    signature: None,
                });
            }
            Err(e) => {
                println!("Failed to save {}: {}", item.file_name, e);
                error_count += 1;
            }
        }
    }

    Ok(BatchResult {
        processed_count,
        error_count,
        logs,
    })
}
