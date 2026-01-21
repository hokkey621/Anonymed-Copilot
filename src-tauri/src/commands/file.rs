use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;
use chrono::Local;
use sha2::{Sha256, Digest};
use hex;
use tauri::State;
use crate::utils::access_control::{AccessControl, AccessSnapshot};
use crate::utils::file_reader::read_file_with_encoding;

/// Response from open_file command
#[derive(Serialize)]
pub struct OpenFileResult {
    pub path: String,
    pub content: String,
    pub filename: String,
}

fn sha256_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

/// Open file dialog and read file content
#[tauri::command]
pub async fn open_file(
    app: tauri::AppHandle,
    access_control: State<'_, AccessControl>,
) -> Result<Option<OpenFileResult>, String> {
    let file_path = app.dialog()
        .file()
        .add_filter("Text Files", &["txt", "csv", "json", "md", "log"])
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    let Some(path) = file_path else {
        return Ok(None); // User cancelled
    };

    let path_buf = path.into_path().map_err(|e| format!("Invalid path: {:?}", e))?;
    let parent_dir = path_buf
        .parent()
        .ok_or_else(|| "Invalid path: no parent directory".to_string())?
        .to_path_buf();

    access_control.set_base_dir(parent_dir)?;

    let path_buf = access_control.ensure_allowed(&path_buf)?;
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
    access_control: State<'_, AccessControl>,
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
    let path_buf = access_control.ensure_allowed(&path_buf)?;

    // Save the anonymized content
    fs::write(&path_buf, &content)
        .map_err(|e| format!("Failed to save file: {}", e))?;

    // Generate audit log in the same directory
    let audit_log_path = path_buf.with_extension("audit.json");
    access_control.ensure_allowed(&audit_log_path)?;
    let timestamp = Local::now().format("%Y-%m-%dT%H:%M:%S%z").to_string();

    let audit_log = serde_json::json!({
        "timestamp": timestamp,
        "original_filename": original_filename,
        "saved_filename": path_buf.file_name().and_then(|n| n.to_str()).unwrap_or("unknown"),
        "original_hash": sha256_hash(&original_content),
        "anonymized_hash": sha256_hash(&content),
        "applied_plan": applied_plan,
    });

    fs::write(&audit_log_path, serde_json::to_string_pretty(&audit_log).unwrap())
        .map_err(|e| format!("Failed to write audit log: {}", e))?;

    Ok(Some(SaveFileResult {
        saved_path: path_buf.to_string_lossy().to_string(),
        audit_log_path: audit_log_path.to_string_lossy().to_string(),
    }))
}

/// File entry for folder listing
#[derive(Serialize)]
pub struct FolderFileEntry {
    pub path: String,
    pub filename: String,
    pub is_dir: bool,
}

/// Response from open_folder command
#[derive(Serialize)]
pub struct OpenFolderResult {
    pub folder_path: String,
    pub folder_name: String,
    pub files: Vec<FolderFileEntry>,
}

/// Open folder dialog and list files
#[tauri::command]
pub async fn open_folder(
    app: tauri::AppHandle,
    access_control: State<'_, AccessControl>,
) -> Result<Option<OpenFolderResult>, String> {
    let folder_path = app.dialog()
        .file()
        .blocking_pick_folder();

    let Some(path) = folder_path else {
        return Ok(None); // User cancelled
    };

    let path_buf = path.into_path().map_err(|e| format!("Invalid path: {:?}", e))?;

    access_control.set_base_dir(path_buf.clone())?;
    let snapshot = access_control.snapshot()?;

    let folder_name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("folder")
        .to_string();

    let mut files = Vec::new();
    collect_files_recursive(&snapshot, &path_buf, &mut files, 0, 3)?; // Max depth 3

    Ok(Some(OpenFolderResult {
        folder_path: path_buf.to_string_lossy().to_string(),
        folder_name,
        files,
    }))
}

/// Recursively collect files from directory
fn collect_files_recursive(
    snapshot: &AccessSnapshot,
    dir: &Path,
    files: &mut Vec<FolderFileEntry>,
    depth: usize,
    max_depth: usize,
) -> Result<(), String> {
    if depth > max_depth {
        return Ok(());
    }

    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if snapshot.is_ignored(&path) {
            continue;
        }

        if snapshot.ensure_within_base(&path).is_err() {
            continue;
        }
        let filename = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Skip hidden files
        if filename.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            files.push(FolderFileEntry {
                path: path.to_string_lossy().to_string(),
                filename,
                is_dir: true,
            });
            collect_files_recursive(snapshot, &path, files, depth + 1, max_depth)?;
        } else {
            files.push(FolderFileEntry {
                path: path.to_string_lossy().to_string(),
                filename,
                is_dir: false,
            });
        }
    }

    Ok(())
}

/// Read a single file's content (for lazy loading)
#[tauri::command]
pub async fn read_file_content(
    file_path: String,
    access_control: State<'_, AccessControl>,
) -> Result<OpenFileResult, String> {
    let path = Path::new(&file_path);
    let path = access_control.ensure_allowed(path)?;
    let content = read_file_with_encoding(&path)?;
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(OpenFileResult {
        path: file_path,
        content,
        filename,
    })
}
