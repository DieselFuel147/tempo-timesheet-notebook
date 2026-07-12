use tauri::State;

use crate::error::AppError;
use crate::state::{AppState, Day, OkResponse};

#[tauri::command]
pub fn save_day_notes(
    date: String,
    notes: String,
    state: State<'_, AppState>,
) -> Result<OkResponse, AppError> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| AppError::message("Failed to lock in-memory store"))?;

    let day = store.days.entry(date.clone()).or_insert_with(|| Day {
        date,
        notes: String::new(),
        entries: Vec::new(),
    });
    day.notes = notes;

    Ok(OkResponse { ok: true })
}
