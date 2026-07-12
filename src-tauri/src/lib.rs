mod commands;
mod error;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::health::health_check,
            commands::jira::get_profile,
            commands::jira::search_tickets,
            commands::day::get_day,
            commands::day::list_dates,
            commands::entry::upsert_entry,
            commands::entry::delete_entry,
            commands::notes::save_day_notes,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::push::push_day,
            commands::push::dry_run_day,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
