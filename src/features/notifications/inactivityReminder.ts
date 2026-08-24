// Pure timing rules for the inactivity reminder, kept free of React and the
// notification plugin so the cadence can be unit-tested exhaustively.

/** How often the reminder loop wakes up to check whether a nudge is due. */
export const REMINDER_POLL_INTERVAL_MS = 2 * 60 * 1000

export interface ReminderConfig {
  /** Idle minutes before the first reminder; also the repeat interval. */
  thresholdMinutes: number
  /** Normal hours (from the validation thresholds) gate when reminders may fire. */
  workdayStartMin: number
  workdayEndMin: number
}

export interface ReminderClock {
  nowMs: number
  /** Minutes since local midnight. */
  minuteOfDay: number
  isWeekday: boolean
}

/**
 * True when an inactivity reminder should fire right now. Fires once per
 * threshold window of idleness — first after `thresholdMinutes` of no
 * activity, then again every further `thresholdMinutes` — but never outside
 * normal hours or on weekends.
 */
export function shouldRemindInactivity(
  config: ReminderConfig,
  clock: ReminderClock,
  lastActivityMs: number,
  lastPromptedAtMs: number | null,
): boolean {
  if (!clock.isWeekday) return false
  if (clock.minuteOfDay < config.workdayStartMin) return false
  if (clock.minuteOfDay >= config.workdayEndMin) return false

  const thresholdMs = config.thresholdMinutes * 60_000
  if (thresholdMs <= 0) return false
  if (clock.nowMs - lastActivityMs < thresholdMs) return false
  if (lastPromptedAtMs !== null && clock.nowMs - lastPromptedAtMs < thresholdMs) return false
  return true
}
