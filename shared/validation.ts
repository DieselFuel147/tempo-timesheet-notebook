import type { NotebookBlock } from './types'

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

function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Split issues into errors/warnings and report whether the day is pushable. */
export function summarizeIssues(issues: ValidationIssue[]) {
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  return { errors, warnings, hasErrors: errors.length > 0 }
}

/** Notebook-block duration in minutes, or null if the block is not fully timed. */
export function notebookBlockDurationMinutes(block: NotebookBlock): number | null {
  if (block.startMinute === null || block.endMinute === null) return null
  return block.endMinute - block.startMinute
}

/** Validate a single notebook block in isolation. */
export function validateNotebookBlock(
  block: NotebookBlock,
  config: ValidationConfig = defaultConfig,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (level: IssueLevel, code: string, message: string) =>
    issues.push({ level, code, message, entryId: block.id })

  const key = block.ticketId.trim()
  if (!key) {
    add('error', 'INVALID_TICKET', 'Ticket is required (e.g. ABC-123).')
  } else if (!config.ticketPattern.test(key)) {
    add('error', 'INVALID_TICKET', `"${block.ticketId}" is not a valid ticket key (expected e.g. ABC-123).`)
  }

  if (block.startMinute === null && block.endMinute !== null) {
    add('error', 'INVALID_START', 'Block end time cannot exist without a start time.')
  }

  if (block.startMinute !== null) {
    if (block.startMinute < 0 || block.startMinute > 1439) {
      add('error', 'INVALID_START', `Start minute ${block.startMinute} is out of range.`)
    }
  }

  if (block.endMinute !== null) {
    if (block.endMinute < 0 || block.endMinute > 1440) {
      add('error', 'INVALID_END', `End minute ${block.endMinute} is out of range.`)
    }
  }

  const duration = notebookBlockDurationMinutes(block)
  if (block.closed) {
    if (block.startMinute === null || block.endMinute === null) {
      add('error', 'INCOMPLETE_BLOCK', 'Closed blocks must have both start and end times.')
    } else if (duration !== null) {
      if (duration <= 0) {
        add('error', 'BAD_RANGE', `End (${block.endMinute}) must be after start (${block.startMinute}).`)
      } else {
        if (duration < config.minEntryMinutes) {
          add('warning', 'TOO_SHORT', `Only ${duration} min — shorter than ${config.minEntryMinutes} min.`)
        }
        if (duration > config.maxEntryHours * 60) {
          add('warning', 'TOO_LONG', `${(duration / 60).toFixed(2)}h in one block — over ${config.maxEntryHours}h.`)
        }
      }
    }
  } else if (block.endMinute !== null) {
    add('error', 'OPEN_BLOCK_HAS_END', 'Open blocks cannot have an end time.')
  }

  if (block.startMinute !== null && block.startMinute < config.workdayStartMin) {
    add('warning', 'EARLY', `Starts before normal hours (${fmtMin(config.workdayStartMin)}).`)
  }
  if (block.endMinute !== null && block.endMinute > config.workdayEndMin) {
    add('warning', 'LATE', `Ends after normal hours (${fmtMin(config.workdayEndMin)}).`)
  }

  if (!block.text.trim()) add('warning', 'NO_TEXT', 'No note text — add detail for what you did.')

  return issues
}

/** Validate a whole notebook day: every persisted block, overlaps, and total. */
export function validateNotebookDay(
  blocks: NotebookBlock[],
  config: ValidationConfig = defaultConfig,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const block of blocks) issues.push(...validateNotebookBlock(block, config))

  const closedTimed = blocks
    .map((block) => ({ block, s: block.startMinute, e: block.endMinute }))
    .filter((x): x is { block: NotebookBlock; s: number; e: number } => x.s !== null && x.e !== null && x.e > x.s)
    .sort((a, b) => a.s - b.s)

  for (let i = 0; i < closedTimed.length - 1; i++) {
    if (closedTimed[i].e > closedTimed[i + 1].s) {
      issues.push({
        level: 'error',
        code: 'OVERLAP',
        message: `Overlaps: ${closedTimed[i].s}-${closedTimed[i].e} and ${closedTimed[i + 1].s}-${closedTimed[i + 1].e}.`,
        entryId: closedTimed[i + 1].block.id,
      })
    }
  }

  const totalHours = closedTimed.reduce((sum, x) => sum + (x.e - x.s), 0) / 60
  if (closedTimed.length > 0 && totalHours < config.minDayHours) {
    issues.push({ level: 'warning', code: 'DAY_LOW', message: `Only ${totalHours.toFixed(2)}h logged (under ${config.minDayHours}h).` })
  }
  if (totalHours > config.maxDayHours) {
    issues.push({ level: 'warning', code: 'DAY_HIGH', message: `${totalHours.toFixed(2)}h logged (over ${config.maxDayHours}h).` })
  }

  return issues
}
