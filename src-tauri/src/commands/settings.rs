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

    Ok(settings.api_key)
}

/// Check if API key is configured (either in settings or .env)
#[tauri::command]
pub async fn has_api_key(app: tauri::AppHandle) -> Result<bool, String> {
    // First check settings file
    if let Ok(Some(_)) = load_api_key(app).await {
        return Ok(true);
    }

    // Fallback to .env
    dotenv::dotenv().ok();
    Ok(std::env::var("GOOGLE_API_KEY").is_ok())
}
