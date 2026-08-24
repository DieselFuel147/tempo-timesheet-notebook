import { useEffect, useRef } from 'react'
import { formatHours } from '@app/dateutil'
import {
  REMINDER_POLL_INTERVAL_MS,
  shouldRemindInactivity,
  type ReminderConfig,
} from './inactivityReminder'
import { ensureNotificationPermission, sendReminder } from './permission'

interface Options {
  enabled: boolean
  /** Idle minutes before the first reminder; repeats at the same interval. */
  thresholdMinutes: number
  workdayStartMin: number
  workdayEndMin: number
  /** Millisecond timestamp of the last user interaction (see useUserActivity). */
  lastActivityRef: { current: number }
}

// Polls every couple of minutes and fires the macOS inactivity reminder when
// due. The timing rules live in inactivityReminder (pure, unit-tested); this
// hook owns the loop, permission gating, and last-prompted bookkeeping.
export function useInactivityPrompt({
  enabled,
  thresholdMinutes,
  workdayStartMin,
  workdayEndMin,
  lastActivityRef,
}: Options) {
  const optionsRef = useRef<ReminderConfig & { enabled: boolean }>({
    enabled,
    thresholdMinutes,
    workdayStartMin,
    workdayEndMin,
  })
  useEffect(() => {
    optionsRef.current = { enabled, thresholdMinutes, workdayStartMin, workdayEndMin }
  }, [enabled, thresholdMinutes, workdayStartMin, workdayEndMin])

  const lastPromptedAtRef = useRef<number | null>(null)
  const permissionRef = useRef<'unchecked' | 'granted' | 'denied'>('unchecked')

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      const options = optionsRef.current
      if (!options.enabled || cancelled) return

      const now = new Date()
      const due = shouldRemindInactivity(
        options,
        {
          nowMs: now.getTime(),
          minuteOfDay: now.getHours() * 60 + now.getMinutes(),
          // getDay(): 0 = Sunday .. 6 = Saturday.
          isWeekday: now.getDay() >= 1 && now.getDay() <= 5,
        },
        lastActivityRef.current,
        lastPromptedAtRef.current,
      )
      if (!due) return

      if (permissionRef.current === 'unchecked') {
        permissionRef.current = (await ensureNotificationPermission()) ? 'granted' : 'denied'
      }
      if (cancelled || permissionRef.current !== 'granted') return

      const idleMinutes = Math.max(0, Math.round((now.getTime() - lastActivityRef.current) / 60_000))
      const sent = await sendReminder({
        title: 'Timesheet reminder',
        body: `No activity for ${formatHours(idleMinutes)} — update your time entries.`,
      })
      if (sent && !cancelled) lastPromptedAtRef.current = Date.now()
    }

    const handle = setInterval(() => void check(), REMINDER_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [lastActivityRef])
}
