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

export interface Settings {
  validation: ThresholdSettings
}

// Single source of truth for the numbers is `defaultConfig`; peel off the regex.
const { ticketPattern, ...defaultThresholds } = defaultConfig

export const defaultSettings: Settings = {
  validation: { ...defaultThresholds },
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
export function mergeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return defaultSettings
  const v = (raw as { validation?: unknown }).validation
  const partial = v && typeof v === 'object' ? (v as Partial<ThresholdSettings>) : {}
  const validation: ThresholdSettings = { ...defaultSettings.validation }
  for (const key of Object.keys(defaultSettings.validation) as (keyof ThresholdSettings)[]) {
    const incoming = partial[key]
    if (incoming !== undefined) {
      // Preserve the field's type; assignment is safe because keys are the known set.
      ;(validation as Record<string, unknown>)[key] = incoming
    }
  }
  return { validation }
}

/** Validates an incoming thresholds payload (server-side gate for PUT /api/settings). */
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
  })
  .refine((s) => s.workdayEndMin > s.workdayStartMin, {
    message: 'End of the working day must be after the start.',
    path: ['workdayEndMin'],
  })
  .refine((s) => s.maxDayHours >= s.minDayHours, {
    message: 'Max day hours must be at least the min day hours.',
    path: ['maxDayHours'],
  })
