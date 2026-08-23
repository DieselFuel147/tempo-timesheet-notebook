import { describe, expect, it } from 'vitest'
import type { NotebookBlock } from '@shared/types'
import { assignBlockColors } from './blockColors'

function block(overrides: Partial<NotebookBlock> = {}): NotebookBlock {
  return {
    id: 'b1',
    date: '2025-05-09',
    startMinute: 9 * 60,
    endMinute: 9 * 60 + 45,
    text: 'Worked on the split-view notebook timeline interactions',
    closed: true,
    ticketId: '',
    summaryOverride: null,
    ...overrides,
  }
}

describe('assignBlockColors', () => {
  const palette = ['#1', '#2', '#3']

  it('cycles the palette chronologically for ticket-less blocks', () => {
    const colors = assignBlockColors(
      [block({ id: 'a' }), block({ id: 'b' }), block({ id: 'c' }), block({ id: 'd' })],
      palette,
    )
    expect(colors.get('a')).toBe('#1')
    expect(colors.get('b')).toBe('#2')
    expect(colors.get('c')).toBe('#3')
    expect(colors.get('d')).toBe('#1')
  })

  it('gives blocks sharing a ticket the ticket\u2019s first-assigned color', () => {
    const colors = assignBlockColors(
      [block({ id: 'a', ticketId: 'PEA-1' }), block({ id: 'b' }), block({ id: 'c', ticketId: 'PEA-1' })],
      palette,
    )
    expect(colors.get('a')).toBe('#1')
    expect(colors.get('c')).toBe('#1')
    expect(colors.get('b')).toBe('#2')
  })

  it('skips unpersisted blocks entirely', () => {
    const blank = block({ id: 'blank', startMinute: null, endMinute: null, text: '', closed: false })
    const colors = assignBlockColors([blank, block({ id: 'a' })], palette)
    expect(colors.has('blank')).toBe(false)
    expect(colors.get('a')).toBe('#1')
  })
})
