// Core domain + API types shared between the browser and the server.

/** A Jira issue key like "REACT-1540". */
export type IssueKey = string

export interface JiraProfile {
  accountId: string
  displayName: string
  emailAddress?: string
  timeZone: string
}

export interface JiraIssueRef {
  id: string // numeric issue id as a string, e.g. "10542"
  key: IssueKey // e.g. "REACT-1540"
  summary: string
}

/**
 * A notebook-first work block. Time is captured as minutes from midnight so the
 * UI can infer and adjust boundaries directly without round-tripping through
 * HH:mm strings on every edit.
 */
export interface NotebookBlock {
  id: string
  date: string // YYYY-MM-DD
  startMinute: number | null
  endMinute: number | null
  text: string
  closed: boolean
  ticketId: string
  summaryOverride?: string | null
  /** Set once the block has been pushed to Tempo — drives idempotent re-push. */
  tempoWorklogId?: number | null
  syncedAt?: string | null
}

/** A single notebook day: all persisted blocks in chronological UI order. */
export interface NotebookDay {
  date: string // YYYY-MM-DD
  blocks: NotebookBlock[]
}

/** A fully-resolved worklog ready to POST to Tempo's /worklogs endpoint. */
export interface WorklogInput {
  issueId: number
  timeSpentSeconds: number
  startDate: string // YYYY-MM-DD
  startTime: string // HH:mm:ss
  description: string
  authorAccountId: string
}

/** Outcome of pushing a single notebook block to Tempo. */
export interface BlockPushResult {
  blockId: string
  ticketId: string
  ok: boolean
  tempoWorklogId?: number
  error?: string
}

/** Outcome of pushing a whole notebook day to Tempo. */
export interface PushSummary {
  results: BlockPushResult[]
  synced: number
  failed: number
  skipped: number // already-synced blocks left untouched (idempotency)
  blocked: string[] // validation errors that stopped the whole push
}

/** The exact HTTP request that would be sent (auth token redacted). */
export interface PlannedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

export interface PlannedWorklog {
  blockId: string
  ticketId: string
  issueId: number
  request: PlannedRequest
}

/** Result of a dry-run push: what would be sent, with nothing actually sent. */
export interface DryRunSummary {
  dryRun: true
  planned: PlannedWorklog[]
  skipped: number
  blocked: string[]
}

/**
 * A confirmed worklog read back from Tempo for a given day. Tempo's v4 worklog
 * only carries the numeric issue id, so `issueKey` is resolved server-side (via
 * the Jira issue cache) and falls back to the stringified id when unresolved.
 */
export interface TempoWorklog {
  tempoWorklogId: number
  issueId: number
  issueKey: string
  timeSpentSeconds: number
  startDate: string // YYYY-MM-DD
  startTime: string // HH:mm:ss
  description: string
}
