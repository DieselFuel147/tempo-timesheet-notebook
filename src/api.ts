import { defaultSettings, mergeSettings, type SaveSettingsInput, type Settings } from '../shared/settings'
import { tauriCommandNames, type TicketSuggestion, type UpsertEntryInput } from '../shared/tauri-contracts'
import type { Day, Entry, JiraProfile, PushSummary, DryRunSummary } from '../shared/types'
import { invokeCommand, isDesktopRuntime } from './api/desktopApi'

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok || (data && data.error)) {
    throw new Error(data?.error ?? `HTTP ${res.status}`)
  }
  return data as T
}

export type EntrySave = UpsertEntryInput

const jsonHeaders = { 'Content-Type': 'application/json' }

function normalizeSettings(settings: unknown, base: Settings = defaultSettings): Settings {
  return mergeSettings(settings, base)
}

function hasConnectionSettings(settings: unknown): settings is { connections: unknown } {
  return !!settings && typeof settings === 'object' && 'connections' in settings
}

function normalizeSavedSettings(raw: unknown, requested: Settings, previous: Settings): Settings {
  if (hasConnectionSettings(raw)) return normalizeSettings(raw)

  const normalized = normalizeSettings(raw, requested)
  return {
    ...normalized,
    connections: {
      jira: {
        ...requested.connections.jira,
        apiTokenSaved: previous.connections.jira.apiTokenSaved,
      },
      tempo: {
        ...requested.connections.tempo,
        apiTokenSaved: previous.connections.tempo.apiTokenSaved,
      },
    },
  }
}

export const api = {
  profile: () =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.getProfile)
      : fetch('/api/profile').then((r) => parse<JiraProfile>(r)),
  getDay: (date: string) =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.getDay, { date })
      : fetch(`/api/day/${date}`).then((r) => parse<Day>(r)),
  saveNotes: (date: string, notes: string) =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.saveDayNotes, { date, notes })
      : fetch(`/api/day/${date}/notes`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify({ notes }),
        }).then((r) => parse<{ ok: true }>(r)),
  saveEntry: (input: EntrySave) =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.upsertEntry, { input })
      : fetch('/api/entry', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }).then((r) =>
          parse<Entry>(r),
        ),
  deleteEntry: (id: string) =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.deleteEntry, { id })
      : fetch(`/api/entry/${id}`, { method: 'DELETE' }).then((r) => parse<{ ok: true }>(r)),
  tickets: (query: string) =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.searchTickets, { query })
      : fetch(`/api/tickets?q=${encodeURIComponent(query)}`).then((r) => parse<TicketSuggestion[]>(r)),
  dates: () =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.listDates)
      : fetch('/api/dates').then((r) => parse<string[]>(r)),
  pushDay: (date: string) =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.pushDay, { date })
      : fetch(`/api/day/${date}/push`, { method: 'POST' }).then((r) => parse<PushSummary>(r)),
  dryRunDay: (date: string) =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.dryRunDay, { date })
      : fetch(`/api/day/${date}/push?dryRun=true`, { method: 'POST' }).then((r) => parse<DryRunSummary>(r)),
  getSettings: () =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.getSettings).then((settings) => normalizeSettings(settings))
      : fetch('/api/settings').then((r) => parse<Settings>(r)).then((settings) => normalizeSettings(settings)),
  saveSettings: (input: SaveSettingsInput, previousSettings: Settings) =>
    isDesktopRuntime()
      ? invokeCommand(tauriCommandNames.saveSettings, {
          settings: input.settings,
          secretUpdates: input.secretUpdates,
        }).then((settings) => normalizeSavedSettings(settings, input.settings, previousSettings))
      : fetch('/api/settings', {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(input),
        }).then((r) => parse<Settings>(r)).then((settings) => normalizeSavedSettings(settings, input.settings, previousSettings)),
}
