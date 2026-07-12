import type { SaveSettingsInput, Settings } from './settings'
import type { Day, DryRunSummary, Entry, JiraProfile, NotebookDay, PushSummary } from './types'

// Wave 0 is the initial parity-oriented Tauri command set. Later waves can add
// commands, but these names and payloads should stay stable while the current
// UI is being migrated off internal HTTP.
export const TAURI_COMMAND_SET_VERSION = 'wave0' as const

export interface CommandOk {
  ok: true
}

export interface HealthStatus {
  ok: true
  commandSetVersion: typeof TAURI_COMMAND_SET_VERSION
}

export interface UpsertEntryInput {
  id?: string
  date: string
  start: string
  end: string
  ticketKey: string
  summary: string
  sortOrder?: number
}

export interface SaveDayNotesInput {
  date: string
  notes: string
}

export interface SaveDayInput {
  day: NotebookDay
}

export interface DeleteEntryInput {
  id: string
}

export interface GetDayInput {
  date: string
}

export interface ListDatesInput {
  from?: string
  to?: string
}

export interface SearchTicketsInput {
  query: string
}

export interface PushDayInput {
  date: string
}

export interface DryRunDayInput {
  date: string
}

export interface TicketSuggestion {
  key: string
  summary: string
}

export type NativeCommandErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'NOT_CONFIGURED'
  | 'AUTH_ERROR'
  | 'NETWORK_ERROR'
  | 'TLS_ERROR'
  | 'EXTERNAL_API_ERROR'
  | 'DB_ERROR'
  | 'INTERNAL_ERROR'

export interface NativeFieldError {
  field: string
  message: string
}

export interface NativeCommandError {
  code: NativeCommandErrorCode
  message: string
  details?: string[]
  fieldErrors?: NativeFieldError[]
  retryable?: boolean
}

export const tauriCommandNames = {
  healthCheck: 'health_check',
  getProfile: 'get_profile',
  getDay: 'get_day',
  saveDay: 'save_day',
  saveDayNotes: 'save_day_notes',
  upsertEntry: 'upsert_entry',
  deleteEntry: 'delete_entry',
  listDates: 'list_dates',
  getSettings: 'get_settings',
  saveSettings: 'save_settings',
  searchTickets: 'search_tickets',
  pushDay: 'push_day',
  dryRunDay: 'dry_run_day',
} as const

export type TauriCommandName = (typeof tauriCommandNames)[keyof typeof tauriCommandNames]

export interface TauriCommandContracts {
  health_check: {
    input: Record<string, never>
    output: HealthStatus
  }
  get_profile: {
    input: Record<string, never>
    output: JiraProfile
  }
  get_day: {
    input: GetDayInput
    output: Day
  }
  save_day: {
    input: SaveDayInput
    output: NotebookDay
  }
  save_day_notes: {
    input: SaveDayNotesInput
    output: CommandOk
  }
  upsert_entry: {
    input: UpsertEntryInput
    output: Entry
  }
  delete_entry: {
    input: DeleteEntryInput
    output: CommandOk
  }
  list_dates: {
    input: ListDatesInput
    output: string[]
  }
  get_settings: {
    input: Record<string, never>
    output: Settings
  }
  save_settings: {
    input: SaveSettingsInput
    output: Settings
  }
  search_tickets: {
    input: SearchTicketsInput
    output: TicketSuggestion[]
  }
  push_day: {
    input: PushDayInput
    output: PushSummary
  }
  dry_run_day: {
    input: DryRunDayInput
    output: DryRunSummary
  }
}

export type TauriCommandInput<TName extends keyof TauriCommandContracts> =
  TauriCommandContracts[TName]['input']

export type TauriCommandOutput<TName extends keyof TauriCommandContracts> =
  TauriCommandContracts[TName]['output']
