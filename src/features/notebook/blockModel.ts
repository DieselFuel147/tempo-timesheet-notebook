import type { NotebookBlock, NotebookDay } from '@shared/types'
import { notebookBlockSummary } from '@shared/notebook'
import { todayISO } from '@app/dateutil'

export const DAY_MINUTES = 24 * 60

export const IDLE_THRESHOLD_MS = 3 * 60 * 1000

export const TIMELINE_REFRESH_MS = 1000

export const MIN_BLOCK_DURATION_MINUTES = 1

// Debug-only clock multiplier (VITE_NOTEBOOK_TIME_SCALE) so idle auto-close and
// live logging can be exercised without waiting in real time.
export const DEBUG_TIME_SCALE = Number(import.meta.env.VITE_NOTEBOOK_TIME_SCALE ?? '1')

export function effectiveIdleThresholdMs(): number {
  return IDLE_THRESHOLD_MS / Math.max(DEBUG_TIME_SCALE, 0.0001)
}

export function createBlankBlock(date: string): NotebookBlock {
  return {
    id: crypto.randomUUID(),
    date,
    startMinute: null,
    endMinute: null,
    text: '',
    closed: false,
    ticketId: '',
    summaryOverride: null,
    tempoWorklogId: null,
    syncedAt: null,
  }
}

export function cloneBlock(block: NotebookBlock): NotebookBlock {
  return {
    ...block,
    summaryOverride: block.summaryOverride ?? null,
    manualEnd: block.manualEnd ?? false,
    tempoWorklogId: block.tempoWorklogId ?? null,
    syncedAt: block.syncedAt ?? null,
  }
}

export function markBlockDirty(block: NotebookBlock): NotebookBlock {
  return {
    ...block,
    tempoWorklogId: null,
    syncedAt: null,
  }
}

export function blockHasPushRelevantChanges(previous: NotebookBlock, next: NotebookBlock): boolean {
  return (
    previous.startMinute !== next.startMinute ||
    previous.endMinute !== next.endMinute ||
    previous.closed !== next.closed ||
    previous.ticketId !== next.ticketId ||
    notebookBlockSummary(previous) !== notebookBlockSummary(next)
  )
}

export function normalizeNotebookDay(day: NotebookDay): NotebookDay {
  const clonedBlocks = day.blocks.map(cloneBlock)
  const blocks = clonedBlocks.length > 0 ? clonedBlocks : [createBlankBlock(day.date)]
  const last = blocks[blocks.length - 1]
  const needsTrailingBlank =
    last.startMinute !== null || last.text.trim().length > 0 || last.ticketId.trim().length > 0

  return {
    date: day.date,
    blocks: needsTrailingBlank ? [...blocks, createBlankBlock(day.date)] : blocks,
  }
}

export function persistedNotebookDay(day: NotebookDay): NotebookDay {
  return {
    date: day.date,
    blocks: day.blocks
      .filter((block) => block.startMinute !== null || block.text.trim().length > 0 || block.ticketId.trim().length > 0)
      .map(cloneBlock),
  }
}

export function wallClockMinuteForDate(date: string): number {
  const now = new Date()
  const today = todayISO()
  if (date !== today) return 17 * 60
  return now.getHours() * 60 + now.getMinutes()
}

export function blockDuration(block: NotebookBlock, nowMinute: number): number | null {
  if (block.startMinute === null) return null
  const endMinute = block.closed ? block.endMinute : nowMinute
  if (endMinute === null) return null
  return Math.max(0, endMinute - block.startMinute)
}

export interface TimedBlockInfo {
  block: NotebookBlock
  index: number
  startMinute: number
  endMinute: number
}

export function getTimedBlocks(blocks: NotebookBlock[], nowMinute: number): TimedBlockInfo[] {
  return blocks
    .map((block, index) => {
      if (block.startMinute === null) return null
      return {
        block,
        index,
        startMinute: block.startMinute,
        endMinute: block.closed ? block.endMinute ?? block.startMinute : nowMinute,
      }
    })
    .filter((item): item is TimedBlockInfo => item !== null)
    .sort((left, right) => left.startMinute - right.startMinute)
}
