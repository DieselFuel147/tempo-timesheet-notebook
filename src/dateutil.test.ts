import { describe, expect, it } from 'vitest'
import { minutesTo12hTime, startOfWeek, weekDates } from './dateutil'

describe('startOfWeek', () => {
  it('returns the same day when it is a Monday', () => {
    expect(startOfWeek('2026-08-24')).toBe('2026-08-24')
  })

  it('returns the Monday of the week for mid-week days', () => {
    expect(startOfWeek('2026-08-26')).toBe('2026-08-24')
    expect(startOfWeek('2026-08-29')).toBe('2026-08-24')
  })

  it('treats Sunday as the last day of the previous week', () => {
    expect(startOfWeek('2026-08-30')).toBe('2026-08-24')
  })

  it('crosses month and year boundaries', () => {
    expect(startOfWeek('2026-09-01')).toBe('2026-08-31')
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28')
  })
})

describe('weekDates', () => {
  it('returns the seven Monday..Sunday dates of the containing week', () => {
    expect(weekDates('2026-08-26')).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ])
  })

  it('includes the given day and stays within the same week on Sundays', () => {
    const sunday = weekDates('2026-08-30')
    expect(sunday).toContain('2026-08-30')
    expect(startOfWeek(sunday[0])).toBe(sunday[0])
  })
})

describe('minutesTo12hTime', () => {
  it('formats morning, afternoon, and the twelve-o-clock edge cases', () => {
    expect(minutesTo12hTime(9 * 60 + 45)).toBe('9:45 am')
    expect(minutesTo12hTime(13 * 60 + 47)).toBe('1:47 pm')
    expect(minutesTo12hTime(12 * 60 + 30)).toBe('12:30 pm')
    expect(minutesTo12hTime(30)).toBe('12:30 am')
  })

  it('wraps minutes beyond the day', () => {
    expect(minutesTo12hTime(24 * 60 + 90)).toBe('1:30 am')
  })
})
