use tauri::State;

use async_trait::async_trait;

use crate::core::config::IntegrationConfig;
use crate::core::http::HttpClient;
use crate::core::jira::JiraClient;
use crate::core::push::{self, JiraPushClient, PushRepository, TempoPushClient};
use crate::core::tempo::TempoClient;
use crate::error::AppError;
use crate::state::{
    AppState, Day, DryRunSummary, JiraIssueRef, JiraProfile, PlannedRequest, PushSummary,
    Settings, WorklogInput,
};

#[tauri::command]
pub async fn push_day(date: String, state: State<'_, AppState>) -> Result<PushSummary, AppError> {
    let clients = IntegrationClients::from_env()?;
    let repo = StateBackedPushRepo::new(state.inner());
    push::push_day(&date, &clients.jira, &clients.tempo, &repo).await
}

#[tauri::command]
pub async fn dry_run_day(date: String, state: State<'_, AppState>) -> Result<DryRunSummary, AppError> {
    let clients = IntegrationClients::from_env()?;
    let repo = StateBackedPushRepo::new(state.inner());
    push::dry_run_day(&date, &clients.jira, &clients.tempo, &repo).await
}

struct IntegrationClients {
    jira: JiraClient,
    tempo: TempoClient,
}

impl IntegrationClients {
    fn from_env() -> Result<Self, AppError> {
        let config = IntegrationConfig::from_env();
        let jira = JiraClient::new(config.require_jira()?.clone(), HttpClient::new()?);
        let tempo = TempoClient::new(config.require_tempo()?.clone(), HttpClient::new()?);
        Ok(Self { jira, tempo })
    }
}

struct StateBackedPushRepo<'a> {
    state: &'a AppState,
}

impl<'a> StateBackedPushRepo<'a> {
    fn new(state: &'a AppState) -> Self {
        Self { state }
    }
}

#[async_trait]
impl PushRepository for StateBackedPushRepo<'_> {
    async fn get_day(&self, date: &str) -> Result<Day, AppError> {
        let repo = self
            .state
            .repo
            .lock()
            .map_err(|_| AppError::internal("Failed to lock repository"))?;

        repo.get_day(date)
    }

    async fn mark_synced(&self, id: &str, tempo_worklog_id: i64) -> Result<(), AppError> {
        let mut repo = self
            .state
            .repo
            .lock()
            .map_err(|_| AppError::internal("Failed to lock repository"))?;

        repo.mark_synced(id, tempo_worklog_id)
    }

    async fn get_cached_issue_id(&self, key: &str) -> Result<Option<String>, AppError> {
        let repo = self
            .state
            .repo
            .lock()
            .map_err(|_| AppError::internal("Failed to lock repository"))?;

        Ok(repo.get_cached_issue(key)?.map(|issue| issue.issue_id))
    }

    async fn cache_issue(&self, key: &str, issue_id: &str, summary: &str) -> Result<(), AppError> {
        let mut repo = self
            .state
            .repo
            .lock()
            .map_err(|_| AppError::internal("Failed to lock repository"))?;

        repo.cache_issue(key, issue_id, summary)
    }

    async fn get_settings(&self) -> Result<Settings, AppError> {
        let repo = self
            .state
            .repo
            .lock()
            .map_err(|_| AppError::internal("Failed to lock repository"))?;
        repo.get_settings()
    }
}

#[async_trait]
impl JiraPushClient for JiraClient {
    async fn myself(&self) -> Result<JiraProfile, AppError> {
        JiraClient::myself(self).await
    }

    async fn resolve_issue(&self, key: &str) -> Result<JiraIssueRef, AppError> {
        JiraClient::resolve_issue(self, key).await
    }
}

#[async_trait]
impl TempoPushClient for TempoClient {
    async fn create_worklog(&self, input: &WorklogInput) -> Result<i64, AppError> {
        Ok(TempoClient::create_worklog(self, input).await?.tempo_worklog_id)
    }

    async fn preview_create_worklog(&self, input: &WorklogInput) -> Result<PlannedRequest, AppError> {
        TempoClient::preview_create_worklog(self, input)
    }
}
