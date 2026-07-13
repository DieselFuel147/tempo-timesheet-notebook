use tauri::State;

use crate::core::ai::require_ai;
use crate::error::AppError;
use crate::state::{AiStatus, AppState};

/// Summarize a block's raw notes into a short (1–2 sentence) worklog
/// description using the local, on-device model. Desktop-only.
#[tauri::command]
pub async fn suggest_summary(text: String, state: State<'_, AppState>) -> Result<String, AppError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            crate::error::ErrorCode::ValidationError,
            "There are no notes to summarize",
        ));
    }

    let settings = {
        let repo = state
            .repo
            .lock()
            .map_err(|_| AppError::internal("Failed to lock repository"))?;
        repo.get_settings()?
    };

    let config = require_ai(&settings)?;
    state.ai.summarize(&config, trimmed).await
}

/// Whether the local model process is currently loaded, for the status bar.
#[tauri::command]
pub async fn ai_status(state: State<'_, AppState>) -> Result<AiStatus, AppError> {
    Ok(AiStatus {
        running: state.ai.is_running().await,
    })
}
