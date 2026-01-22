use crate::utils::env_loader::load_dotenv_if_allowed;
use std::env;
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

fn is_valid_api_key(key: &str) -> bool {
    let trimmed = key.trim();
    !trimmed.is_empty() && trimmed != "your_api_key_here"
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

    Ok(settings.api_key.filter(|key| is_valid_api_key(key)))
}

/// Check if API key is configured in settings file
/// Note: Does NOT check .env - we want first-time users to see the modal
#[tauri::command]
pub async fn has_api_key(app: tauri::AppHandle) -> Result<bool, String> {
    // 1) Settings file takes priority
    if let Ok(Some(key)) = load_api_key(app).await {
        return Ok(is_valid_api_key(&key));
    }

    // 2) Dev-only opt-in .env fallback
    load_dotenv_if_allowed();
    if let Ok(key) = env::var("GOOGLE_API_KEY") {
        return Ok(is_valid_api_key(&key));
    }

    Ok(false)
}
