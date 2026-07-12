use tauri::State;

use crate::error::AppError;
use crate::state::{AppState, NotebookDay, SaveDayInput};

#[tauri::command]
pub fn get_day(date: String, state: State<'_, AppState>) -> Result<NotebookDay, AppError> {
    let repo = state
        .repo
        .lock()
        .map_err(|_| AppError::internal("Failed to lock repository"))?;

    repo.get_notebook_day(&date)
}

#[tauri::command]
pub fn save_day(input: SaveDayInput, state: State<'_, AppState>) -> Result<NotebookDay, AppError> {
    let mut repo = state
        .repo
        .lock()
        .map_err(|_| AppError::internal("Failed to lock repository"))?;

    repo.save_notebook_day(&input.day)
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
