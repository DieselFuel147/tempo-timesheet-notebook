import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotebookBlock, NotebookDay } from '@shared/types'
import { weekDates } from '@app/dateutil'
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
  totalClosedMinutes,
  totalTrackedMinutes,
  wallClockMinuteForDate,
  weekTrackedMinutes,
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

function makeDay(date: string, blocks: NotebookBlock[]): NotebookDay {
  return { date, blocks }
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

  it('excludes untracked entries from tracked-time totals', () => {
    const blocks = [
      block({ id: 'work', startMinute: 9 * 60, endMinute: 12 * 60 }),
      block({
        id: 'untracked',
        ticketId: 'UNTRACKED',
        startMinute: 12 * 60,
        endMinute: 12 * 60 + 30,
      }),
      // Even an in-progress untracked entry contributes nothing.
      block({ id: 'open-untracked', ticketId: 'untracked', startMinute: 13 * 60, closed: false, endMinute: null }),
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

describe('totalClosedMinutes', () => {
  it('sums closed tracked blocks and ignores open ones', () => {
    const blocks = [
      block({ id: 'a', startMinute: 9 * 60, endMinute: 12 * 60 }), // closed, 3h
      block({ id: 'b', startMinute: 13 * 60, endMinute: null, closed: false }), // open → excluded
    ]
    expect(totalClosedMinutes(blocks)).toBe(3 * 60)
  })

  it('excludes untracked blocks', () => {
    const blocks = [
      block({ id: 'a', startMinute: 9 * 60, endMinute: 12 * 60 }), // 3h
      block({ id: 'u', ticketId: 'UNTRACKED', startMinute: 12 * 60, endMinute: 13 * 60 }), // untracked → excluded
    ]
    expect(totalClosedMinutes(blocks)).toBe(3 * 60)
  })

  it('never goes negative when an end precedes its start', () => {
    const blocks = [block({ id: 'a', startMinute: 12 * 60, endMinute: 9 * 60 })]
    expect(totalClosedMinutes(blocks)).toBe(0)
  })
})

describe('weekTrackedMinutes', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is identical no matter which day in the week is selected', () => {
    // "today" sits outside this week, so every day counts closed blocks only.
    vi.setSystemTime(new Date(2025, 0, 13, 9, 0))
    const monday = '2025-01-06'
    const days: Partial<Record<string, NotebookDay>> = {
      '2025-01-06': makeDay('2025-01-06', [block({ startMinute: 9 * 60, endMinute: 12 * 60 })]), // 3h
      '2025-01-07': makeDay('2025-01-07', [block({ startMinute: 9 * 60, endMinute: 17 * 60 })]), // 8h
      '2025-01-08': makeDay('2025-01-08', [block({ startMinute: 10 * 60, endMinute: 15 * 60 })]), // 5h
      '2025-01-09': makeDay('2025-01-09', []),
      '2025-01-10': makeDay('2025-01-10', [block({ startMinute: 8 * 60, endMinute: 12 * 60 + 30 })]), // 4.5h
      '2025-01-11': makeDay('2025-01-11', []),
      '2025-01-12': makeDay('2025-01-12', [block({ startMinute: 9 * 60 + 30, endMinute: 16 * 60 })]), // 6.5h
    }
    const expected = 3 * 60 + 8 * 60 + 5 * 60 + 4.5 * 60 + 6.5 * 60 // = 1620
    for (const iso of weekDates(monday)) {
      expect(weekTrackedMinutes(monday, iso, days[iso]!, days)).toBe(expected)
    }
  })

  it('counts today open blocks up to the real clock, regardless of selection', () => {
    vi.setSystemTime(new Date(2025, 0, 8, 14, 30)) // today = Wed 2:30pm
    const monday = '2025-01-06' // week contains today (2025-01-08)
    const openToday = [block({ startMinute: 9 * 60, endMinute: null, closed: false })] // open since 9am
    const days = { '2025-01-08': makeDay('2025-01-08', openToday) }
    // 9:00 → 14:30 = 5.5h, whether today is the selected day or not.
    expect(weekTrackedMinutes(monday, '2025-01-08', days['2025-01-08']!, days)).toBe(330)
    expect(weekTrackedMinutes(monday, '2025-01-06', makeDay('2025-01-06', []), days)).toBe(330)
  })

  it('excludes open blocks on non-today days', () => {
    vi.setSystemTime(new Date(2025, 0, 13, 9, 0)) // today outside the week
    const monday = '2025-01-06'
    const days: Partial<Record<string, NotebookDay>> = {
      '2025-01-06': makeDay('2025-01-06', [block({ startMinute: 9 * 60, endMinute: null, closed: false })]), // open → excluded
      '2025-01-07': makeDay('2025-01-07', [block({ startMinute: 9 * 60, endMinute: 12 * 60 })]), // closed 3h
    }
    expect(weekTrackedMinutes(monday, '2025-01-06', days['2025-01-06']!, days)).toBe(3 * 60)
  })

  it('ignores days that have not loaded yet', () => {
    vi.setSystemTime(new Date(2025, 0, 13, 9, 0))
    const monday = '2025-01-06'
    // Only one of the seven days is present; the missing six contribute nothing.
    const days = { '2025-01-06': makeDay('2025-01-06', [block({ startMinute: 9 * 60, endMinute: 12 * 60 }) ]) }
    expect(weekTrackedMinutes(monday, '2025-01-06', days['2025-01-06']!, days)).toBe(3 * 60)
  })
})
