import { describe, it, expect } from 'vitest'
import type { Entry } from './types'
import { toWorklogInput } from './worklog'

const e = (o: Partial<Entry>): Entry => ({
  id: 'e',
  date: '2025-05-09',
  start: '09:00',
  end: '09:45',
  ticketKey: 'PEA-1',
  summary: 'Did stuff',
  ...o,
})

describe('toWorklogInput', () => {
  it('converts duration to seconds and formats fields', () => {
    expect(toWorklogInput(e({ start: '09:00', end: '10:30' }), 111, 'acc-1')).toEqual({
      issueId: 111,
      timeSpentSeconds: 5400,
      startDate: '2025-05-09',
      startTime: '09:00:00',
      description: 'Did stuff',
      authorAccountId: 'acc-1',
    })
  })

  it('trims the description', () => {
    expect(toWorklogInput(e({ summary: '  hi  ' }), 1, 'a').description).toBe('hi')
  })

  it('throws on an invalid time range', () => {
    expect(() => toWorklogInput(e({ start: '10:00', end: '09:00' }), 1, 'a')).toThrow()
  })
})
