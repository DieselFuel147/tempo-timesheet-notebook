use std::path::Path;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::core::settings::{default_settings, merge_settings_value, validate_settings};
use crate::error::{AppError, ErrorCode};
use crate::state::{Day, Entry, EntrySaveInput, Settings};

use super::schema;

const SETTINGS_KEY: &str = "app";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CachedIssue {
    pub key: String,
    pub issue_id: String,
    pub summary: String,
    pub cached_at: String,
}

struct EntryRow {
    id: String,
    date: String,
    start_time: String,
    end_time: String,
    ticket_key: String,
    summary: String,
    tempo_worklog_id: Option<i64>,
    synced_at: Option<String>,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn db_error(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::DbError, message)
}

fn row_to_entry(row: EntryRow) -> Entry {
    Entry {
        id: row.id,
        date: row.date,
        start: row.start_time,
        end: row.end_time,
        ticket_key: row.ticket_key,
        summary: row.summary,
        tempo_worklog_id: row.tempo_worklog_id,
        synced_at: row.synced_at,
    }
}

pub struct Repository {
    connection: Connection,
}

impl Repository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let connection = Connection::open(path.as_ref()).map_err(|error| {
            db_error(format!(
                "Failed to open SQLite database {}: {error}",
                path.as_ref().display()
            ))
        })?;
        Self::from_connection(connection)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self, AppError> {
        let connection = Connection::open_in_memory()
            .map_err(|error| db_error(format!("Failed to open in-memory SQLite database: {error}")))?;
        Self::from_connection(connection)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, AppError> {
        let _ = connection.pragma_update(None, "journal_mode", "WAL");
        schema::apply_migrations(&mut connection)
            .map_err(|error| db_error(format!("Failed to apply SQLite migrations: {error}")))?;

        Ok(Self { connection })
    }

    pub fn get_day(&self, date: &str) -> Result<Day, AppError> {
        let notes = self
            .connection
            .query_row("SELECT notes FROM days WHERE date = ?1", [date], |row| row.get::<_, String>(0))
            .optional()
            .map_err(|error| db_error(format!("Failed to load day notes for {date}: {error}")))?
            .unwrap_or_default();

        let mut statement = self
            .connection
            .prepare(
                "SELECT id, date, start_time, end_time, ticket_key, summary, tempo_worklog_id, synced_at
                 FROM entries
                 WHERE date = ?1
                 ORDER BY sort_order, start_time",
            )
            .map_err(|error| db_error(format!("Failed to prepare day entry query: {error}")))?;

        let entries = statement
            .query_map([date], |row| {
                Ok(EntryRow {
                    id: row.get(0)?,
                    date: row.get(1)?,
                    start_time: row.get(2)?,
                    end_time: row.get(3)?,
                    ticket_key: row.get(4)?,
                    summary: row.get(5)?,
                    tempo_worklog_id: row.get(6)?,
                    synced_at: row.get(7)?,
                })
            })
            .map_err(|error| db_error(format!("Failed to query entries for {date}: {error}")))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| db_error(format!("Failed to parse entries for {date}: {error}")))?
            .into_iter()
            .map(row_to_entry)
            .collect();

        Ok(Day {
            date: date.to_string(),
            notes,
            entries,
        })
    }

    pub fn save_notes(&mut self, date: &str, notes: &str) -> Result<(), AppError> {
        self.connection
            .execute(
                "INSERT INTO days (date, notes, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(date) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at",
                params![date, notes, now()],
            )
            .map_err(|error| db_error(format!("Failed to save notes for {date}: {error}")))?;
        Ok(())
    }

    pub fn upsert_entry(&mut self, input: EntrySaveInput) -> Result<Entry, AppError> {
        let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let sort_order = input.sort_order.unwrap_or(0) as i64;
        let updated_at = now();

        let transaction = self
            .connection
            .transaction()
            .map_err(|error| db_error(format!("Failed to start entry save transaction: {error}")))?;

        transaction
            .execute(
                "INSERT OR IGNORE INTO days (date, notes, updated_at) VALUES (?1, '', ?2)",
                params![&input.date, &updated_at],
            )
            .map_err(|error| db_error(format!("Failed to ensure day row exists: {error}")))?;

        transaction
            .execute(
                "INSERT INTO entries (id, date, start_time, end_time, ticket_key, summary, sort_order, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                   date = excluded.date,
                   start_time = excluded.start_time,
                   end_time = excluded.end_time,
                   ticket_key = excluded.ticket_key,
                   summary = excluded.summary,
                   sort_order = excluded.sort_order,
                   updated_at = excluded.updated_at",
                params![
                    &id,
                    &input.date,
                    &input.start,
                    &input.end,
                    &input.ticket_key,
                    &input.summary,
                    sort_order,
                    &updated_at,
                ],
            )
            .map_err(|error| db_error(format!("Failed to save entry {id}: {error}")))?;

        let row = transaction
            .query_row(
                "SELECT id, date, start_time, end_time, ticket_key, summary, tempo_worklog_id, synced_at
                 FROM entries WHERE id = ?1",
                [&id],
                |row| {
                    Ok(EntryRow {
                        id: row.get(0)?,
                        date: row.get(1)?,
                        start_time: row.get(2)?,
                        end_time: row.get(3)?,
                        ticket_key: row.get(4)?,
                        summary: row.get(5)?,
                        tempo_worklog_id: row.get(6)?,
                        synced_at: row.get(7)?,
                    })
                },
            )
            .map_err(|error| db_error(format!("Failed to reload saved entry {id}: {error}")))?;

        transaction
            .commit()
            .map_err(|error| db_error(format!("Failed to commit entry save transaction: {error}")))?;

        Ok(row_to_entry(row))
    }

    pub fn delete_entry(&mut self, id: &str) -> Result<(), AppError> {
        self.connection
            .execute("DELETE FROM entries WHERE id = ?1", [id])
            .map_err(|error| db_error(format!("Failed to delete entry {id}: {error}")))?;
        Ok(())
    }

    pub fn mark_synced(&mut self, id: &str, tempo_worklog_id: i64) -> Result<(), AppError> {
        self.connection
            .execute(
                "UPDATE entries SET tempo_worklog_id = ?1, synced_at = ?2 WHERE id = ?3",
                params![tempo_worklog_id, now(), id],
            )
            .map_err(|error| db_error(format!("Failed to mark entry {id} as synced: {error}")))?;
        Ok(())
    }

    pub fn list_dates(&self, from: Option<&str>, to: Option<&str>) -> Result<Vec<String>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT date FROM (
                    SELECT date FROM entries
                    UNION
                    SELECT date FROM days
                 )
                 WHERE (?1 IS NULL OR date >= ?1)
                   AND (?2 IS NULL OR date <= ?2)
                 ORDER BY date DESC",
            )
            .map_err(|error| db_error(format!("Failed to prepare date listing query: {error}")))?;

        let dates = statement
            .query_map(params![from, to], |row| row.get::<_, String>(0))
            .map_err(|error| db_error(format!("Failed to list stored dates: {error}")))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| db_error(format!("Failed to parse stored dates: {error}")))?;

        Ok(dates)
    }

    pub fn get_cached_issue(&self, key: &str) -> Result<Option<CachedIssue>, AppError> {
        self.connection
            .query_row(
                "SELECT key, issue_id, summary, cached_at FROM issue_cache WHERE key = ?1",
                [key],
                |row| {
                    Ok(CachedIssue {
                        key: row.get(0)?,
                        issue_id: row.get(1)?,
                        summary: row.get(2)?,
                        cached_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|error| db_error(format!("Failed to load cached issue {key}: {error}")))
    }

    pub fn cache_issue(&mut self, key: &str, issue_id: &str, summary: &str) -> Result<(), AppError> {
        self.connection
            .execute(
                "INSERT INTO issue_cache (key, issue_id, summary, cached_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(key) DO UPDATE SET issue_id = excluded.issue_id, summary = excluded.summary, cached_at = excluded.cached_at",
                params![key, issue_id, summary, now()],
            )
            .map_err(|error| db_error(format!("Failed to cache issue {key}: {error}")))?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<Settings, AppError> {
        let raw_value = self
            .connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [SETTINGS_KEY], |row| row.get::<_, String>(0))
            .optional()
            .map_err(|error| db_error(format!("Failed to load settings: {error}")))?;

        let Some(raw_value) = raw_value else {
            return Ok(default_settings());
        };

        let value: serde_json::Value = match serde_json::from_str(&raw_value) {
            Ok(value) => value,
            Err(_) => return Ok(default_settings()),
        };

        Ok(merge_settings_value(&value))
    }

    pub fn save_settings(&mut self, settings: &Settings) -> Result<Settings, AppError> {
        validate_settings(settings).map_err(|message| AppError::new(ErrorCode::ValidationError, message))?;

        let mut sanitized = settings.clone();
        sanitized.connections.jira.api_token_saved = false;
        sanitized.connections.tempo.api_token_saved = false;

        let merged = merge_settings_value(
            &serde_json::to_value(&sanitized)
                .map_err(|error| AppError::internal(format!("Failed to serialize settings: {error}")))?,
        );
        let serialized = serde_json::to_string(&merged)
            .map_err(|error| AppError::internal(format!("Failed to serialize merged settings: {error}")))?;

        self.connection
            .execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![SETTINGS_KEY, serialized, now()],
            )
            .map_err(|error| db_error(format!("Failed to save settings: {error}")))?;

        Ok(merged)
    }
}

#[cfg(test)]
mod tests {
    use super::Repository;
    use crate::state::{EntrySaveInput, Settings, ThresholdSettings};

    fn sample_input(date: &str) -> EntrySaveInput {
        EntrySaveInput {
            id: None,
            date: date.to_string(),
            start: "09:00".into(),
            end: "09:30".into(),
            ticket_key: "ABC-123".into(),
            summary: "Test entry".into(),
            sort_order: Some(2),
        }
    }

    #[test]
    fn returns_empty_day_when_unset() {
        let repo = Repository::in_memory().expect("repo");

        let day = repo.get_day("2026-07-12").expect("get day");

        assert_eq!(day.date, "2026-07-12");
        assert_eq!(day.notes, "");
        assert!(day.entries.is_empty());
    }

    #[test]
    fn upsert_entry_creates_day_and_persists_entry() {
        let mut repo = Repository::in_memory().expect("repo");

        let entry = repo.upsert_entry(sample_input("2026-07-12")).expect("save entry");
        let day = repo.get_day("2026-07-12").expect("get day");

        assert_eq!(entry.date, "2026-07-12");
        assert_eq!(day.entries.len(), 1);
        assert_eq!(day.entries[0].id, entry.id);
        assert_eq!(repo.list_dates(None, None).expect("list dates"), vec!["2026-07-12"]);
    }

    #[test]
    fn preserves_sync_metadata_when_updating_existing_entry() {
        let mut repo = Repository::in_memory().expect("repo");
        let entry = repo.upsert_entry(sample_input("2026-07-12")).expect("save entry");
        repo.mark_synced(&entry.id, 42).expect("mark synced");

        let updated = repo
            .upsert_entry(EntrySaveInput {
                id: Some(entry.id.clone()),
                date: "2026-07-12".into(),
                start: "10:00".into(),
                end: "10:30".into(),
                ticket_key: "ABC-123".into(),
                summary: "Updated".into(),
                sort_order: Some(0),
            })
            .expect("update entry");

        assert_eq!(updated.tempo_worklog_id, Some(42));
        assert!(updated.synced_at.is_some());
    }

    #[test]
    fn issue_cache_upserts_by_ticket_key() {
        let mut repo = Repository::in_memory().expect("repo");

        repo.cache_issue("ABC-123", "1001", "First").expect("cache issue");
        repo.cache_issue("ABC-123", "1002", "Second").expect("update issue cache");

        let cached = repo
            .get_cached_issue("ABC-123")
            .expect("get cached issue")
            .expect("cached issue present");
        assert_eq!(cached.issue_id, "1002");
        assert_eq!(cached.summary, "Second");
    }

    #[test]
    fn settings_default_when_missing_or_corrupt_and_merge_partial_blobs() {
        let repo = Repository::in_memory().expect("repo");

        assert_eq!(repo.get_settings().expect("default settings"), Settings::default());

        repo.connection
            .execute(
                "INSERT INTO settings (key, value, updated_at) VALUES ('app', '{bad json', '2026-07-12T00:00:00Z')",
                [],
            )
            .expect("insert corrupt settings");
        assert_eq!(repo.get_settings().expect("corrupt settings fallback"), Settings::default());

        repo.connection
            .execute(
                r#"UPDATE settings SET value = '{"validation":{"maxDayHours":8,"unknown":123}}' WHERE key = 'app'"#,
                [],
            )
            .expect("update partial settings");

        let settings = repo.get_settings().expect("merged settings");
        assert_eq!(settings.validation.max_day_hours, 8.0);
        assert_eq!(settings.validation.min_day_hours, Settings::default().validation.min_day_hours);
        assert_eq!(settings.validation.admin_ticket, Settings::default().validation.admin_ticket);
    }

    #[test]
    fn save_settings_validates_threshold_relationships() {
        let mut repo = Repository::in_memory().expect("repo");

        let result = repo.save_settings(&Settings {
            validation: ThresholdSettings {
                workday_end_min: 480,
                workday_start_min: 480,
                ..ThresholdSettings::default()
            },
            ..Settings::default()
        });

        assert!(result.is_err());
        assert_eq!(result.unwrap_err().to_string(), "End of the working day must be after the start.");
    }

    #[test]
    fn save_settings_persists_connection_fields_without_secret_presence_flags() {
        let mut repo = Repository::in_memory().expect("repo");

        let saved = repo
            .save_settings(&Settings {
                connections: crate::state::ConnectionSettings {
                    jira: crate::state::JiraConnectionSettings {
                        base_url: String::from("https://jira.example.com/"),
                        email: String::from("user@example.com"),
                        api_token_saved: true,
                    },
                    tempo: crate::state::TempoConnectionSettings {
                        base_url: String::from("https://api.tempo.io/4/"),
                        api_token_saved: true,
                    },
                },
                ..Settings::default()
            })
            .expect("save settings");

        assert_eq!(saved.connections.jira.base_url, "https://jira.example.com");
        assert_eq!(saved.connections.tempo.base_url, "https://api.tempo.io/4");
        assert!(!saved.connections.jira.api_token_saved);
        assert!(!saved.connections.tempo.api_token_saved);
    }
}
