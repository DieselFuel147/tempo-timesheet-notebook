import type { NotebookBlock, WorklogInput } from './types'

export const MAX_SUMMARY_LENGTH = 200

export function autoSummary(text: string, maxChars = MAX_SUMMARY_LENGTH): string {
  const trimmed = text.trim()
  if (!trimmed.length) return 'Untitled entry'
  const short = trimmed.slice(0, maxChars)
  return short + (trimmed.length > maxChars ? '…' : '')
}

export function notebookBlockSummary(block: NotebookBlock): string {
  const override = block.summaryOverride?.trim()
  return override ? override : autoSummary(block.text)
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
    description: notebookBlockSummary(block).trim(),
    authorAccountId,
  }
}
