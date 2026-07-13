import { db } from './index'
import type { NotebookBlock, NotebookDay } from '../../shared/types'
import { defaultSettings, mergeSettings, type Settings } from '../../shared/settings'

interface NotebookBlockRow {
  id: string
  date: string
  start_minute: number | null
  end_minute: number | null
  text: string
  closed: number
  ticket_id: string
  summary_override: string | null
  sort_order: number
  tempo_worklog_id: number | null
  synced_at: string | null
  updated_at: string
}

function rowToNotebookBlock(row: NotebookBlockRow): NotebookBlock {
  return {
    id: row.id,
    date: row.date,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    text: row.text,
    closed: row.closed !== 0,
    ticketId: row.ticket_id,
    summaryOverride: row.summary_override,
    tempoWorklogId: row.tempo_worklog_id,
    syncedAt: row.synced_at,
  }
}

const now = () => new Date().toISOString()

export function getNotebookDay(date: string): NotebookDay {
  const rows = db
    .prepare('SELECT * FROM notebook_blocks WHERE date = ? ORDER BY sort_order, COALESCE(start_minute, 2147483647), id')
    .all(date) as NotebookBlockRow[]

  return {
    date,
    blocks: rows.map(rowToNotebookBlock),
  }
}

export function saveNotebookDay(day: NotebookDay): NotebookDay {
  const timestamp = now()
  const transaction = db.transaction((input: NotebookDay) => {
    db.prepare(
      `INSERT INTO notebook_days (date, updated_at) VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET updated_at = excluded.updated_at`,
    ).run(input.date, timestamp)

    db.prepare('DELETE FROM notebook_blocks WHERE date = ?').run(input.date)

    const insert = db.prepare(
      `INSERT INTO notebook_blocks (
         id, date, start_minute, end_minute, text, closed, ticket_id, summary_override,
         sort_order, tempo_worklog_id, synced_at, updated_at
       ) VALUES (
         @id, @date, @startMinute, @endMinute, @text, @closed, @ticketId, @summaryOverride,
         @sortOrder, @tempoWorklogId, @syncedAt, @updatedAt
       )`,
    )

    input.blocks.forEach((block, sortOrder) => {
      insert.run({
        id: block.id,
        date: input.date,
        startMinute: block.startMinute,
        endMinute: block.endMinute,
        text: block.text,
        closed: block.closed ? 1 : 0,
        ticketId: block.ticketId,
        summaryOverride: block.summaryOverride ?? null,
        sortOrder,
        tempoWorklogId: block.tempoWorklogId ?? null,
        syncedAt: block.syncedAt ?? null,
        updatedAt: timestamp,
      })
    })
  })

  transaction(day)
  return getNotebookDay(day.date)
}

export function markSynced(id: string, tempoWorklogId: number): void {
  db.prepare('UPDATE notebook_blocks SET tempo_worklog_id = ?, synced_at = ? WHERE id = ?').run(
    tempoWorklogId,
    now(),
    id,
  )
}

export function listDates(): string[] {
  const rows = db
    .prepare('SELECT date FROM notebook_blocks UNION SELECT date FROM notebook_days ORDER BY date DESC')
    .all() as { date: string }[]
  return rows.map((r) => r.date)
}

export function getCachedIssueId(key: string): string | null {
  const r = db.prepare('SELECT issue_id FROM issue_cache WHERE key = ?').get(key) as
    | { issue_id: string }
    | undefined
  return r?.issue_id ?? null
}

export function cacheIssue(key: string, issueId: string, summary: string): void {
  db.prepare(
    `INSERT INTO issue_cache (key, issue_id, summary, cached_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET issue_id = excluded.issue_id, summary = excluded.summary, cached_at = excluded.cached_at`,
  ).run(key, issueId, summary, now())
}

const SETTINGS_KEY = 'app'

/** Read app settings, merged over current defaults (returns defaults if never saved). */
export function getSettings(): Settings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY) as
    | { value: string }
    | undefined
  if (!row) return defaultSettings
  try {
    return mergeSettings(JSON.parse(row.value))
  } catch {
    return defaultSettings
  }
}

/** Persist app settings (merged over defaults first). Returns the stored result. */
export function saveSettings(settings: Settings): Settings {
  const merged = mergeSettings(settings)
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(SETTINGS_KEY, JSON.stringify(merged), now())
  return merged
}
