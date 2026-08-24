import { describe, expect, it } from 'vitest'
import type { NotebookBlock } from '@shared/types'
import {
  DAY_MINUTES,
  MIN_BLOCK_DURATION_MINUTES,
  blockDuration,
  blockHasPushRelevantChanges,
  cloneBlock,
  createBlankBlock,
  effectiveIdleThresholdMs,
  getTimedBlocks,
  markBlockDirty,
  normalizeNotebookDay,
  persistedNotebookDay,
  totalTrackedMinutes,
  wallClockMinuteForDate,
} from './blockModel'

function block(overrides: Partial<NotebookBlock> = {}): NotebookBlock {
  return {
    id: 'b1',
    date: '2025-05-09',
    startMinute: 9 * 60,
    endMinute: 9 * 60 + 45,
    text: 'Worked on the split-view notebook timeline interactions',
    closed: true,
    ticketId: 'PEA-1',
    summaryOverride: null,
    ...overrides,
  }
}

describe('block model', () => {
  it('creates a blank trailing block for a date', () => {
    const blank = createBlankBlock('2025-05-09')
    expect(blank).toMatchObject({
      date: '2025-05-09',
      startMinute: null,
      endMinute: null,
      text: '',
      closed: false,
      ticketId: '',
      summaryOverride: null,
      tempoWorklogId: null,
      syncedAt: null,
    })
    expect(blank.id).not.toBe(createBlankBlock('2025-05-09').id)
  })

  it('clones blocks and normalizes optional fields', () => {
    const cloned = cloneBlock(block({ manualEnd: undefined, summaryOverride: undefined }))
    expect(cloned.manualEnd).toBe(false)
    expect(cloned.summaryOverride).toBe(null)
    expect(cloned.tempoWorklogId).toBe(null)
    expect(cloned.syncedAt).toBe(null)
    expect(cloned.id).toBe('b1')
  })

  it('marks a synced block dirty by clearing Tempo identity', () => {
    const dirty = markBlockDirty(block({ tempoWorklogId: 42, syncedAt: '2025-05-09T10:00:00Z' }))
    expect(dirty.tempoWorklogId).toBeNull()
    expect(dirty.syncedAt).toBeNull()
    expect(dirty.text).toBe(block().text)
  })

  it('detects push-relevant changes and ignores cosmetic ones', () => {
    const base = block()
    expect(blockHasPushRelevantChanges(base, block({ ticketId: 'PEA-2' }))).toBe(true)
    expect(blockHasPushRelevantChanges(base, block({ text: 'Rewrote the notes entirely' }))).toBe(true)
    expect(blockHasPushRelevantChanges(base, block({ endMinute: base.endMinute! + 5 }))).toBe(true)
    expect(blockHasPushRelevantChanges(base, block({ manualEnd: !base.manualEnd }))).toBe(false)
  })

  it('normalizes an empty day into a single blank block', () => {
    const day = normalizeNotebookDay({ date: '2025-05-09', blocks: [] })
    expect(day.blocks).toHaveLength(1)
    expect(day.blocks[0].startMinute).toBeNull()
    expect(day.blocks[0].text).toBe('')
  })

  it('appends a trailing blank only when the last block is not blank', () => {
    const withTrailingBlank = normalizeNotebookDay({
      date: '2025-05-09',
      blocks: [block(), createBlankBlock('2025-05-09')],
    })
    expect(withTrailingBlank.blocks).toHaveLength(2)

    const withoutTrailingBlank = normalizeNotebookDay({ date: '2025-05-09', blocks: [block()] })
    expect(withoutTrailingBlank.blocks).toHaveLength(2)
    expect(withoutTrailingBlank.blocks[1].startMinute).toBeNull()
  })

  it('inserts a retroactively added closed entry at its chronological position', () => {
    const morning = block({ id: 'morning', startMinute: 9 * 60, endMinute: 10 * 60 })
    const afternoon = block({ id: 'afternoon', startMinute: 14 * 60, endMinute: 15 * 60 })
    // Added last but covering a missed 11:00–12:00 gap.
    const retro = block({ id: 'retro', startMinute: 11 * 60, endMinute: 12 * 60 })

    const day = normalizeNotebookDay({ date: '2025-05-09', blocks: [morning, afternoon, retro] })
    expect(day.blocks.slice(0, 3).map((b) => b.id)).toEqual(['morning', 'retro', 'afternoon'])
    // The trailing blank still closes out the list.
    expect(day.blocks[3].startMinute).toBeNull()
  })

  it('keeps open entries and drafts anchored after the closed ones in their relative order', () => {
    const late = block({ id: 'late', startMinute: 14 * 60, endMinute: 15 * 60 })
    const early = block({ id: 'early', startMinute: 8 * 60, endMinute: 9 * 60 })
    const live = block({ id: 'live', startMinute: 16 * 60, endMinute: null, closed: false })
    const draft = block({ id: 'draft', startMinute: null, endMinute: null, closed: false })

    const day = normalizeNotebookDay({ date: '2025-05-09', blocks: [late, early, live, draft] })
    expect(day.blocks.slice(0, 4).map((b) => b.id)).toEqual(['early', 'late', 'live', 'draft'])
  })

  it('persists only blocks with content', () => {
    const day = persistedNotebookDay({
      date: '2025-05-09',
      blocks: [block(), createBlankBlock('2025-05-09'), block({ id: 'b2', text: '' , ticketId: 'PEA-2' })],
    })
    expect(day.blocks.map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('defaults wall-clock minutes to 17:00 for days other than today', () => {
    expect(wallClockMinuteForDate('1999-01-01')).toBe(17 * 60)
  })

  it('computes live duration from nowMinute for open blocks', () => {
    expect(blockDuration(block({ closed: false, endMinute: null }), 600)).toBe(60)
    expect(blockDuration(block(), 600)).toBe(45)
    expect(blockDuration(block({ startMinute: null }), 600)).toBeNull()
    // Never negative if "now" precedes the start.
    expect(blockDuration(block({ closed: false, endMinute: null }), 60)).toBe(0)
  })

  it('excludes lunch entries from tracked-time totals', () => {
    const blocks = [
      block({ id: 'work', startMinute: 9 * 60, endMinute: 12 * 60 }),
      block({
        id: 'lunch',
        ticketId: 'LUNCH',
        startMinute: 12 * 60,
        endMinute: 12 * 60 + 30,
      }),
      // Even an in-progress lunch contributes nothing.
      block({ id: 'open-lunch', ticketId: 'lunch', startMinute: 13 * 60, closed: false, endMinute: null }),
    ]
    expect(totalTrackedMinutes(blocks, 13 * 60 + 30)).toBe(3 * 60)
  })

  it('collects timed blocks in chronological order with live ends', () => {
    const timed = getTimedBlocks(
      [
        block({ id: 'late' }),
        block({ id: 'draft', startMinute: null, endMinute: null }),
        block({ id: 'open', startMinute: 8 * 60, closed: false, endMinute: null }),
      ],
      12 * 60,
    )
    expect(timed.map((t) => t.block.id)).toEqual(['open', 'late'])
    expect(timed[0].endMinute).toBe(12 * 60)
    // Closed block missing an end falls back to its start.
    expect(getTimedBlocks([block({ id: 'x', endMinute: null })], 600)[0].endMinute).toBe(9 * 60)
  })

  it('keeps the idle threshold aligned with constants when no debug scale is set', () => {
    expect(effectiveIdleThresholdMs()).toBeGreaterThan(0)
    expect(MIN_BLOCK_DURATION_MINUTES).toBe(1)
    expect(DAY_MINUTES).toBe(1440)
  })
})
