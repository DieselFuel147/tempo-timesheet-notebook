import type { Entry, WorklogInput } from './types'
import { entryDurationMinutes } from './validation'

/** Convert an editable entry + resolved ids into a Tempo worklog payload. */
export function toWorklogInput(
  entry: Entry,
  issueId: number,
  authorAccountId: string,
): WorklogInput {
  const minutes = entryDurationMinutes(entry)
  if (minutes === null || minutes <= 0) {
    throw new Error(`Entry has an invalid time range (${entry.start}–${entry.end})`)
  }
  return {
    issueId,
    timeSpentSeconds: minutes * 60,
    startDate: entry.date,
    startTime: `${entry.start}:00`,
    description: entry.summary.trim(),
    authorAccountId,
  }
}
