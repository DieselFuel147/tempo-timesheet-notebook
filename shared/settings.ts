import { z } from 'zod'
import { defaultConfig, type ValidationConfig } from './validation'

// App settings, persisted server-side (SQLite) and editable from the Settings UI.
//
// This is the *serializable* view of configuration: the validation thresholds
// minus the one thing that can't survive JSON — the ticket-key RegExp, which is
// structural rather than a user "threshold" and so stays a code constant in
// `validation.ts`. `toValidationConfig` reattaches it to produce the runtime
// config used by the (pure) validation engine.
//
// Grouped under `validation` deliberately: this object is the home for other
// config sections as they move out of code/.env (ports, credentials, admin
// ticket, …), each its own key.

/** Editable validation thresholds — everything in ValidationConfig except the regex. */
export type ThresholdSettings = Omit<ValidationConfig, 'ticketPattern'>

export interface JiraConnectionSettings {
  baseUrl: string
  email: string
  apiTokenSaved: boolean
}

export interface TempoConnectionSettings {
  baseUrl: string
  apiTokenSaved: boolean
}

export interface ConnectionSettings {
  jira: JiraConnectionSettings
  tempo: TempoConnectionSettings
}

/**
 * The built-in system prompt shown in Settings and used when the field is
 * blank. Must stay textually identical to `DEFAULT_SYSTEM_PROMPT` in the Rust
 * `core::ai` module.
 */
export const DEFAULT_AI_SYSTEM_PROMPT =
  "You write concise Jira/Tempo worklog descriptions. Given a developer's raw " +
  'notes for one block of time, reply with a plain worklog description: one ' +
  'sentence, or at most two sentences if there is a lot of detail. Use past ' +
  'tense, no first person, no preamble, no markdown, and no surrounding quotes. ' +
  'Reply with the description text only.'

/** Local, on-device AI summarization (llama.cpp sidecar). All non-secret. */
export interface AiSettings {
  /** When false the Suggest button reports "not configured". */
  enabled: boolean
  /** Path to the llama-server binary (bundled default comes later). */
  binaryPath: string
  /** Path to the GGUF model file (default: a lightweight Gemma-3-1b quant). */
  modelPath: string
  /** Seconds of inactivity after which the sidecar process is killed. */
  idleTimeoutSecs: number
  /** Editable system prompt; blank falls back to DEFAULT_AI_SYSTEM_PROMPT. */
  systemPrompt: string
}

export interface NotificationSettings {
  /** Master switch for the macOS inactivity reminder. */
  inactivityEnabled: boolean
  /** Idle minutes before the first reminder; repeats at the same interval. */
  inactivityThresholdMinutes: number
}

export interface Settings {
  validation: ThresholdSettings
  connections: ConnectionSettings
  ai: AiSettings
  notifications: NotificationSettings
}

export interface SecretUpdates {
  jiraApiToken?: string | null
  tempoApiToken?: string | null
}

export interface SaveSettingsInput {
  settings: Settings
  secretUpdates?: SecretUpdates
}

// Single source of truth for the numbers is `defaultConfig`; peel off the regex.
const { ticketPattern, ...defaultThresholds } = defaultConfig

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function cloneSettings(settings: Settings): Settings {
  return {
    validation: { ...settings.validation },
    connections: {
      jira: { ...settings.connections.jira },
      tempo: { ...settings.connections.tempo },
    },
    ai: { ...settings.ai },
    notifications: { ...settings.notifications },
  }
}

export const defaultSettings: Settings = {
  validation: { ...defaultThresholds },
  connections: {
    jira: {
      baseUrl: '',
      email: '',
      apiTokenSaved: false,
    },
    tempo: {
      baseUrl: 'https://api.tempo.io/4',
      apiTokenSaved: false,
    },
  },
  ai: {
    enabled: false,
    binaryPath: '',
    modelPath: '',
    idleTimeoutSecs: 300,
    systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
  },
  notifications: {
    inactivityEnabled: false,
    inactivityThresholdMinutes: 60,
  },
}

/** Reattach the structural ticket pattern to make a runtime ValidationConfig. */
export function toValidationConfig(settings: Settings): ValidationConfig {
  return { ...settings.validation, ticketPattern }
}

/**
 * Merge a stored (possibly partial or stale) blob over the current defaults, so
 * old persisted settings keep working when new fields are added. Unknown keys
 * are dropped. Anything unparseable yields a clean default.
 */
export function mergeSettings(raw: unknown, base: Settings = defaultSettings): Settings {
  const merged = cloneSettings(base)
  if (!raw || typeof raw !== 'object') return merged
  const v = (raw as { validation?: unknown }).validation
  const partial = v && typeof v === 'object' ? (v as Partial<ThresholdSettings>) : {}
  for (const key of Object.keys(defaultSettings.validation) as (keyof ThresholdSettings)[]) {
    const incoming = partial[key]
    if (incoming !== undefined) {
      // Preserve the field's type; assignment is safe because keys are the known set.
      ;(merged.validation as Record<string, unknown>)[key] = incoming
    }
  }

  const connections = (raw as { connections?: unknown }).connections
  const jira =
    connections && typeof connections === 'object'
      ? (connections as { jira?: unknown }).jira
      : undefined
  if (jira && typeof jira === 'object') {
    const jiraSettings = jira as Partial<JiraConnectionSettings>
    if (typeof jiraSettings.baseUrl === 'string') {
      merged.connections.jira.baseUrl = normalizeBaseUrl(jiraSettings.baseUrl)
    }
    if (typeof jiraSettings.email === 'string') {
      merged.connections.jira.email = jiraSettings.email.trim()
    }
    if (typeof jiraSettings.apiTokenSaved === 'boolean') {
      merged.connections.jira.apiTokenSaved = jiraSettings.apiTokenSaved
    }
  }

  const tempo =
    connections && typeof connections === 'object'
      ? (connections as { tempo?: unknown }).tempo
      : undefined
  if (tempo && typeof tempo === 'object') {
    const tempoSettings = tempo as Partial<TempoConnectionSettings>
    if (typeof tempoSettings.baseUrl === 'string') {
      merged.connections.tempo.baseUrl = normalizeBaseUrl(tempoSettings.baseUrl)
    }
    if (typeof tempoSettings.apiTokenSaved === 'boolean') {
      merged.connections.tempo.apiTokenSaved = tempoSettings.apiTokenSaved
    }
  }

  const ai = (raw as { ai?: unknown }).ai
  if (ai && typeof ai === 'object') {
    const aiSettings = ai as Partial<AiSettings>
    if (typeof aiSettings.enabled === 'boolean') {
      merged.ai.enabled = aiSettings.enabled
    }
    if (typeof aiSettings.binaryPath === 'string') {
      merged.ai.binaryPath = aiSettings.binaryPath.trim()
    }
    if (typeof aiSettings.modelPath === 'string') {
      merged.ai.modelPath = aiSettings.modelPath.trim()
    }
    if (typeof aiSettings.idleTimeoutSecs === 'number' && Number.isFinite(aiSettings.idleTimeoutSecs)) {
      merged.ai.idleTimeoutSecs = Math.max(0, Math.floor(aiSettings.idleTimeoutSecs))
    }
    if (typeof aiSettings.systemPrompt === 'string') {
      merged.ai.systemPrompt = aiSettings.systemPrompt
    }
  }

  const notifications = (raw as { notifications?: unknown }).notifications
  if (notifications && typeof notifications === 'object') {
    const notificationSettings = notifications as Partial<NotificationSettings>
    if (typeof notificationSettings.inactivityEnabled === 'boolean') {
      merged.notifications.inactivityEnabled = notificationSettings.inactivityEnabled
    }
    if (
      typeof notificationSettings.inactivityThresholdMinutes === 'number' &&
      Number.isFinite(notificationSettings.inactivityThresholdMinutes)
    ) {
      merged.notifications.inactivityThresholdMinutes = Math.max(
        1,
        Math.floor(notificationSettings.inactivityThresholdMinutes),
      )
    }
  }

  return merged
}

/** Validates a thresholds payload before it is persisted via saveSettings. */
export const thresholdSchema = z
  .object({
    adminTicket: z
      .string()
      .trim()
      .regex(ticketPattern, 'Admin ticket must be a valid key, e.g. ABC-123.'),
    workdayStartMin: z.number().int().min(0).max(1439),
    workdayEndMin: z.number().int().min(1).max(1440),
    minEntryMinutes: z.number().int().min(0).max(24 * 60),
    maxEntryHours: z.number().positive().max(24),
    minDayHours: z.number().min(0).max(24),
    maxDayHours: z.number().positive().max(24),
    maxSummaryChars: z.number().int().min(20).max(10000),
  })
  .refine((s) => s.workdayEndMin > s.workdayStartMin, {
    message: 'End of the working day must be after the start.',
    path: ['workdayEndMin'],
  })
  .refine((s) => s.maxDayHours >= s.minDayHours, {
    message: 'Max day hours must be at least the min day hours.',
    path: ['maxDayHours'],
  })
