import { useCallback, useRef, useState } from 'react'
import type { DryRunSummary, PushSummary } from '@shared/types'

export type TempoAction = 'dry-run' | 'push'
export type NotebookErrorSource = 'day-load' | 'day-save' | 'ai-suggest'

export type ActivityOutcome =
  | { kind: 'dry-run-ok'; targetDate: string; summary: DryRunSummary }
  | { kind: 'push-ok'; targetDate: string; summary: PushSummary }
  | { kind: 'tempo-failed'; action: TempoAction; targetDate: string; message: string }
  | { kind: 'notebook-error'; source: NotebookErrorSource; message: string }

export type ActivityEntry =
  | { id: number; timestamp: number; category: 'tempo'; action: 'dry-run'; targetDate: string; status: 'ok'; summary: DryRunSummary }
  | { id: number; timestamp: number; category: 'tempo'; action: 'push'; targetDate: string; status: 'ok'; summary: PushSummary }
  | { id: number; timestamp: number; category: 'tempo'; action: TempoAction; targetDate: string; status: 'failed'; message: string }
  | { id: number; timestamp: number; category: 'notebook'; source: NotebookErrorSource; message: string }

export interface ActivityDescriptor {
  severity: 'success' | 'info' | 'warning' | 'error'
  title: string
  detail: string
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

const NOTEBOOK_ERROR_TITLES: Record<NotebookErrorSource, string> = {
  'day-load': "Couldn't load this day",
  'day-save': 'Save failed',
  'ai-suggest': 'AI suggestion failed',
}

export function describeActivityEntry(entry: ActivityEntry): ActivityDescriptor {
  if (entry.category === 'notebook') {
    return { severity: 'error', title: NOTEBOOK_ERROR_TITLES[entry.source], detail: entry.message }
  }
  if (entry.status === 'failed') {
    return {
      severity: 'error',
      title: entry.action === 'dry-run' ? 'Dry run failed' : 'Push failed',
      detail: entry.message,
    }
  }
  if (entry.action === 'dry-run') {
    const { planned, skipped, blocked } = entry.summary
    if (blocked.length > 0) {
      return {
        severity: 'error',
        title: 'Dry run blocked',
        detail: `Blocked by ${plural(blocked.length, 'validation error')}. Nothing was sent.`,
      }
    }
    return {
      severity: 'info',
      title: 'Dry run completed',
      detail: `Prepared ${plural(planned.length, 'worklog request')} and would skip ${plural(skipped, 'already-synced block')}. Nothing was sent.`,
    }
  }
  const { synced, failed, skipped, blocked } = entry.summary
  if (blocked.length > 0) {
    return {
      severity: 'error',
      title: 'Push blocked',
      detail: `Blocked by ${plural(blocked.length, 'validation error')}. Nothing was sent.`,
    }
  }
  if (failed > 0) {
    return {
      severity: 'warning',
      title: 'Push completed with failures',
      detail: `Synced ${synced}, failed ${failed}, skipped ${plural(skipped, 'already-synced block')}.`,
    }
  }
  return {
    severity: 'success',
    title: 'Push completed',
    detail: `Synced ${plural(synced, 'block')} to Tempo and skipped ${plural(skipped, 'already-synced block')}.`,
  }
}

function toEntry(outcome: ActivityOutcome, id: number): ActivityEntry {
  switch (outcome.kind) {
    case 'dry-run-ok':
      return { id, timestamp: Date.now(), category: 'tempo', action: 'dry-run', targetDate: outcome.targetDate, status: 'ok', summary: outcome.summary }
    case 'push-ok':
      return { id, timestamp: Date.now(), category: 'tempo', action: 'push', targetDate: outcome.targetDate, status: 'ok', summary: outcome.summary }
    case 'tempo-failed':
      return { id, timestamp: Date.now(), category: 'tempo', action: outcome.action, targetDate: outcome.targetDate, status: 'failed', message: outcome.message }
    case 'notebook-error':
      return { id, timestamp: Date.now(), category: 'notebook', source: outcome.source, message: outcome.message }
  }
}

/** Session-only history of Tempo dry runs / pushes and notebook errors (lost when the app closes). */
export function useActivityLog() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const nextId = useRef(1)

  const record = useCallback((outcome: ActivityOutcome): ActivityEntry => {
    const entry = toEntry(outcome, nextId.current++)
    setEntries((prev) => [entry, ...prev])
    return entry
  }, [])

  return { entries, record }
}
