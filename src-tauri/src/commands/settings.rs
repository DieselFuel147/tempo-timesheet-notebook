use tauri::State;

use crate::error::AppError;
use crate::state::{AppState, SecretUpdates, Settings};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, AppError> {
    state.get_settings()
}

#[tauri::command]
pub fn save_settings(
    settings: Settings,
    secret_updates: Option<SecretUpdates>,
    state: State<'_, AppState>,
) -> Result<Settings, AppError> {
    state.save_settings(&settings, secret_updates)
}
