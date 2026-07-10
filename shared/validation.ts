import type { Entry } from './types'

// Pure validation, shared by the browser (live feedback as you type) and the
// server (the gate that runs again before anything is pushed to Tempo — the
// client is never trusted). No I/O here, so it is trivially unit-testable.
//
// Two tiers:
//   - errors   block the push (malformed data, impossible or overlapping times)
//   - warnings are overridable (unusual durations, out-of-hours, odd day totals)
//
// Ticket *existence* (does REACT-1540 actually exist in Jira?) is NOT checked
// here — that needs a Jira call and is validated server-side at push time.

export type IssueLevel = 'error' | 'warning'

export interface ValidationIssue {
  level: IssueLevel
  code: string
  message: string
  entryId?: string
}

export interface ValidationConfig {
  /** Ticket stamped by the "General admin" button. */
  adminTicket: string
  /** Shape a ticket key must match. */
  ticketPattern: RegExp
  /** Normal working window, in minutes from midnight. */
  workdayStartMin: number
  workdayEndMin: number
  /** Per-entry duration guards. */
  minEntryMinutes: number
  maxEntryHours: number
  /** Per-day total guards. */
  minDayHours: number
  maxDayHours: number
}

export const defaultConfig: ValidationConfig = {
  adminTicket: 'ADMIN-TICKET',
  ticketPattern: /^[A-Z][A-Z0-9]*-\d+$/,
  workdayStartMin: 8 * 60, // 08:00
  workdayEndMin: 18 * 60, // 18:00
  minEntryMinutes: 10,
  maxEntryHours: 4,
  minDayHours: 4,
  maxDayHours: 12,
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** Parse "HH:mm" to minutes-from-midnight, or null if malformed. */
export function parseTime(hhmm: string): number | null {
  const m = TIME_RE.exec(hhmm.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Entry duration in minutes, or null if either time is malformed. */
export function entryDurationMinutes(entry: Entry): number | null {
  const s = parseTime(entry.start)
  const e = parseTime(entry.end)
  if (s === null || e === null) return null
  return e - s
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Validate a single entry in isolation. */
export function validateEntry(entry: Entry, config: ValidationConfig = defaultConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (level: IssueLevel, code: string, message: string) =>
    issues.push({ level, code, message, entryId: entry.id })

  const key = entry.ticketKey.trim()
  if (!key) {
    add('error', 'INVALID_TICKET', 'Ticket is required (e.g. ABC-123).')
  } else if (!config.ticketPattern.test(key)) {
    add('error', 'INVALID_TICKET', `"${entry.ticketKey}" is not a valid ticket key (expected e.g. ABC-123).`)
  }

  const start = parseTime(entry.start)
  const end = parseTime(entry.end)
  if (start === null) add('error', 'INVALID_START', `Start time "${entry.start}" is not valid (use HH:mm).`)
  if (end === null) add('error', 'INVALID_END', `End time "${entry.end}" is not valid (use HH:mm).`)

  if (start !== null && end !== null) {
    const dur = end - start
    if (dur <= 0) {
      add('error', 'BAD_RANGE', `End (${entry.end}) must be after start (${entry.start}).`)
    } else {
      if (dur < config.minEntryMinutes)
        add('warning', 'TOO_SHORT', `Only ${dur} min — shorter than ${config.minEntryMinutes} min.`)
      if (dur > config.maxEntryHours * 60)
        add('warning', 'TOO_LONG', `${(dur / 60).toFixed(2)}h in one block — over ${config.maxEntryHours}h.`)
    }
    if (start < config.workdayStartMin)
      add('warning', 'EARLY', `Starts ${entry.start}, before normal hours (${fmtMin(config.workdayStartMin)}).`)
    if (end > config.workdayEndMin)
      add('warning', 'LATE', `Ends ${entry.end}, after normal hours (${fmtMin(config.workdayEndMin)}).`)
  }

  if (!entry.summary.trim()) add('warning', 'NO_SUMMARY', 'No summary — add a short note of what you did.')

  return issues
}

/** Validate a whole day: every entry, plus overlaps and the daily total. */
export function validateDay(entries: Entry[], config: ValidationConfig = defaultConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const e of entries) issues.push(...validateEntry(e, config))

  // Only well-formed, positive-duration entries participate in overlap/total checks.
  const timed = entries
    .map((e) => ({ e, s: parseTime(e.start), en: parseTime(e.end) }))
    .filter((x): x is { e: Entry; s: number; en: number } => x.s !== null && x.en !== null && x.en > x.s)
    .sort((a, b) => a.s - b.s)

  for (let i = 0; i < timed.length - 1; i++) {
    if (timed[i].en > timed[i + 1].s) {
      issues.push({
        level: 'error',
        code: 'OVERLAP',
        message: `Overlaps: ${timed[i].e.start}-${timed[i].e.end} and ${timed[i + 1].e.start}-${timed[i + 1].e.end}.`,
        entryId: timed[i + 1].e.id,
      })
    }
  }

  const totalHours = timed.reduce((sum, x) => sum + (x.en - x.s), 0) / 60
  if (entries.length > 0 && totalHours < config.minDayHours) {
    issues.push({ level: 'warning', code: 'DAY_LOW', message: `Only ${totalHours.toFixed(2)}h logged (under ${config.minDayHours}h).` })
  }
  if (totalHours > config.maxDayHours) {
    issues.push({ level: 'warning', code: 'DAY_HIGH', message: `${totalHours.toFixed(2)}h logged (over ${config.maxDayHours}h).` })
  }

  return issues
}

/** Split issues into errors/warnings and report whether the day is pushable. */
export function summarizeIssues(issues: ValidationIssue[]) {
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  return { errors, warnings, hasErrors: errors.length > 0 }
}
