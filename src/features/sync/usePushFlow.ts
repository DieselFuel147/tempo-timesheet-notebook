import { useCallback, useEffect, useState } from 'react'
import type { NotebookDay } from '@shared/types'
import { truncatedAutoSummaries } from '@shared/notebook'
import { normalizeNotebookDay } from '@app/features/notebook/blockModel'
import { api } from '@app/api'
import type { PushState } from './syncStatus'

interface SummaryGate {
  entries: ReturnType<typeof truncatedAutoSummaries>
  confirmedIds: Set<string>
}

interface Options {
  date: string
  maxSummaryChars: number
  dayRef: { current: NotebookDay | null }
  /** Replaces the in-memory day after a successful push (server is source of truth). */
  setDay: (day: NotebookDay) => void
  /** Forces a Tempo worklog reload for the given date (post-push overlay refresh). */
  reloadTempoWorklogs: (date: string) => void
  onSummaryChange: (id: string, value: string) => void
  onError: (message: string | null) => void
}

// Dry-run/push state machine plus the truncation gate: intercepts the push
// when any unsynced entry would upload an auto-truncated summary, and only
// proceeds once every one has been confirmed (as-is or replaced with an
// override) in the modal.
export function usePushFlow({
  date,
  maxSummaryChars,
  dayRef,
  setDay,
  reloadTempoWorklogs,
  onSummaryChange,
  onError,
}: Options) {
  const [pushState, setPushState] = useState<PushState>({ mode: 'idle' })
  // Blocks the push until every auto-truncated summary is confirmed in the
  // modal. Null = gate closed. Recomputed fresh on every Push click (no
  // persistence — each attempt re-warns).
  const [summaryGate, setSummaryGate] = useState<SummaryGate | null>(null)

  // Navigating to another day abandons any in-flight/finished push state.
  useEffect(() => {
    setPushState({ mode: 'idle' })
  }, [date])

  const runPushAction = useCallback(async (action: 'dry-run' | 'push') => {
    setPushState({ mode: 'running', action })
    onError(null)
    try {
      const summary = action === 'dry-run' ? await api.dryRunDay(date) : await api.pushDay(date)
      if (action === 'push') {
        const refreshed = await api.getDay(date)
        setDay(normalizeNotebookDay(refreshed))
        // Newly-synced blocks now exist in Tempo — refresh the overlay.
        reloadTempoWorklogs(date)
      }
      setPushState({ mode: 'done', action, summary })
    } catch (cause) {
      onError(`${action === 'dry-run' ? 'Dry run' : 'Push'} failed: ${(cause as Error).message}`)
      setPushState({ mode: 'idle' })
    }
  }, [date, onError, reloadTempoWorklogs, setDay])

  const handlePushClick = useCallback(() => {
    const entries = truncatedAutoSummaries(dayRef.current?.blocks ?? [], maxSummaryChars)
    if (entries.length === 0) {
      void runPushAction('push')
      return
    }
    setSummaryGate({ entries, confirmedIds: new Set() })
  }, [dayRef, maxSummaryChars, runPushAction])

  const handleGateConfirm = useCallback((blockId: string) => {
    setSummaryGate((gate) =>
      gate ? { ...gate, confirmedIds: new Set([...gate.confirmedIds, blockId]) } : gate,
    )
  }, [])

  const handleGateEditOverride = useCallback(
    (blockId: string, value: string) => {
      onSummaryChange(blockId, value)
    },
    [onSummaryChange],
  )

  const handleGateCancel = useCallback(() => setSummaryGate(null), [])

  const handleGatePush = useCallback(() => {
    setSummaryGate(null)
    void runPushAction('push')
  }, [runPushAction])

  return {
    pushState,
    summaryGate,
    runPushAction,
    handlePushClick,
    handleGateConfirm,
    handleGateEditOverride,
    handleGateCancel,
    handleGatePush,
  }
}
