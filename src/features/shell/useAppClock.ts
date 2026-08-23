import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DAY_MINUTES,
  DEBUG_TIME_SCALE,
  TIMELINE_REFRESH_MS,
  wallClockMinuteForDate,
} from '@app/features/notebook/blockModel'
import { minutesToHHmm } from '@app/dateutil'

interface DayTimeAnchor {
  date: string
  wallClockStartMs: number
  minuteBase: number
}

// Owns the app's sense of "now": a per-date anchor that maps wall-clock time
// into minutes-from-midnight (with debug time-scaling), the one-second tick
// that drives re-renders of live durations, and the formatted header clock.
export function useAppClock() {
  const [tick, setTick] = useState(0)

  const dayTimeAnchorRef = useRef<DayTimeAnchor | null>(null)

  // Dedicated anchor for the top-right clock, independent of the currently
  // viewed date. Must never touch dayTimeAnchorRef (that one has the
  // side-effecting getCurrentMinute semantics tied to the selected day).
  const clockAnchorRef = useRef<{ startMs: number; baseMinutes: number } | null>(null)
  if (!clockAnchorRef.current) {
    const now = new Date()
    clockAnchorRef.current = {
      startMs: Date.now(),
      baseMinutes: now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60,
    }
  }

  useEffect(() => {
    const handle = setInterval(() => setTick((value) => value + 1), TIMELINE_REFRESH_MS)
    return () => clearInterval(handle)
  }, [])

  const getCurrentMinute = useCallback((forDate: string) => {
    const now = Date.now()
    const minuteBase = wallClockMinuteForDate(forDate)
    const anchor = dayTimeAnchorRef.current

    if (!anchor || anchor.date !== forDate) {
      dayTimeAnchorRef.current = {
        date: forDate,
        wallClockStartMs: now,
        minuteBase,
      }
      return Math.min(DAY_MINUTES, Math.max(0, minuteBase))
    }

    const elapsedMinutes = ((now - anchor.wallClockStartMs) / 60000) * DEBUG_TIME_SCALE
    return Math.min(DAY_MINUTES, Math.max(0, Math.floor(anchor.minuteBase + elapsedMinutes)))
  }, [])

  // Re-anchor "now" for a date (called when a day finishes loading) so elapsed
  // drift never accumulates across repeated visits to the same day.
  const resetClockAnchor = useCallback((forDate: string) => {
    dayTimeAnchorRef.current = {
      date: forDate,
      wallClockStartMs: Date.now(),
      minuteBase: wallClockMinuteForDate(forDate),
    }
  }, [])

  const clockLabel = useMemo(() => {
    if (DEBUG_TIME_SCALE === 1) {
      const now = new Date()
      return minutesToHHmm(now.getHours() * 60 + now.getMinutes())
    }
    const anchor = clockAnchorRef.current
    if (!anchor) return minutesToHHmm(0)
    const simMinutes = anchor.baseMinutes + ((Date.now() - anchor.startMs) / 60000) * DEBUG_TIME_SCALE
    return minutesToHHmm(Math.floor(simMinutes))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  return { tick, getCurrentMinute, resetClockAnchor, clockLabel }
}
