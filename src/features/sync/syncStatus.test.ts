import { describe, expect, it } from 'vitest'
import type { NotebookBlock } from '@shared/types'
import { blockSyncLabel, isPushableBlock } from './syncStatus'

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

describe('isPushableBlock', () => {
  it('requires a closed, fully timed block with a non-empty summary', () => {
    expect(isPushableBlock(block())).toBe(true)
    expect(isPushableBlock(block({ closed: false }))).toBe(false)
    expect(isPushableBlock(block({ startMinute: null, endMinute: null }))).toBe(false)
    // Blank notes fall back to the "Untitled entry" placeholder summary, so
    // they still count as pushable.
    expect(isPushableBlock(block({ text: '' }))).toBe(true)
  })

  it('accepts a summary override in place of notes', () => {
    expect(isPushableBlock(block({ text: '', summaryOverride: 'Manual summary' }))).toBe(true)
  })

  it('never considers lunch entries pushable', () => {
    expect(isPushableBlock(block({ ticketId: 'LUNCH' }))).toBe(false)
    expect(isPushableBlock(block({ ticketId: 'lunch' }))).toBe(false)
  })
})

describe('blockSyncLabel', () => {
  it('returns no chip for blank or unpushable blocks', () => {
    expect(blockSyncLabel(block({ startMinute: null, endMinute: null, text: '', closed: false }))).toBeNull()
    expect(blockSyncLabel(block({ closed: false, endMinute: null }))).toBeNull()
  })

  it('labels synced blocks and push-ready blocks distinctly', () => {
    expect(blockSyncLabel(block({ tempoWorklogId: 42 }))).toEqual({
      label: 'synced to Tempo',
      color: 'success',
    })
    expect(blockSyncLabel(block())).toEqual({ label: 'ready to sync', color: 'warning' })
  })
})
