use tauri::State;

use crate::error::AppError;
use crate::state::{AppState, Settings};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, AppError> {
    let store = state
        .store
        .lock()
        .map_err(|_| AppError::message("Failed to lock in-memory store"))?;

    Ok(store.settings.clone())
}

#[tauri::command]
pub fn save_settings(settings: Settings, state: State<'_, AppState>) -> Result<Settings, AppError> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| AppError::message("Failed to lock in-memory store"))?;

    store.settings = settings;
    Ok(store.settings.clone())
}
