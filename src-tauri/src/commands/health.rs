use crate::state::HealthStatus;

#[tauri::command]
pub fn health_check() -> HealthStatus {
    HealthStatus::default()
}
