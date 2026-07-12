use tauri::State;

use crate::core::config::IntegrationConfig;
use crate::core::http::HttpClient;
use crate::core::jira::JiraClient;
use crate::error::AppError;
use crate::state::{AppState, JiraProfile, TicketSuggestion};

#[tauri::command]
pub async fn get_profile(state: State<'_, AppState>) -> Result<JiraProfile, AppError> {
    jira_client(state.inner())?.myself().await
}

#[tauri::command]
pub async fn search_tickets(query: String, state: State<'_, AppState>) -> Result<Vec<TicketSuggestion>, AppError> {
    jira_client(state.inner())?.pick_issues(query.trim()).await
}

fn jira_client(state: &AppState) -> Result<JiraClient, AppError> {
    let config: IntegrationConfig = state.load_integration_config()?;
    let jira = config.require_jira()?.clone();
    Ok(JiraClient::new(jira, HttpClient::new()?))
}
