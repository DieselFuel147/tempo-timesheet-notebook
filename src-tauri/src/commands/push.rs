use tauri::State;

use async_trait::async_trait;

use crate::core::config::IntegrationConfig;
use crate::core::http::HttpClient;
use crate::core::jira::JiraClient;
use crate::core::push::{self, JiraPushClient, PushRepository, TempoPushClient};
use crate::core::tempo::TempoClient;
use crate::error::AppError;
use crate::state::{
    AppState, DryRunSummary, JiraIssueRef, JiraProfile, NotebookDay, PlannedRequest,
    PushSummary, Settings, TempoWorklog, WorklogInput,
};

#[tauri::command]
pub async fn push_day(date: String, state: State<'_, AppState>) -> Result<PushSummary, AppError> {
    let clients = IntegrationClients::from_state(state.inner())?;
    let repo = StateBackedPushRepo::new(state.inner());
    push::push_day(&date, &clients.jira, &clients.tempo, &repo).await
}

#[tauri::command]
pub async fn get_tempo_worklogs(
    date: String,
    state: State<'_, AppState>,
) -> Result<Vec<TempoWorklog>, AppError> {
    let clients = IntegrationClients::from_state(state.inner())?;
    let me = clients.jira.myself().await?;
    let entries = clients
        .tempo
        .list_worklogs_for_user(&me.account_id, &date, &date)
        .await?;

    let mut worklogs = Vec::with_capacity(entries.len());
    for entry in entries {
        let issue_key = resolve_issue_key(entry.issue_id, &clients.jira, state.inner()).await;
        worklogs.push(TempoWorklog {
            tempo_worklog_id: entry.tempo_worklog_id,
            issue_id: entry.issue_id,
            issue_key,
            time_spent_seconds: entry.time_spent_seconds,
            start_date: entry.start_date,
            start_time: entry.start_time,
            description: entry.description,
        });
    }

    Ok(worklogs)
}

/// Resolve a numeric issue id to its human-facing key, preferring the local
/// issue cache and falling back to a Jira lookup. Never fails the whole fetch:
/// on any error the stringified numeric id is returned so the worklog still
/// shows up.
async fn resolve_issue_key(issue_id: i64, jira: &JiraClient, state: &AppState) -> String {
    let id_string = issue_id.to_string();

    let cached = {
        let repo = match state.repo.lock() {
            Ok(repo) => repo,
            Err(_) => return id_string,
        };
        repo.get_cached_issue_by_id(&id_string).ok().flatten()
    };
    if let Some(cached) = cached {
        return cached.key;
    }

    match jira.resolve_issue_by_id(issue_id).await {
        Ok(issue) => {
            if let Ok(mut repo) = state.repo.lock() {
                let _ = repo.cache_issue(&issue.key, &issue.id, &issue.summary);
            }
            issue.key
        }
        Err(_) => id_string,
    }
}

#[tauri::command]
pub async fn dry_run_day(date: String, state: State<'_, AppState>) -> Result<DryRunSummary, AppError> {
    let clients = IntegrationClients::from_state(state.inner())?;
    let repo = StateBackedPushRepo::new(state.inner());
    push::dry_run_day(&date, &clients.jira, &clients.tempo, &repo).await
}

struct IntegrationClients {
    jira: JiraClient,
    tempo: TempoClient,
}

impl IntegrationClients {
    fn from_state(state: &AppState) -> Result<Self, AppError> {
        let config: IntegrationConfig = state.load_integration_config()?;
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
    async fn get_day(&self, date: &str) -> Result<NotebookDay, AppError> {
        let repo = self
            .state
            .repo
            .lock()
            .map_err(|_| AppError::internal("Failed to lock repository"))?;

        repo.get_notebook_day(date)
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
