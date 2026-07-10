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

/** An editable time-log entry as it exists in the UI and local storage. */
export interface Entry {
  id: string
  date: string // YYYY-MM-DD
  start: string // HH:mm (24-hour)
  end: string // HH:mm (24-hour)
  ticketKey: string // e.g. "REACT-1540"
  summary: string
  /** Set once the entry has been pushed to Tempo — drives idempotent re-push. */
  tempoWorklogId?: number | null
  syncedAt?: string | null
}

/** A single day: its entries plus freeform notes that never go to Tempo. */
export interface Day {
  date: string // YYYY-MM-DD
  notes: string
  entries: Entry[]
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
