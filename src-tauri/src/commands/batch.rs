use crate::domain::model::{AuditLog, FileEntry};
use crate::commands::file_system::read_text_file;
use rayon::prelude::*;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::State;
use crate::infrastructure::onnx_handler::OnnxSession;

#[derive(serde::Serialize)]
pub struct BatchResult {
    pub processed_count: usize,
    pub error_count: usize,
    pub logs: Vec<AuditLog>,
}

#[tauri::command]
pub fn process_bulk(
    dir_path: String,
    model_version_hash: String, // Traceability
    state: State<OnnxSession>
) -> Result<BatchResult, String> {
    let path = Path::new(&dir_path);
    if !path.is_dir() {
        return Err("Path is not a directory".into());
    }

    // 1. List files (Synchronous for now, fast enough)
    let entries: Vec<_> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|res| res.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "txt")) // Only .txt for now
        .collect();

    // 2. Parallel Process
    // "Process" means: Read -> Analyze -> (Mock Apply) -> Log
    let results: Vec<Result<AuditLog, String>> = entries.par_iter().map(|entry| {
        let file_path = entry.path().to_string_lossy().to_string();

        // Read (reuse existing logic)
        let content = read_text_file(file_path.clone())?;

        // Analyze (Thread-safe because OnnxSession is read-only usually, or internal lock)
        // For POC, we just run inference.
        let _plan_items = state.run_inference(&content);

        // Mock "Apply" -> In real app, we would apply replacements.
        // For now, let's say we kept it as is for safety or modified it.

        // Generate Audit Log
        let log = AuditLog {
            task_context: format!("Bulk Anonymization (Model: {})", model_version_hash),
            applied_rules: _plan_items, // Log what ONNX found
            user_overrides: vec![],
            privacy_score: 0.8, // Mock
            data_hash: format!("{:x}", md5::compute(content.as_bytes())), // Simple hash for ID
            timestamp: chrono::Utc::now().to_rfc3339(),
            signature: None, // Will be signed later if needed, or now.
        };

        Ok(log)
    }).collect();

    // 3. Aggregate Results
    let mut logs = Vec::new();
    let mut error_count = 0;

    for res in results {
        match res {
            Ok(log) => logs.push(log),
            Err(_) => error_count += 1,
        }
    }

    Ok(BatchResult {
        processed_count: logs.len(),
        error_count,
        logs,
    })
}
