import { describe, expect, it } from 'vitest'
import { shouldRemindInactivity } from './inactivityReminder'

// 2026-08-24 is a Monday; 10:00 local.
const BASE: Parameters<typeof shouldRemindInactivity>[1] = {
  nowMs: Date.parse('2026-08-24T10:00:00'),
  minuteOfDay: 10 * 60,
  isWeekday: true,
}

const CONFIG = { thresholdMinutes: 60, workdayStartMin: 8 * 60, workdayEndMin: 18 * 60 }
const HOUR = 60 * 60 * 1000

describe('shouldRemindInactivity', () => {
  it('fires after a full threshold of inactivity within normal hours', () => {
    // Active until 09:00, checked at 10:00 -> one hour idle.
    expect(shouldRemindInactivity(CONFIG, BASE, BASE.nowMs - HOUR, null)).toBe(true)
  })

  it('stays quiet before the threshold is reached', () => {
    expect(shouldRemindInactivity(CONFIG, BASE, BASE.nowMs - HOUR + 60_000, null)).toBe(false)
  })

  it('repeats at the same interval while the user stays idle', () => {
    const promptedAt = BASE.nowMs - HOUR
    // Prompted an hour ago, still idle -> due again.
    expect(shouldRemindInactivity(CONFIG, BASE, BASE.nowMs - 2 * HOUR, promptedAt)).toBe(true)
    // Prompted recently (within the threshold window) -> not yet.
    expect(shouldRemindInactivity(CONFIG, BASE, BASE.nowMs - 2 * HOUR, promptedAt + HOUR - 60_000)).toBe(false)
  })

  it('never fires outside normal hours', () => {
    const before = { ...BASE, minuteOfDay: CONFIG.workdayStartMin - 1 }
    const atEnd = { ...BASE, minuteOfDay: CONFIG.workdayEndMin }
    expect(shouldRemindInactivity(CONFIG, before, before.nowMs - 5 * HOUR, null)).toBe(false)
    expect(shouldRemindInactivity(CONFIG, atEnd, atEnd.nowMs - 5 * HOUR, null)).toBe(false)
  })

  it('never fires on weekends', () => {
    expect(shouldRemindInactivity(CONFIG, { ...BASE, isWeekday: false }, BASE.nowMs - 5 * HOUR, null)).toBe(false)
  })

  it('treats activity inside the reminder window as a reset', () => {
    // Re-prompts are measured from the last prompt, but fresh activity always
    // silences the loop even if a prompt happened earlier.
    expect(
      shouldRemindInactivity(CONFIG, BASE, BASE.nowMs - 30 * 60_000, BASE.nowMs - 2 * HOUR),
    ).toBe(false)
  })
})
