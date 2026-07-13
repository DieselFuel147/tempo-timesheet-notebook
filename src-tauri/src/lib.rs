mod commands;
mod core;
mod error;
mod state;

use tauri::Manager;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = AppState::new(app.handle().clone())
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health::health_check,
            commands::jira::get_profile,
            commands::jira::search_tickets,
            commands::day::get_day,
            commands::day::save_day,
            commands::day::list_dates,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::push::push_day,
            commands::push::dry_run_day,
            commands::push::get_tempo_worklogs,
            commands::ai::suggest_summary,
            commands::ai::ai_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
