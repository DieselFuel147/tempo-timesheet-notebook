use tauri::State;

use crate::error::AppError;
use crate::state::{AppState, Settings};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, AppError> {
    let repo = state
        .repo
        .lock()
        .map_err(|_| AppError::internal("Failed to lock repository"))?;

    repo.get_settings()
}

#[tauri::command]
pub fn save_settings(settings: Settings, state: State<'_, AppState>) -> Result<Settings, AppError> {
    let mut repo = state
        .repo
        .lock()
        .map_err(|_| AppError::internal("Failed to lock repository"))?;

    repo.save_settings(&settings)
}
