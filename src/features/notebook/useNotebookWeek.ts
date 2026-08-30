import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NotebookDay } from '@shared/types'
import { api } from '@app/api'
import { weekDates } from '@app/dateutil'

interface Options {
  /** Monday of the week to aggregate (see startOfWeek). */
  monday: string
  /** The day being viewed/edited; its live in-memory state keeps the cache fresh. */
  selectedDate: string
  selectedDay: NotebookDay | null
}

// Aggregates the notebook days of the selected week for the status bar's
// weekly tracked total. Loaded days stay cached so re-visiting a week doesn't
// flicker, and the live in-memory copy of the selected day is folded into the
// cache on every render — so edits count immediately, including right after
// navigating away from a freshly edited day.
export function useNotebookWeek({ monday, selectedDate, selectedDay }: Options) {
  const [days, setDays] = useState<Partial<Record<string, NotebookDay>>>({})
  const cache = useRef<Map<string, NotebookDay>>(new Map())

  const weekDatesList = useMemo(() => weekDates(monday), [monday])

  if (selectedDay) {
    cache.current.set(selectedDate, selectedDay)
  }

  const publishKnownDays = useCallback(
    () =>
      setDays(() => {
        const next: Partial<Record<string, NotebookDay>> = {}
        for (const iso of weekDatesList) {
          const cached = cache.current.get(iso)
          if (cached) next[iso] = cached
        }
        return next
      }),
    [weekDatesList],
  )

  // Re-publish whenever the week or the live selected day changes, so edits and
  // intra-week navigation keep every cached day fresh in the returned snapshot.
  useEffect(() => {
    publishKnownDays()
  }, [publishKnownDays, selectedDate, selectedDay])

  useEffect(() => {
    let cancelled = false

    publishKnownDays()

    const missing = weekDatesList.filter((iso) => !cache.current.has(iso))
    if (missing.length === 0) return

    Promise.all(
      missing.map((iso) => api.getDay(iso).then((day) => ({ iso, day }), () => null)),
    ).then((results) => {
      if (cancelled) return
      for (const result of results) {
        if (result) cache.current.set(result.iso, result.day)
      }
      publishKnownDays()
    })

    return () => {
      cancelled = true
    }
  }, [weekDatesList, publishKnownDays])

  return days
}
