use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

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

#[derive(Clone, Serialize, Deserialize)]
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

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub validation: ThresholdSettings,
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
    pub headers: HashMap<String, String>,
    pub body: String,
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

#[derive(Default)]
pub struct Store {
    pub days: HashMap<String, Day>,
    pub settings: Settings,
}

#[derive(Default)]
pub struct AppState {
    pub store: Mutex<Store>,
}

pub fn default_profile() -> JiraProfile {
    JiraProfile {
        account_id: "tauri-scaffold".into(),
        display_name: "Tauri Scaffold".into(),
        email_address: None,
        time_zone: "Local".into(),
    }
}

pub fn get_or_create_day(store: &mut Store, date: &str) -> Day {
    store
        .days
        .entry(date.to_string())
        .or_insert_with(|| Day {
            date: date.to_string(),
            notes: String::new(),
            entries: Vec::new(),
        })
        .clone()
}
