use crate::domain::model::AuditLog;
use std::fs;
use std::path::Path;
use crate::domain::agent_orchestrator::AgentOrchestrator;

#[derive(serde::Serialize)]
pub struct BatchResult {
    pub processed_count: usize,
    pub error_count: usize,
    pub logs: Vec<AuditLog>,
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
