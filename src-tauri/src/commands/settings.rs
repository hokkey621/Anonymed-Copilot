use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Get the path to the settings file
fn get_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("settings.json"))
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct AppSettings {
    pub api_key: Option<String>,
}

/// Save the API key to settings file
#[tauri::command]
pub async fn save_api_key(app: tauri::AppHandle, api_key: String) -> Result<(), String> {
    let settings_path = get_settings_path(&app)?;

    let settings = AppSettings {
        api_key: Some(api_key),
    };

    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, json).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perm = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&settings_path, perm).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Load the API key from settings file
#[tauri::command]
pub async fn load_api_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let settings_path = get_settings_path(&app)?;

    if !settings_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let settings: AppSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(settings.api_key.filter(|key| !key.is_empty()))
}

/// Check if API key is configured in settings file
/// Note: Does NOT check .env - we want first-time users to see the modal
#[tauri::command]
pub async fn has_api_key(app: tauri::AppHandle) -> Result<bool, String> {
    // Only check settings file, not .env
    // This ensures first-time users see the API key modal
    if let Ok(Some(key)) = load_api_key(app).await {
        return Ok(!key.is_empty());
    }
    Ok(false)
}
