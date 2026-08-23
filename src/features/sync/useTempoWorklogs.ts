import { useCallback, useEffect, useRef, useState } from 'react'
import type { TempoWorklog } from '@shared/types'
import { api } from '@app/api'

interface Options {
  date: string
  tempoConfigured: boolean
}

// Lazy, per-day read of confirmed Tempo worklogs with a per-date cache so
// flipping back to an already-loaded day doesn't refetch. Never blocks the
// notebook render; `reload` forces a refresh (used after a push).
export function useTempoWorklogs({ date, tempoConfigured }: Options) {
  const [tempoWorklogs, setTempoWorklogs] = useState<TempoWorklog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Per-date cache so flipping back to an already-loaded day doesn't refetch.
  const cache = useRef<Map<string, TempoWorklog[]>>(new Map())

  // Track the active date so async worklog fetches can tell whether their
  // result still applies to what the user is looking at.
  const dateRef = useRef(date)
  useEffect(() => {
    dateRef.current = date
  }, [date])

  const load = useCallback(
    async (targetDate: string, options?: { force?: boolean }) => {
      if (!tempoConfigured) {
        cache.current.clear()
        setTempoWorklogs([])
        setError(null)
        setLoading(false)
        return
      }
      if (!options?.force) {
        const cached = cache.current.get(targetDate)
        if (cached) {
          setTempoWorklogs(cached)
          setError(null)
          return
        }
      }
      setLoading(true)
      setError(null)
      try {
        const worklogs = await api.getTempoWorklogs(targetDate)
        cache.current.set(targetDate, worklogs)
        if (targetDate === dateRef.current) setTempoWorklogs(worklogs)
      } catch (cause) {
        if (targetDate === dateRef.current) {
          setTempoWorklogs([])
          setError((cause as Error).message)
        }
      } finally {
        if (targetDate === dateRef.current) setLoading(false)
      }
    },
    [tempoConfigured],
  )

  // Fired on navigation and once Tempo becomes configured.
  useEffect(() => {
    void load(date)
  }, [date, load])

  return { tempoWorklogs, loading, error, reload: load }
}
