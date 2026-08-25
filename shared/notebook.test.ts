import { describe, expect, it } from 'vitest'
import type { NotebookBlock } from './types'
import {
  autoSummary,
  isUntrackedBlock,
  notebookBlockDurationMinutes,
  notebookBlockSummary,
  notebookBlockToWorklogInput,
  isPersistedNotebookBlock,
  truncatedAutoSummaries,
} from './notebook'

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

describe('notebook helpers', () => {
  it('auto-generates a short summary from text', () => {
    expect(autoSummary('one two three four five six seven eight')).toBe('one two three four five six seven eight')
  })

  it('truncates long text to the configured character limit, ellipsis included', () => {
    const text = 'a'.repeat(600)
    const result = autoSummary(text, 500)
    expect(result.length).toBe(500)
    expect(result.endsWith('…')).toBe(true)
    expect(autoSummary(text, 10)).toBe('aaaaaaaaa…')
    expect(autoSummary('exactly50'.padEnd(50, 'x'), 50)).not.toContain('…')
  })

  it('falls back to a placeholder for blank notes', () => {
    expect(autoSummary('   ')).toBe('Untitled entry')
  })

  it('prefers manual summary override when present', () => {
    expect(notebookBlockSummary(block({ summaryOverride: 'Manual summary' }))).toBe('Manual summary')
  })

  it('computes block duration in minutes', () => {
    expect(notebookBlockDurationMinutes(block())).toBe(45)
  })

  it('detects whether a block should be persisted', () => {
    expect(isPersistedNotebookBlock(block({ startMinute: null, endMinute: null, text: '', ticketId: '' }))).toBe(false)
    expect(isPersistedNotebookBlock(block({ startMinute: null, endMinute: null, text: 'Draft note', ticketId: '' }))).toBe(true)
  })

  it('converts a notebook block to a Tempo worklog payload', () => {
    expect(notebookBlockToWorklogInput(block(), 111, 'acc-1')).toEqual({
      issueId: 111,
      timeSpentSeconds: 2700,
      startDate: '2025-05-09',
      startTime: '09:00:00',
      description: 'Worked on the split-view notebook timeline interactions',
      authorAccountId: 'acc-1',
    })
  })

  it('uses the summary override as the Tempo description when present', () => {
    expect(notebookBlockToWorklogInput(block({ summaryOverride: 'Manual tempo summary' }), 111, 'acc-1').description).toBe(
      'Manual tempo summary',
    )
  })

  it('applies the configured summary limit to the generated description', () => {
    const longText = 'x'.repeat(600)
    expect(notebookBlockToWorklogInput(block({ text: longText }), 111, 'acc-1', 100).description.length).toBe(100)
  })

  it('flags unsynced closed blocks whose auto summary would be truncated', () => {
    const longText = 'y'.repeat(600)
    const entries = truncatedAutoSummaries(
      [
        block({ id: 'truncated', text: longText }),
        block({ id: 'override', text: longText, summaryOverride: 'Mine' }),
        block({ id: 'synced', text: longText, tempoWorklogId: 42 }),
        block({ id: 'short', text: 'short note' }),
        block({ id: 'open', text: longText, closed: false, endMinute: null }),
      ],
      100,
    )
    expect(entries.map((entry) => entry.blockId)).toEqual(['truncated'])
    expect(entries[0]).toMatchObject({
      ticketId: 'PEA-1',
      startMinute: 9 * 60,
      original: longText,
      truncated: autoSummary(longText, 100),
    })
  })

  it('returns no truncation entries when everything fits', () => {
    expect(truncatedAutoSummaries([block()], 500)).toEqual([])
  })

  it('detects untracked pseudo-entries case-insensitively and ignores surrounding whitespace', () => {
    expect(isUntrackedBlock(block({ ticketId: 'UNTRACKED' }))).toBe(true)
    expect(isUntrackedBlock(block({ ticketId: ' untracked ' }))).toBe(true)
    expect(isUntrackedBlock(block({ ticketId: 'PEA-1' }))).toBe(false)
  })

  it('never flags untracked blocks for summary truncation since they never push', () => {
    const longText = 'z'.repeat(600)
    const entries = truncatedAutoSummaries(
      [block({ id: 'untracked', ticketId: 'UNTRACKED', text: longText })],
      100,
    )
    expect(entries).toEqual([])
  })
})
