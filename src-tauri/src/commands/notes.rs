use tauri::State;

use crate::error::AppError;
use crate::state::{AppState, OkResponse};

#[tauri::command]
pub fn save_day_notes(
    date: String,
    notes: String,
    state: State<'_, AppState>,
) -> Result<OkResponse, AppError> {
    let mut repo = state
        .repo
        .lock()
        .map_err(|_| AppError::internal("Failed to lock repository"))?;

    repo.save_notes(&date, &notes)?;

    Ok(OkResponse { ok: true })
}
