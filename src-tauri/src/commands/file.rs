use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;
use chrono::Local;

/// Response from open_file command
#[derive(Serialize)]
pub struct OpenFileResult {
    pub path: String,
    pub content: String,
    pub filename: String,
}

/// Read file with automatic encoding detection (UTF-8 or Shift-JIS)
fn read_file_with_encoding(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Try UTF-8 first
    if let Ok(content) = String::from_utf8(bytes.clone()) {
        return Ok(content);
    }

    // Fallback to Shift-JIS (Windows-31J)
    let (decoded, _, had_errors) = encoding_rs::SHIFT_JIS.decode(&bytes);
    if had_errors {
        // Try EUC-JP as another fallback
        let (decoded_euc, _, had_errors_euc) = encoding_rs::EUC_JP.decode(&bytes);
        if !had_errors_euc {
            return Ok(decoded_euc.into_owned());
        }
        return Err("Failed to decode file: unsupported encoding".to_string());
    }

    Ok(decoded.into_owned())
}

/// Open file dialog and read file content
#[tauri::command]
pub async fn open_file(app: tauri::AppHandle) -> Result<Option<OpenFileResult>, String> {
    let file_path = app.dialog()
        .file()
        .add_filter("Text Files", &["txt", "csv", "json", "md", "log"])
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    let Some(path) = file_path else {
        return Ok(None); // User cancelled
    };

    let path_buf = path.into_path().map_err(|e| format!("Invalid path: {:?}", e))?;
    let content = read_file_with_encoding(&path_buf)?;
    let filename = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(Some(OpenFileResult {
        path: path_buf.to_string_lossy().to_string(),
        content,
        filename,
    }))
}

/// Response from save_anonymized_file command
#[derive(Serialize)]
pub struct SaveFileResult {
    pub saved_path: String,
    pub audit_log_path: String,
}

/// Save anonymized file with audit log
#[tauri::command]
pub async fn save_anonymized_file(
    app: tauri::AppHandle,
    content: String,
    original_filename: String,
    original_content: String,
    applied_plan: serde_json::Value,
) -> Result<Option<SaveFileResult>, String> {
    // Generate default filename with _anonymized suffix
    let default_name = if let Some((name, ext)) = original_filename.rsplit_once('.') {
        format!("{}_anonymized.{}", name, ext)
    } else {
        format!("{}_anonymized", original_filename)
    };

    let save_path = app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Text Files", &["txt", "csv", "json", "md"])
        .add_filter("All Files", &["*"])
        .blocking_save_file();

    let Some(path) = save_path else {
        return Ok(None); // User cancelled
    };

    let path_buf = path.into_path().map_err(|e| format!("Invalid path: {:?}", e))?;

    // Save the anonymized content
    fs::write(&path_buf, &content)
        .map_err(|e| format!("Failed to save file: {}", e))?;

    // Generate audit log in the same directory
    let audit_log_path = path_buf.with_extension("audit.json");
    let timestamp = Local::now().format("%Y-%m-%dT%H:%M:%S%z").to_string();

    let audit_log = serde_json::json!({
        "timestamp": timestamp,
        "original_filename": original_filename,
        "saved_filename": path_buf.file_name().and_then(|n| n.to_str()).unwrap_or("unknown"),
        "original_hash": format!("{:x}", md5::compute(original_content.as_bytes())),
        "anonymized_hash": format!("{:x}", md5::compute(content.as_bytes())),
        "applied_plan": applied_plan,
    });

    fs::write(&audit_log_path, serde_json::to_string_pretty(&audit_log).unwrap())
        .map_err(|e| format!("Failed to write audit log: {}", e))?;

    Ok(Some(SaveFileResult {
        saved_path: path_buf.to_string_lossy().to_string(),
        audit_log_path: audit_log_path.to_string_lossy().to_string(),
    }))
}
