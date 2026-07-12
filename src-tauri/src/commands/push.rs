use tauri::State;

use crate::error::AppError;
use crate::state::{AppState, DryRunSummary, PushSummary};

const SCAFFOLD_BLOCKER: &str = "Tempo push is not migrated to Rust yet; this Tauri shell is a Wave 0 scaffold only.";

#[tauri::command]
pub fn push_day(_date: String, _state: State<'_, AppState>) -> Result<PushSummary, AppError> {
    Ok(PushSummary {
        results: Vec::new(),
        synced: 0,
        failed: 0,
        skipped: 0,
        blocked: vec![SCAFFOLD_BLOCKER.into()],
    })
}

#[tauri::command]
pub fn dry_run_day(_date: String, _state: State<'_, AppState>) -> Result<DryRunSummary, AppError> {
    Ok(DryRunSummary {
        dry_run: true,
        planned: Vec::new(),
        skipped: 0,
        blocked: vec![SCAFFOLD_BLOCKER.into()],
    })
}
