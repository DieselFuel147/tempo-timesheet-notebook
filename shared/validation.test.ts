import { describe, it, expect } from 'vitest'
import type { Entry } from './types'
import {
  defaultConfig,
  parseTime,
  entryDurationMinutes,
  validateEntry,
  validateDay,
  summarizeIssues,
} from './validation'

function entry(over: Partial<Entry>): Entry {
  return {
    id: over.id ?? 'e1',
    date: '2025-05-09',
    start: '09:00',
    end: '09:45',
    ticketKey: 'REACT-1540',
    summary: 'Work',
    ...over,
  }
}

const codes = (es: { code: string }[]) => es.map((e) => e.code).sort()

describe('parseTime', () => {
  it('parses valid times', () => {
    expect(parseTime('09:00')).toBe(540)
    expect(parseTime('9:00')).toBe(540)
    expect(parseTime('18:30')).toBe(1110)
    expect(parseTime('00:00')).toBe(0)
    expect(parseTime('23:59')).toBe(1439)
  })
  it('rejects malformed times', () => {
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('9')).toBeNull()
    expect(parseTime('9:60')).toBeNull()
    expect(parseTime('nope')).toBeNull()
  })
})

describe('entryDurationMinutes', () => {
  it('computes duration', () => {
    expect(entryDurationMinutes(entry({ start: '09:00', end: '09:45' }))).toBe(45)
  })
  it('is null on bad input', () => {
    expect(entryDurationMinutes(entry({ end: 'x' }))).toBeNull()
  })
})

describe('validateEntry', () => {
  it('passes a clean entry with no issues', () => {
    expect(validateEntry(entry({}))).toEqual([])
  })

  it('accepts the default admin ticket', () => {
    expect(validateEntry(entry({ ticketKey: defaultConfig.adminTicket }))).toEqual([])
  })

  it('flags an invalid ticket as an error', () => {
    // From the real notepad: "Team standup", "SoS meeting" have no ticket id.
    const issues = validateEntry(entry({ ticketKey: 'Team standup' }))
    expect(issues.some((i) => i.code === 'INVALID_TICKET' && i.level === 'error')).toBe(true)
  })

  it('errors when end is before or equal to start', () => {
    expect(validateEntry(entry({ start: '10:00', end: '09:00' })).map((i) => i.code)).toContain('BAD_RANGE')
    expect(validateEntry(entry({ start: '10:00', end: '10:00' })).map((i) => i.code)).toContain('BAD_RANGE')
  })

  it('errors on malformed times', () => {
    expect(validateEntry(entry({ start: '25:00' })).map((i) => i.code)).toContain('INVALID_START')
    expect(validateEntry(entry({ end: 'noon' })).map((i) => i.code)).toContain('INVALID_END')
  })

  it('warns on too-short and too-long entries', () => {
    expect(validateEntry(entry({ start: '09:00', end: '09:05' })).map((i) => i.code)).toContain('TOO_SHORT')
    // 09:00 -> 14:00 is 5h, over the 4h default
    expect(validateEntry(entry({ start: '09:00', end: '14:00' })).map((i) => i.code)).toContain('TOO_LONG')
  })

  it('warns on out-of-hours starts and ends', () => {
    expect(validateEntry(entry({ start: '06:30', end: '07:00' })).map((i) => i.code)).toContain('EARLY')
    expect(validateEntry(entry({ start: '18:30', end: '19:00' })).map((i) => i.code)).toContain('LATE')
  })

  it('warns (does not block) on a missing summary', () => {
    const issues = validateEntry(entry({ summary: '  ' }))
    expect(issues.some((i) => i.code === 'NO_SUMMARY' && i.level === 'warning')).toBe(true)
    expect(summarizeIssues(issues).hasErrors).toBe(false)
  })
})

describe('validateDay', () => {
  it('detects overlapping entries as an error', () => {
    const issues = validateDay([
      entry({ id: 'a', start: '09:00', end: '10:30' }),
      entry({ id: 'b', start: '10:00', end: '11:00' }),
    ])
    expect(issues.some((i) => i.code === 'OVERLAP' && i.level === 'error')).toBe(true)
  })

  it('allows back-to-back entries (no overlap)', () => {
    const issues = validateDay([
      entry({ id: 'a', start: '09:00', end: '10:00' }),
      entry({ id: 'b', start: '10:00', end: '11:00' }),
    ])
    expect(issues.some((i) => i.code === 'OVERLAP')).toBe(false)
  })

  it('warns when the daily total is too low', () => {
    const issues = validateDay([entry({ start: '09:00', end: '10:00' })])
    expect(issues.map((i) => i.code)).toContain('DAY_LOW')
  })

  it('warns when the daily total is too high', () => {
    const issues = validateDay([entry({ start: '06:00', end: '20:00' })]) // 14h
    expect(codes(issues)).toContain('DAY_HIGH')
  })

  it('aggregates per-entry issues across the day', () => {
    const issues = validateDay([
      entry({ id: 'a', ticketKey: 'Lunch' }),
      entry({ id: 'b', start: '10:00', end: '09:00' }),
    ])
    expect(issues.filter((i) => i.entryId === 'a').map((i) => i.code)).toContain('INVALID_TICKET')
    expect(issues.filter((i) => i.entryId === 'b').map((i) => i.code)).toContain('BAD_RANGE')
  })
})
