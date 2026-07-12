use crate::core::config::IntegrationConfig;
use crate::core::http::HttpClient;
use crate::core::jira::JiraClient;
use crate::error::AppError;
use crate::state::{JiraProfile, TicketSuggestion};

#[tauri::command]
pub async fn get_profile() -> Result<JiraProfile, AppError> {
    jira_client()?.myself().await
}

#[tauri::command]
pub async fn search_tickets(query: String) -> Result<Vec<TicketSuggestion>, AppError> {
    jira_client()?.pick_issues(query.trim()).await
}

fn jira_client() -> Result<JiraClient, AppError> {
    let config = IntegrationConfig::from_env();
    let jira = config.require_jira()?.clone();
    Ok(JiraClient::new(jira, HttpClient::new()?))
}
