use tauri::State;

use crate::error::AppError;
use crate::state::{AppState, Day, Entry, EntrySaveInput, OkResponse};

#[tauri::command]
pub fn upsert_entry(input: EntrySaveInput, state: State<'_, AppState>) -> Result<Entry, AppError> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| AppError::message("Failed to lock in-memory store"))?;

    let entry_id = input
        .id
        .clone()
        .ok_or_else(|| AppError::message("Entry id is required in the Tauri scaffold"))?;

    let day = store.days.entry(input.date.clone()).or_insert_with(|| Day {
        date: input.date.clone(),
        notes: String::new(),
        entries: Vec::new(),
    });

    if let Some(existing) = day.entries.iter_mut().find(|entry| entry.id == entry_id) {
        existing.start = input.start;
        existing.end = input.end;
        existing.ticket_key = input.ticket_key;
        existing.summary = input.summary;
    } else {
        day.entries.push(Entry {
            id: entry_id.clone(),
            date: input.date,
            start: input.start,
            end: input.end,
            ticket_key: input.ticket_key,
            summary: input.summary,
            tempo_worklog_id: None,
            synced_at: None,
        });
    }

    if let Some(sort_order) = input.sort_order {
        if let Some(current_index) = day.entries.iter().position(|entry| entry.id == entry_id) {
            let entry = day.entries.remove(current_index);
            let target_index = sort_order.min(day.entries.len());
            day.entries.insert(target_index, entry);
        }
    }

    day.entries
        .iter()
        .find(|entry| entry.id == entry_id)
        .cloned()
        .ok_or_else(|| AppError::message("Saved entry could not be reloaded"))
}

#[tauri::command]
pub fn delete_entry(id: String, state: State<'_, AppState>) -> Result<OkResponse, AppError> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| AppError::message("Failed to lock in-memory store"))?;

    for day in store.days.values_mut() {
        if let Some(index) = day.entries.iter().position(|entry| entry.id == id) {
            day.entries.remove(index);
            return Ok(OkResponse { ok: true });
        }
    }

    Ok(OkResponse { ok: true })
}
