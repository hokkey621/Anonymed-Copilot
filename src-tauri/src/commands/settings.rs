use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use crate::infrastructure::llm::{ModelProvider, DEFAULT_OLLAMA_BASE_URL};

/// Get the path to the settings file
fn get_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("settings.json"))
}

fn default_ollama_base_url() -> String {
    DEFAULT_OLLAMA_BASE_URL.to_string()
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct AppSettings {
    pub api_key: Option<String>,
    #[serde(default)]
    pub selected_provider: ModelProvider,
    #[serde(default = "default_ollama_base_url")]
    pub ollama_base_url: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            api_key: None,
            selected_provider: ModelProvider::default(),
            ollama_base_url: default_ollama_base_url(),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsView {
    pub selected_provider: ModelProvider,
    pub ollama_base_url: String,
    pub has_api_key: bool,
}

fn read_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let settings_path = get_settings_path(app)?;
    if !settings_path.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    serde_json::from_str::<AppSettings>(&content).map_err(|e| e.to_string())
}

fn write_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let settings_path = get_settings_path(app)?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, json).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perm = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&settings_path, perm).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Save the API key to settings file
#[tauri::command]
pub async fn save_api_key(app: tauri::AppHandle, api_key: String) -> Result<(), String> {
    let mut settings = read_settings(&app)?;
    settings.api_key = Some(api_key);
    write_settings(&app, &settings)
}

/// Save selected provider
#[tauri::command]
pub async fn save_selected_provider(
    app: tauri::AppHandle,
    provider: ModelProvider,
) -> Result<(), String> {
    let mut settings = read_settings(&app)?;
    settings.selected_provider = provider;
    write_settings(&app, &settings)
}

/// Load non-sensitive settings used by frontend
#[tauri::command]
pub async fn load_app_settings(app: tauri::AppHandle) -> Result<AppSettingsView, String> {
    let settings = read_settings(&app)?;
    let has_api_key = settings
        .api_key
        .as_ref()
        .map(|k| !k.is_empty())
        .unwrap_or(false);

    Ok(AppSettingsView {
        selected_provider: settings.selected_provider,
        ollama_base_url: settings.ollama_base_url,
        has_api_key,
    })
}

/// Load the API key from settings file
#[tauri::command]
pub async fn load_api_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let settings = read_settings(&app)?;
    Ok(settings.api_key.filter(|key| !key.is_empty()))
}

/// Check if API key is configured in settings file
/// Note: Does NOT check .env - we want first-time users to see the modal
#[tauri::command]
pub async fn has_api_key(app: tauri::AppHandle) -> Result<bool, String> {
    has_api_key_for_provider(app, ModelProvider::Gemini).await
}

/// Check credentials for selected provider
#[tauri::command]
pub async fn has_api_key_for_provider(
    app: tauri::AppHandle,
    provider: ModelProvider,
) -> Result<bool, String> {
    if provider != ModelProvider::Gemini {
        return Ok(true);
    }

    let settings = read_settings(&app)?;
    Ok(settings
        .api_key
        .as_ref()
        .map(|key| !key.is_empty())
        .unwrap_or(false))
}
