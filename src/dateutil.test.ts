import { describe, expect, it } from 'vitest'
import {
  complete12hDraftMinutes,
  format12hDraft,
  minutesTo12hTime,
  parse12hDraftInput,
  startOfWeek,
  weekDates,
} from './dateutil'

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

describe('12h draft mask', () => {
  it('flows digits through hour then minutes with smart hour closing', () => {
    expect(format12hDraft(parse12hDraftInput('9'))).toBe('9:')
    expect(format12hDraft(parse12hDraftInput('94'))).toBe('9:4')
    expect(format12hDraft(parse12hDraftInput('09'))).toBe('09:')
    expect(format12hDraft(parse12hDraftInput('1234'))).toBe('12:34 --')
    // "1" waits for a possible second digit; an impossible pair rolls into minutes.
    expect(format12hDraft(parse12hDraftInput('15'))).toBe('1:5')
  })

  it('accepts the meridiem from a or p anywhere in the entry', () => {
    const fromSuffix = parse12hDraftInput('945p')
    expect(fromSuffix.meridiem).toBe('pm')
    expect(format12hDraft(fromSuffix)).toBe('9:45 pm')
    expect(format12hDraft(parse12hDraftInput('am 945'))).toBe('9:45 am')
  })

  it('reparses its own formatted output (committed values seed edits)', () => {
    for (const text of ['9:45 pm', '12:34 --', '09:05 am', '1:5']) {
      expect(format12hDraft(parse12hDraftInput(text))).toBe(text)
    }
  })

  it('commits only complete, in-range drafts', () => {
    expect(complete12hDraftMinutes(parse12hDraftInput('945'))).toBeNull() // no meridiem
    expect(complete12hDraftMinutes(parse12hDraftInput('94p'))).toBeNull() // minute incomplete
    expect(complete12hDraftMinutes(parse12hDraftInput('1245 am'))).toBe(45)
    expect(complete12hDraftMinutes(parse12hDraftInput('1245 pm'))).toBe(12 * 60 + 45)
    expect(complete12hDraftMinutes(parse12hDraftInput('945 pm'))).toBe(21 * 60 + 45)
    expect(complete12hDraftMinutes(parse12hDraftInput('0012 am'))).toBeNull() // hour zero
  })
})
