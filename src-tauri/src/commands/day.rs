use tauri::State;

use crate::error::AppError;
use crate::state::{AppState, Day};

#[tauri::command]
pub fn get_day(date: String, state: State<'_, AppState>) -> Result<Day, AppError> {
    let repo = state
        .repo
        .lock()
        .map_err(|_| AppError::internal("Failed to lock repository"))?;

    repo.get_day(&date)
}

#[tauri::command]
pub fn list_dates(
    from: Option<String>,
    to: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let repo = state
        .repo
        .lock()
        .map_err(|_| AppError::internal("Failed to lock repository"))?;

    repo.list_dates(from.as_deref(), to.as_deref())
}
