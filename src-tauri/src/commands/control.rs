use crate::state::CancellationState;
use tauri::{Emitter, State};

#[tauri::command]
pub fn cancel_active_operations(
    app: tauri::AppHandle,
    cancellation_state: State<'_, CancellationState>,
) -> Result<(), String> {
    cancellation_state.request_chat_cancel();
    cancellation_state.request_bulk_cancel();

    let _ = app.emit(
        "operation-cancel-requested",
        serde_json::json!({
            "chat": true,
            "bulk": true
        }),
    );

    Ok(())
}
