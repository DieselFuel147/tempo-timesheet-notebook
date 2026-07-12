use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::core::config::{IntegrationConfig, IntegrationSecrets};
use crate::core::db::Repository;
use crate::core::secret_store::{SecretPresence, SecretStore};
use crate::error::AppError;

pub const TAURI_COMMAND_SET_VERSION: &str = "wave0";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    pub ok: bool,
    pub command_set_version: String,
}

impl Default for HealthStatus {
    fn default() -> Self {
        Self {
            ok: true,
            command_set_version: TAURI_COMMAND_SET_VERSION.into(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraProfile {
    pub account_id: String,
    pub display_name: String,
    pub email_address: Option<String>,
    pub time_zone: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct JiraIssueRef {
    pub id: String,
    pub key: String,
    pub summary: String,
}

#[derive(Clone, Serialize)]
pub struct TicketSuggestion {
    pub key: String,
    pub summary: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub date: String,
    pub start: String,
    pub end: String,
    pub ticket_key: String,
    pub summary: String,
    pub tempo_worklog_id: Option<i64>,
    pub synced_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Day {
    pub date: String,
    pub notes: String,
    pub entries: Vec<Entry>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySaveInput {
    pub id: Option<String>,
    pub date: String,
    pub start: String,
    pub end: String,
    pub ticket_key: String,
    pub summary: String,
    pub sort_order: Option<usize>,
}

#[derive(Clone, Serialize)]
pub struct OkResponse {
    pub ok: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThresholdSettings {
    pub admin_ticket: String,
    pub workday_start_min: i32,
    pub workday_end_min: i32,
    pub min_entry_minutes: i32,
    pub max_entry_hours: f64,
    pub min_day_hours: f64,
    pub max_day_hours: f64,
}

impl Default for ThresholdSettings {
    fn default() -> Self {
        Self {
            admin_ticket: "ADMIN-TICKET".into(),
            workday_start_min: 8 * 60,
            workday_end_min: 18 * 60,
            min_entry_minutes: 10,
            max_entry_hours: 4.0,
            min_day_hours: 4.0,
            max_day_hours: 12.0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JiraConnectionSettings {
    pub base_url: String,
    pub email: String,
    pub api_token_saved: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TempoConnectionSettings {
    pub base_url: String,
    pub api_token_saved: bool,
}

impl Default for TempoConnectionSettings {
    fn default() -> Self {
        Self {
            base_url: String::from("https://api.tempo.io/4"),
            api_token_saved: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSettings {
    pub jira: JiraConnectionSettings,
    pub tempo: TempoConnectionSettings,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct Settings {
    pub validation: ThresholdSettings,
    pub connections: ConnectionSettings,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SecretUpdates {
    pub jira_api_token: Option<String>,
    pub tempo_api_token: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPushResult {
    pub entry_id: String,
    pub ticket_key: String,
    pub ok: bool,
    pub tempo_worklog_id: Option<i64>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct PushSummary {
    pub results: Vec<EntryPushResult>,
    pub synced: usize,
    pub failed: usize,
    pub skipped: usize,
    pub blocked: Vec<String>,
}

#[derive(Clone, Serialize)]
pub struct PlannedRequest {
    pub method: String,
    pub url: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorklogInput {
    pub issue_id: i64,
    pub time_spent_seconds: i64,
    pub start_date: String,
    pub start_time: String,
    pub description: String,
    pub author_account_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedWorklog {
    pub entry_id: String,
    pub ticket_key: String,
    pub issue_id: i64,
    pub request: PlannedRequest,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DryRunSummary {
    pub dry_run: bool,
    pub planned: Vec<PlannedWorklog>,
    pub skipped: usize,
    pub blocked: Vec<String>,
}

pub struct AppState {
    pub repo: Mutex<Repository>,
    secrets: SecretStore,
}

impl AppState {
    pub fn new(app_handle: AppHandle) -> Result<Self, AppError> {
        let app_data_dir = app_handle.path().app_data_dir().map_err(|error| {
            AppError::internal(format!("Failed to resolve app data directory: {error}"))
        })?;

        std::fs::create_dir_all(&app_data_dir).map_err(|error| {
            AppError::internal(format!(
                "Failed to create app data directory {}: {error}",
                app_data_dir.display()
            ))
        })?;

        let repo = Repository::open(app_data_dir.join("tempo.db"))?;
        Ok(Self {
            repo: Mutex::new(repo),
            secrets: SecretStore::new(),
        })
    }

    pub fn get_settings(&self) -> Result<Settings, AppError> {
        let settings = self.load_stored_settings()?;
        self.attach_secret_presence(settings)
    }

    pub fn save_settings(
        &self,
        settings: &Settings,
        secret_updates: Option<SecretUpdates>,
    ) -> Result<Settings, AppError> {
        let mut repo = self
            .repo
            .lock()
            .map_err(|_| AppError::internal("Failed to lock repository"))?;

        let saved = repo.save_settings(settings)?;
        drop(repo);

        if let Some(secret_updates) = secret_updates {
            self.secrets.apply_updates(&secret_updates)?;
        }

        self.attach_secret_presence(saved)
    }

    pub fn load_integration_config(&self) -> Result<IntegrationConfig, AppError> {
        let settings = self.load_stored_settings()?;
        let secrets = IntegrationSecrets {
            jira_api_token: self.secrets.get_jira_api_token()?,
            tempo_api_token: self.secrets.get_tempo_api_token()?,
        };
        Ok(IntegrationConfig::from_settings(&settings, secrets))
    }

    fn load_stored_settings(&self) -> Result<Settings, AppError> {
        let repo = self
            .repo
            .lock()
            .map_err(|_| AppError::internal("Failed to lock repository"))?;

        repo.get_settings()
    }

    fn attach_secret_presence(&self, mut settings: Settings) -> Result<Settings, AppError> {
        let SecretPresence {
            jira_api_token_saved,
            tempo_api_token_saved,
        } = self.secrets.get_presence()?;
        settings.connections.jira.api_token_saved = jira_api_token_saved;
        settings.connections.tempo.api_token_saved = tempo_api_token_saved;
        Ok(settings)
    }
}

pub fn default_profile() -> JiraProfile {
    JiraProfile {
        account_id: "tauri-scaffold".into(),
        display_name: "Tauri Scaffold".into(),
        email_address: None,
        time_zone: "Local".into(),
    }
}
