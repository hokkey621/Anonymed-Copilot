pub mod commands;
pub mod domain;
pub mod infrastructure;
pub mod prompts;
pub mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(utils::access_control::AccessControl::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::anonymizer::analyze_text,
            commands::anonymizer::apply_plan,
            commands::anonymizer::chat_with_ai,
            commands::anonymizer::agent_chat,
            commands::anonymizer::agent_chat_streaming,
            commands::audit::generate_report,
            commands::audit::create_audit_report,
            commands::audit::generate_public_notice,
            commands::batch::process_bulk,
            commands::batch::bulk_execute,
            commands::batch::bulk_dry_run,
            commands::batch::bulk_preview,
            commands::batch::bulk_save,
            commands::file::open_file,
            commands::file::open_folder,
            commands::file::read_file_content,
            commands::file::save_anonymized_file,
            commands::settings::save_api_key,
            commands::settings::load_api_key,
            commands::settings::has_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
