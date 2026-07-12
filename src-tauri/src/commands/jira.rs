use crate::state::{default_profile, JiraProfile, TicketSuggestion};

#[tauri::command]
pub fn get_profile() -> JiraProfile {
    default_profile()
}

#[tauri::command]
pub fn search_tickets(query: String) -> Vec<TicketSuggestion> {
    let trimmed = query.trim();

    if trimmed.is_empty() {
        return Vec::new();
    }

    vec![TicketSuggestion {
        key: "MIGRATION-0".into(),
        summary: format!("Tauri scaffold placeholder result for \"{trimmed}\""),
    }]
}
