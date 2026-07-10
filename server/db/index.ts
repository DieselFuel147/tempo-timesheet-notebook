import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Single local SQLite file under data/ (gitignored). One user, one machine.
const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', '..', 'data')
mkdirSync(dataDir, { recursive: true })
const dbPath = process.env.DB_PATH ?? join(dataDir, 'tempo.db')

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

db.exec(`
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

  -- Caches key -> numeric issue id so we don't re-hit Jira on every push.
  CREATE TABLE IF NOT EXISTS issue_cache (
    key TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    cached_at TEXT NOT NULL
  );

  -- App settings as JSON blobs keyed by section (currently just 'app'). A single
  -- document per key keeps this forward-compatible: new fields fall back to
  -- defaults on read (see repo.getSettings / shared mergeSettings).
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)
