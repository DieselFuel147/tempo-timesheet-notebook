use tauri::State;

use crate::error::AppError;
use crate::state::{get_or_create_day, AppState, Day};

#[tauri::command]
pub fn get_day(date: String, state: State<'_, AppState>) -> Result<Day, AppError> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| AppError::message("Failed to lock in-memory store"))?;

    Ok(get_or_create_day(&mut store, &date))
}

#[tauri::command]
pub fn list_dates(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let store = state
        .store
        .lock()
        .map_err(|_| AppError::message("Failed to lock in-memory store"))?;

    let mut dates = store.days.keys().cloned().collect::<Vec<_>>();
    dates.sort();
    Ok(dates)
}
