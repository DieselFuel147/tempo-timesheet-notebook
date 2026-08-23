import { defaultSettings, mergeSettings, type SaveSettingsInput, type Settings } from '@shared/settings'
import { tauriCommandNames, type SaveDayInput } from '@shared/tauri-contracts'
import type { NotebookDay, TempoWorklog } from '@shared/types'
import { invokeCommand } from './invokeCommand'

export type NotebookDaySave = SaveDayInput

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
  profile: () => invokeCommand(tauriCommandNames.getProfile),
  getDay: (date: string) =>
    invokeCommand(tauriCommandNames.getDay, { date }).then((day) => day as NotebookDay),
  saveDay: (input: NotebookDaySave) =>
    invokeCommand(tauriCommandNames.saveDay, { input }).then((day) => day as NotebookDay),
  tickets: (query: string) => invokeCommand(tauriCommandNames.searchTickets, { query }),
  dates: () => invokeCommand(tauriCommandNames.listDates),
  pushDay: (date: string) => invokeCommand(tauriCommandNames.pushDay, { date }),
  dryRunDay: (date: string) => invokeCommand(tauriCommandNames.dryRunDay, { date }),
  getTempoWorklogs: (date: string) =>
    invokeCommand(tauriCommandNames.getTempoWorklogs, { date }).then((worklogs) => worklogs as TempoWorklog[]),
  // Local, on-device AI. Desktop (Tauri) only.
  suggestSummary: (text: string) => invokeCommand(tauriCommandNames.suggestSummary, { text }),
  aiStatus: () => invokeCommand(tauriCommandNames.aiStatus),
  getSettings: () =>
    invokeCommand(tauriCommandNames.getSettings).then((settings) => normalizeSettings(settings)),
  saveSettings: (input: SaveSettingsInput, previousSettings: Settings) =>
    invokeCommand(tauriCommandNames.saveSettings, {
      settings: input.settings,
      secretUpdates: input.secretUpdates,
    }).then((settings) => normalizeSavedSettings(settings, input.settings, previousSettings)),
}
