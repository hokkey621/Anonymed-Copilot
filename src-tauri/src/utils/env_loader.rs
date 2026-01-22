use std::env;

pub fn load_dotenv_if_allowed() {
    if !cfg!(debug_assertions) {
        return;
    }

    let allow = env::var("ANONYMED_ALLOW_DOTENV")
        .map(|value| value == "1")
        .unwrap_or(false);
    if !allow {
        return;
    }

    let _ = dotenv::from_filename("src-tauri/.env");
    let _ = dotenv::from_filename(".env");
}
