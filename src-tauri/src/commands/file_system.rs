use crate::domain::model::FileEntry;
use std::fs;
use std::path::Path;
use encoding_rs::{SHIFT_JIS, UTF_8};

#[tauri::command]
pub fn list_files(dir_path: String) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&dir_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Directory not found: {}", dir_path));
    }

    let mut entries = Vec::new();
    if let Ok(read_dir) = fs::read_dir(path) {
        for entry_result in read_dir {
            if let Ok(entry) = entry_result {
                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                let file_name = entry.file_name().to_string_lossy().to_string();
                let full_path = entry.path().to_string_lossy().to_string();

                // Skip hidden files/dirs (simple check)
                if file_name.starts_with('.') {
                    continue;
                }

                entries.push(FileEntry {
                    name: file_name,
                    path: full_path,
                    is_dir: metadata.is_dir(),
                    size: metadata.len(),
                });
            }
        }
    }
    // Sort directories first, then files
    entries.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.cmp(&b.name)
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_text_file(file_path: String) -> Result<String, String> {
    let raw_bytes = fs::read(&file_path).map_err(|e| e.to_string())?;

    // Attempt detection: if BOM is present or UTF-8 invalid, try Shift-JIS
    // Simple heuristic: Try UTF-8 first.
    let (cow, encoding_used, had_errors) = UTF_8.decode(&raw_bytes);

    if had_errors {
        // Retry with Shift-JIS
        let (cow_sj, _enc_sj, _malformed_sj) = SHIFT_JIS.decode(&raw_bytes);
        return Ok(cow_sj.into_owned());
    }

    Ok(cow.into_owned())
}
