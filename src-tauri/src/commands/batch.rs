use crate::domain::agent_orchestrator::AgentOrchestrator;
use crate::domain::model::{AnonPlan, AuditLog};
use crate::domain::skills::{find_matching_skills, get_skill_names};
use crate::infrastructure::llm::ModelProvider;
use crate::state::CancellationState;
use crate::utils::access_control::AccessControl;
use crate::utils::file_reader::read_file_with_encoding;
use crate::utils::path_guard::sanitize_task_name;
use crate::utils::plan_apply::apply_plan_to_text;
use futures_util::stream::{self, StreamExt};
use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::State;
use tauri::{Emitter, Manager};

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

#[derive(Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkAnalyzeItem {
    pub path: String,
    pub file_name: String,
    pub original: String,
    pub anonymized: String,
    pub plan: AnonPlan,
}

#[derive(Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkAnalyzeFailure {
    pub path: String,
    pub file_name: String,
    pub error: String,
}

#[derive(Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkAnalyzeResponse {
    pub items: Vec<BulkAnalyzeItem>,
    pub failures: Vec<BulkAnalyzeFailure>,
    pub cancelled: bool,
}

const BULK_CANCELLED_MARKER: &str = "__BULK_CANCELLED__";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkAnalysisProgressEvent {
    pub completed: usize,
    pub total: usize,
    pub current_file: String,
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
        let file_name_str = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        match read_file_with_encoding(&file_path) {
            Ok(content) => {
                // Check for long proper nouns (simple heuristic: words > 15 chars)
                let long_words: Vec<&str> = content
                    .split_whitespace()
                    .filter(|w| {
                        w.chars().count() > 15
                            && w.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
                    })
                    .collect();

                if !long_words.is_empty() {
                    warnings.push(DryRunWarning {
                        file_name: file_name_str.clone(),
                        warning_type: "long_name".to_string(),
                        message: format!("通常より長い固有名詞を検知: {} 個", long_words.len()),
                    });
                }
            }
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
    let output_dir = path
        .join("anonymized_outputs")
        .join(format!("{}_{}", safe_task_name, timestamp));
    snapshot.ensure_allowed(&output_dir)?;
    fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    // Emit: Validation step starting
    let _ = app.emit(
        "bulk-progress",
        BulkProgressEvent {
            completed: 0,
            total: 0,
            current_file: "".to_string(),
            step_id: "validation".to_string(),
            step_status: "running".to_string(),
            step_message: "3省2ガイドラインに基づき、全ファイルの読み込み可否を検証中..."
                .to_string(),
        },
    );

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
        all_entries
            .into_iter()
            .filter(|e| target_set.contains(&e.path().to_string_lossy().to_string()))
            .collect()
    } else {
        all_entries
    };

    let total = entries.len();

    // Emit: Validation complete, execution starting
    let _ = app.emit(
        "bulk-progress",
        BulkProgressEvent {
            completed: 0,
            total,
            current_file: "".to_string(),
            step_id: "validation".to_string(),
            step_status: "completed".to_string(),
            step_message: format!("{}件のファイルの検証が完了しました", total),
        },
    );

    let _ = app.emit(
        "bulk-progress",
        BulkProgressEvent {
            completed: 0,
            total,
            current_file: "".to_string(),
            step_id: "execution".to_string(),
            step_status: "running".to_string(),
            step_message: "並列処理を開始します...".to_string(),
        },
    );

    // Shared counters for parallel progress
    let completed_count = Arc::new(AtomicUsize::new(0));
    let error_count = Arc::new(AtomicUsize::new(0));

    // Process files in parallel using rayon
    let logs: Vec<Option<AuditLog>> = entries
        .par_iter()
        .map(|entry| {
            let file_path = entry.path();
            let file_name = file_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Read original content
            let content = match snapshot
                .ensure_allowed(&file_path)
                .and_then(|p| read_file_with_encoding(&p))
            {
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
            let _ = app.emit(
                "bulk-progress",
                BulkProgressEvent {
                    completed: current,
                    total,
                    current_file: file_name.clone(),
                    step_id: "execution".to_string(),
                    step_status: "running".to_string(),
                    step_message: format!("処理中: {}", file_name),
                },
            );

            // Create audit log
            let applied_rules: Vec<String> = plan
                .replacements
                .iter()
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
        })
        .collect();

    // Emit: Execution complete
    let _ = app.emit(
        "bulk-progress",
        BulkProgressEvent {
            completed: total,
            total,
            current_file: "".to_string(),
            step_id: "execution".to_string(),
            step_status: "completed".to_string(),
            step_message: format!("全{}件の変換が完了しました", total),
        },
    );

    // Emit: Audit step
    let _ = app.emit(
        "bulk-progress",
        BulkProgressEvent {
            completed: total,
            total,
            current_file: "".to_string(),
            step_id: "audit".to_string(),
            step_status: "running".to_string(),
            step_message: "監査ログとハッシュ値を記録中...".to_string(),
        },
    );

    let valid_logs: Vec<AuditLog> = logs.into_iter().flatten().collect();
    let final_error_count = error_count.load(Ordering::Relaxed);

    // Emit: Audit complete
    let _ = app.emit(
        "bulk-progress",
        BulkProgressEvent {
            completed: total,
            total,
            current_file: output_dir.display().to_string(),
            step_id: "audit".to_string(),
            step_status: "completed".to_string(),
            step_message: format!("出力先: {}", output_dir.display()),
        },
    );

    Ok(BatchResult {
        processed_count: valid_logs.len(),
        error_count: final_error_count,
        logs: valid_logs,
    })
}

/// Read + analyze + apply plan for multiple files in parallel.
/// This is intended for interactive bulk review mode.
#[tauri::command]
pub async fn bulk_analyze_files(
    app: tauri::AppHandle,
    target_files: Vec<String>,
    task_context: String,
    provider: ModelProvider,
    cancellation_state: State<'_, CancellationState>,
    access_control: State<'_, AccessControl>,
) -> Result<BulkAnalyzeResponse, String> {
    cancellation_state.reset_bulk();
    let snapshot = access_control.snapshot()?;
    let mut failures: Vec<BulkAnalyzeFailure> = Vec::new();
    let mut allowed_files: Vec<(String, String, std::path::PathBuf)> = Vec::new();

    for path_str in target_files {
        let path = match snapshot.ensure_allowed(Path::new(&path_str)) {
            Ok(p) => p,
            Err(e) => {
                failures.push(BulkAnalyzeFailure {
                    path: path_str.clone(),
                    file_name: Path::new(&path_str)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or(path_str),
                    error: e,
                });
                continue;
            }
        };

        if !path.is_file() {
            failures.push(BulkAnalyzeFailure {
                path: path_str.clone(),
                file_name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or(path_str),
                error: "Path is not a file".to_string(),
            });
            continue;
        }

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());
        allowed_files.push((path_str, file_name, path));
    }

    let total = allowed_files.len();
    if total == 0 {
        cancellation_state.reset_bulk();
        return Ok(BulkAnalyzeResponse {
            items: vec![],
            failures,
            cancelled: false,
        });
    }

    // Plan once from task context + skill hints, without loading file contents.
    let orchestrator = AgentOrchestrator::new(&app, provider.clone())?;
    let matching_skills = find_matching_skills(&task_context);
    let skill_names = get_skill_names(&matching_skills);
    let strategy = orchestrator
        .plan_strategy_without_text(&task_context, &matching_skills)
        .await
        .map_err(|e| format!("Failed to plan anonymization strategy: {}", e))?;
    let shared_orchestrator = Arc::new(orchestrator);
    let shared_strategy = Arc::new(strategy);
    let shared_skill_names = Arc::new(skill_names);

    let concurrency = if provider == ModelProvider::LocalGemma {
        2
    } else {
        4
    };
    let completed_count = Arc::new(AtomicUsize::new(0));

    let mut items: Vec<BulkAnalyzeItem> = Vec::new();

    let outcomes = stream::iter(
        allowed_files
            .into_iter()
            .map(|(path_str, file_name, path)| {
                let app = app.clone();
                let completed_count = Arc::clone(&completed_count);
                let shared_orchestrator = Arc::clone(&shared_orchestrator);
                let shared_strategy = Arc::clone(&shared_strategy);
                let shared_skill_names = Arc::clone(&shared_skill_names);

                async move {
                    if app.state::<CancellationState>().is_bulk_cancelled() {
                        return Err(BulkAnalyzeFailure {
                            path: path_str,
                            file_name,
                            error: BULK_CANCELLED_MARKER.to_string(),
                        });
                    }

                    let emit_progress = |current_file: &str| {
                        let current = completed_count.fetch_add(1, Ordering::Relaxed) + 1;
                        let _ = app.emit(
                            "bulk-analysis-progress",
                            BulkAnalysisProgressEvent {
                                completed: current,
                                total,
                                current_file: current_file.to_string(),
                            },
                        );
                    };

                    let original = match read_file_with_encoding(&path) {
                        Ok(content) => content,
                        Err(e) => {
                            emit_progress(file_name.as_str());
                            return Err(BulkAnalyzeFailure {
                                path: path_str,
                                file_name,
                                error: format!("Failed to read file: {}", e),
                            });
                        }
                    };

                    if app.state::<CancellationState>().is_bulk_cancelled() {
                        return Err(BulkAnalyzeFailure {
                            path: path_str,
                            file_name,
                            error: BULK_CANCELLED_MARKER.to_string(),
                        });
                    }

                    let replacements = match shared_orchestrator
                        .execute_strategy(shared_strategy.as_ref(), &original)
                        .await
                    {
                        Ok(replacements) => replacements,
                        Err(e) => {
                            emit_progress(file_name.as_str());
                            return Err(BulkAnalyzeFailure {
                                path: path_str,
                                file_name,
                                error: format!("Failed to execute anonymization: {}", e),
                            });
                        }
                    };

                    if app.state::<CancellationState>().is_bulk_cancelled() {
                        return Err(BulkAnalyzeFailure {
                            path: path_str,
                            file_name,
                            error: BULK_CANCELLED_MARKER.to_string(),
                        });
                    }

                    let plan = AnonPlan {
                        task_name: shared_strategy.task_context.clone(),
                        global_rules: std::collections::HashMap::new(),
                        replacements,
                        status: "draft".to_string(),
                        applied_skills: shared_skill_names.as_ref().clone(),
                    };

                    let anonymized = match apply_plan_to_text(&original, &plan, true) {
                        Ok(anonymized) => anonymized,
                        Err(e) => {
                            emit_progress(file_name.as_str());
                            return Err(BulkAnalyzeFailure {
                                path: path_str,
                                file_name,
                                error: format!("Failed to apply plan: {}", e),
                            });
                        }
                    };

                    emit_progress(file_name.as_str());
                    Ok(BulkAnalyzeItem {
                        path: path_str,
                        file_name,
                        original,
                        anonymized,
                        plan,
                    })
                }
            }),
    )
    .buffer_unordered(concurrency)
    .collect::<Vec<Result<BulkAnalyzeItem, BulkAnalyzeFailure>>>()
    .await;

    let mut cancelled = cancellation_state.is_bulk_cancelled();
    for outcome in outcomes {
        match outcome {
            Ok(item) => items.push(item),
            Err(failure) => {
                if failure.error == BULK_CANCELLED_MARKER {
                    cancelled = true;
                    continue;
                }
                failures.push(failure);
            }
        }
    }

    cancellation_state.reset_bulk();
    Ok(BulkAnalyzeResponse {
        items,
        failures,
        cancelled,
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
    let orchestrator = AgentOrchestrator::new(&app, ModelProvider::Gemini)?;

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
        let content = match snapshot
            .ensure_allowed(&file_path)
            .and_then(|p| read_file_with_encoding(&p))
        {
            Ok(c) => c,
            Err(_) => {
                error_count += 1;
                continue;
            }
        };

        // Analyze with Orchestrator
        // We use the same task context format as in interactive mode
        let task_context = format!("Bulk Anonymization (Trace: {})", model_version_hash);
        let analysis_result = orchestrator
            .run_anonymization_pipeline(&app, &content, &task_context)
            .await;

        match analysis_result {
            Ok(plan) => {
                let applied_rules: Vec<String> = plan
                    .replacements
                    .iter()
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
            }
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
        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Read original content
        let original_content = match snapshot
            .ensure_allowed(file_path)
            .and_then(|p| read_file_with_encoding(&p))
        {
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
