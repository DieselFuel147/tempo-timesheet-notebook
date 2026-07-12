import { describe, expect, it } from 'vitest'
import type { NotebookBlock } from './types'
import {
  autoSummary,
  notebookBlockDurationMinutes,
  notebookBlockSummary,
  notebookBlockToWorklogInput,
  isPersistedNotebookBlock,
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
    expect(autoSummary('one two three four five six seven eight')).toBe('one two three four five six seven…')
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
})
