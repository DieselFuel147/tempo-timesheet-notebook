import type { Settings, ThresholdSettings } from '../shared/settings'
import {
  tauriCommandNames,
  type NativeCommandError,
  type SaveSettingsInput,
  type TauriCommandContracts,
  type TicketSuggestion,
  type UpsertEntryInput,
} from '../shared/tauri-contracts'
import type { Day, Entry, JiraProfile, PushSummary, DryRunSummary } from '../shared/types'

type InvokeArgs = Record<string, unknown> | undefined

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

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function toError(error: unknown): Error {
  if (error && typeof error === 'object' && 'message' in error) {
    const nativeError = error as NativeCommandError
    return new Error(nativeError.message)
  }
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  return new Error('Unknown error')
}

async function invokeCommand<TName extends keyof TauriCommandContracts>(
  command: TName,
  args?: InvokeArgs,
): Promise<TauriCommandContracts[TName]['output']> {
  const { invoke } = await import('@tauri-apps/api/core')

  try {
    return await invoke<TauriCommandContracts[TName]['output']>(command, args)
  } catch (error) {
    throw toError(error)
  }
}

export const api = {
  profile: () =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.getProfile)
      : fetch('/api/profile').then((r) => parse<JiraProfile>(r)),
  getDay: (date: string) =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.getDay, { date })
      : fetch(`/api/day/${date}`).then((r) => parse<Day>(r)),
  saveNotes: (date: string, notes: string) =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.saveDayNotes, { date, notes })
      : fetch(`/api/day/${date}/notes`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify({ notes }),
        }).then((r) => parse<{ ok: true }>(r)),
  saveEntry: (e: EntrySave) =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.upsertEntry, { input: e })
      : fetch('/api/entry', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(e) }).then(
          (r) => parse<Entry>(r),
        ),
  deleteEntry: (id: string) =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.deleteEntry, { id })
      : fetch(`/api/entry/${id}`, { method: 'DELETE' }).then((r) => parse<{ ok: true }>(r)),
  tickets: (q: string) =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.searchTickets, { query: q })
      : fetch(`/api/tickets?q=${encodeURIComponent(q)}`).then((r) => parse<TicketSuggestion[]>(r)),
  dates: () =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.listDates)
      : fetch('/api/dates').then((r) => parse<string[]>(r)),
  pushDay: (date: string) =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.pushDay, { date })
      : fetch(`/api/day/${date}/push`, { method: 'POST' }).then((r) => parse<PushSummary>(r)),
  dryRunDay: (date: string) =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.dryRunDay, { date })
      : fetch(`/api/day/${date}/push?dryRun=true`, { method: 'POST' }).then((r) =>
          parse<DryRunSummary>(r),
        ),
  getSettings: () =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.getSettings)
      : fetch('/api/settings').then((r) => parse<Settings>(r)),
  saveSettings: (validation: ThresholdSettings) =>
    isTauriRuntime()
      ? invokeCommand(tauriCommandNames.saveSettings, {
          settings: { validation },
        } satisfies SaveSettingsInput)
      : fetch('/api/settings', {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify({ validation }),
        }).then((r) => parse<Settings>(r)),
}
