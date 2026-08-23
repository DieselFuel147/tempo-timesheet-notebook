import { describe, expect, it } from 'vitest'
import type { TempoWorklog } from '@shared/types'
import { parseStartTimeToMinute, toTempoWorklogViews } from './tempoViews'

function worklog(overrides: Partial<TempoWorklog> = {}): TempoWorklog {
  return {
    tempoWorklogId: 1,
    issueId: 111,
    issueKey: 'PEA-1',
    timeSpentSeconds: 3600,
    startDate: '2025-05-09',
    startTime: '09:00:00',
    description: 'Did things',
    ...overrides,
  }
}

describe('parseStartTimeToMinute', () => {
  it('parses HH:mm:ss into minutes from midnight', () => {
    expect(parseStartTimeToMinute('09:30:00')).toBe(570)
    expect(parseStartTimeToMinute('9:05')).toBe(545)
    expect(parseStartTimeToMinute(' 23:59:59 ')).toBe(1439)
  })

  it('rejects unparseable input and clamps out-of-range hours', () => {
    expect(parseStartTimeToMinute('garbage')).toBeNull()
    expect(parseStartTimeToMinute('')).toBeNull()
    expect(parseStartTimeToMinute('99:00')).toBe(1440)
  })
})

describe('toTempoWorklogViews', () => {
  it('maps worklogs into ruler coordinates with duration and notebook membership', () => {
    const views = toTempoWorklogViews(
      [worklog({ tempoWorklogId: 7 }), worklog({ tempoWorklogId: 8, startTime: '11:00:00', timeSpentSeconds: 90 * 60 })],
      new Set([7]),
    )
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({
      tempoWorklogId: 7,
      startMinute: 540,
      endMinute: 600,
      inNotebook: true,
    })
    expect(views[1]).toMatchObject({
      tempoWorklogId: 8,
      startMinute: 660,
      endMinute: 750,
      inNotebook: false,
    })
  })

  it('rounds sub-minute durations up to at least one minute', () => {
    const views = toTempoWorklogViews([worklog({ startTime: '10:00:00', timeSpentSeconds: 10 })], new Set())
    expect(views[0].endMinute - views[0].startMinute).toBe(1)
  })

  it('drops worklogs with unparseable times and sorts the rest chronologically', () => {
    const views = toTempoWorklogViews(
      [
        worklog({ tempoWorklogId: 2, startTime: '13:00:00' }),
        worklog({ tempoWorklogId: 3, startTime: 'nope' }),
        worklog({ tempoWorklogId: 1, startTime: '08:00:00' }),
      ],
      new Set(),
    )
    expect(views.map((v) => v.tempoWorklogId)).toEqual([1, 2])
  })

  it('clamps end minutes at midnight', () => {
    const views = toTempoWorklogViews([worklog({ startTime: '23:00:00', timeSpentSeconds: 4 * 3600 })], new Set())
    expect(views[0].endMinute).toBe(1440)
  })
})
