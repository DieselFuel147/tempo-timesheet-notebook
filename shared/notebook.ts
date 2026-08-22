import type { NotebookBlock, WorklogInput } from './types'

export const MAX_SUMMARY_LENGTH = 500

// Must stay textually aligned with `auto_summary` in the Rust core/notebook
// module: trim, then cut to `maxChars` characters with a single '…' counted
// inside the limit.
export function autoSummary(text: string, maxChars: number = MAX_SUMMARY_LENGTH): string {
  const trimmed = text.trim()
  if (!trimmed.length) return 'Untitled entry'
  if (trimmed.length <= maxChars) return trimmed
  return trimmed.slice(0, Math.max(0, maxChars - 1)) + '…'
}

export function notebookBlockSummary(block: NotebookBlock, maxSummaryChars: number = MAX_SUMMARY_LENGTH): string {
  const override = block.summaryOverride?.trim()
  return override ? override : autoSummary(block.text, maxSummaryChars)
}

export function notebookBlockDurationMinutes(block: NotebookBlock): number | null {
  if (block.startMinute === null || block.endMinute === null) return null
  return block.endMinute - block.startMinute
}

export function isPersistedNotebookBlock(block: NotebookBlock): boolean {
  return block.startMinute !== null || block.text.trim().length > 0 || block.ticketId.trim().length > 0
}

export function notebookBlockToWorklogInput(
  block: NotebookBlock,
  issueId: number,
  authorAccountId: string,
  maxSummaryChars: number = MAX_SUMMARY_LENGTH,
): WorklogInput {
  const minutes = notebookBlockDurationMinutes(block)
  if (minutes === null || minutes <= 0 || block.startMinute === null) {
    throw new Error(`Block has an invalid time range (${block.startMinute}–${block.endMinute})`)
  }

  const hours = Math.floor(block.startMinute / 60)
  const mins = block.startMinute % 60
  const startTime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`

  return {
    issueId,
    timeSpentSeconds: minutes * 60,
    startDate: block.date,
    startTime,
    description: notebookBlockSummary(block, maxSummaryChars).trim(),
    authorAccountId,
  }
}

/** An entry whose auto summary would be shortened before upload. */
export interface TruncatedSummaryEntry {
  blockId: string
  ticketId: string
  /** Minutes from midnight; formatted by the UI layer. */
  startMinute: number
  original: string
  truncated: string
}

// Entries that a push would send with a truncated auto summary. Filters mirror
// the backend's push loop: closed + timed blocks, not already synced, no
// summary override (overrides are never truncated).
export function truncatedAutoSummaries(
  blocks: NotebookBlock[],
  maxSummaryChars: number,
): TruncatedSummaryEntry[] {
  const entries: TruncatedSummaryEntry[] = []
  for (const block of blocks) {
    if (!block.closed || block.startMinute === null || block.endMinute === null) continue
    if (block.tempoWorklogId != null) continue // synced — a push skips it
    if (block.summaryOverride?.trim()) continue
    const original = block.text.trim()
    if (original.length <= maxSummaryChars) continue
    entries.push({
      blockId: block.id,
      ticketId: block.ticketId.trim(),
      startMinute: block.startMinute,
      original,
      truncated: autoSummary(original, maxSummaryChars),
    })
  }
  return entries
}
