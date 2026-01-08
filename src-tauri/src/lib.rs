pub mod commands;
pub mod domain;
pub mod infrastructure;
pub mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::file_system::list_files,
            commands::file_system::read_text_file,
            commands::anonymizer::analyze_text,
            commands::anonymizer::apply_plan,
            commands::audit::generate_report,
            commands::audit::generate_public_notice,
            commands::batch::process_bulk
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
