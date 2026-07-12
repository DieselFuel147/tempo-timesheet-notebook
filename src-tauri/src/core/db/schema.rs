use rusqlite::Connection;

const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  ticket_key TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  tempo_worklog_id INTEGER,
  synced_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);

CREATE TABLE IF NOT EXISTS issue_cache (
  key TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  cached_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"#];

pub fn apply_migrations(connection: &mut Connection) -> rusqlite::Result<()> {
    let current_version: usize = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if current_version >= MIGRATIONS.len() {
        return Ok(());
    }

    let transaction = connection.transaction()?;
    for (index, migration) in MIGRATIONS.iter().enumerate().skip(current_version) {
        transaction.execute_batch(migration)?;
        transaction.pragma_update(None, "user_version", index + 1)?;
    }
    transaction.commit()?;

    Ok(())
}
