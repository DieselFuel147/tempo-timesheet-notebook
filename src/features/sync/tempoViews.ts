import type { TempoWorklog } from '@shared/types'
import { DAY_MINUTES } from '@app/features/notebook/blockModel'

export interface TempoWorklogView extends TempoWorklog {
  startMinute: number
  endMinute: number
  inNotebook: boolean
}

// Tempo worklog startTime is "HH:mm:ss"; map to minutes-from-midnight so read
// worklogs share the ruler's coordinate space with editable notebook blocks.
export function parseStartTimeToMinute(startTime: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(startTime.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return Math.min(DAY_MINUTES, Math.max(0, hours * 60 + minutes))
}

export function toTempoWorklogViews(worklogs: TempoWorklog[], localWorklogIds: Set<number>): TempoWorklogView[] {
  return worklogs
    .map((worklog) => {
      const startMinute = parseStartTimeToMinute(worklog.startTime)
      if (startMinute === null) return null
      const durationMinutes = Math.max(1, Math.round(worklog.timeSpentSeconds / 60))
      return {
        ...worklog,
        startMinute,
        endMinute: Math.min(DAY_MINUTES, startMinute + durationMinutes),
        inNotebook: localWorklogIds.has(worklog.tempoWorklogId),
      }
    })
    .filter((view): view is TempoWorklogView => view !== null)
    .sort((left, right) => left.startMinute - right.startMinute)
}
