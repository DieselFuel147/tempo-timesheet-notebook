import type { Day, Entry, JiraProfile, PushSummary, DryRunSummary } from '../shared/types'
import type { Settings, ThresholdSettings } from '../shared/settings'

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok || (data && data.error)) {
    throw new Error(data?.error ?? `HTTP ${res.status}`)
  }
  return data as T
}

export interface EntrySave {
  id?: string
  date: string
  start: string
  end: string
  ticketKey: string
  summary: string
  sortOrder?: number
}

export interface TicketSuggestion {
  key: string
  summary: string
}

const jsonHeaders = { 'Content-Type': 'application/json' }

export const api = {
  profile: () => fetch('/api/profile').then((r) => parse<JiraProfile>(r)),
  getDay: (date: string) => fetch(`/api/day/${date}`).then((r) => parse<Day>(r)),
  saveNotes: (date: string, notes: string) =>
    fetch(`/api/day/${date}/notes`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ notes }),
    }).then((r) => parse<{ ok: true }>(r)),
  saveEntry: (e: EntrySave) =>
    fetch('/api/entry', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(e) }).then(
      (r) => parse<Entry>(r),
    ),
  deleteEntry: (id: string) =>
    fetch(`/api/entry/${id}`, { method: 'DELETE' }).then((r) => parse<{ ok: true }>(r)),
  tickets: (q: string) =>
    fetch(`/api/tickets?q=${encodeURIComponent(q)}`).then((r) => parse<TicketSuggestion[]>(r)),
  dates: () => fetch('/api/dates').then((r) => parse<string[]>(r)),
  pushDay: (date: string) =>
    fetch(`/api/day/${date}/push`, { method: 'POST' }).then((r) => parse<PushSummary>(r)),
  dryRunDay: (date: string) =>
    fetch(`/api/day/${date}/push?dryRun=true`, { method: 'POST' }).then((r) =>
      parse<DryRunSummary>(r),
    ),
  getSettings: () => fetch('/api/settings').then((r) => parse<Settings>(r)),
  saveSettings: (validation: ThresholdSettings) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ validation }),
    }).then((r) => parse<Settings>(r)),
}
