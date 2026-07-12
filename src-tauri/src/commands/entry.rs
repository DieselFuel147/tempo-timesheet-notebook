use tauri::State;

use crate::error::AppError;
use crate::state::{AppState, Entry, EntrySaveInput, OkResponse};

#[tauri::command]
pub fn upsert_entry(input: EntrySaveInput, state: State<'_, AppState>) -> Result<Entry, AppError> {
    let mut repo = state
        .repo
        .lock()
        .map_err(|_| AppError::internal("Failed to lock repository"))?;

    repo.upsert_entry(input)
}

#[tauri::command]
pub fn delete_entry(id: String, state: State<'_, AppState>) -> Result<OkResponse, AppError> {
    let mut repo = state
        .repo
        .lock()
        .map_err(|_| AppError::internal("Failed to lock repository"))?;

    repo.delete_entry(&id)?;

    Ok(OkResponse { ok: true })
}
