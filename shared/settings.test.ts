import { describe, it, expect } from 'vitest'
import { defaultConfig } from './validation'
import {
  cloneSettings,
  defaultSettings,
  toValidationConfig,
  mergeSettings,
  type SaveSettingsInput,
  thresholdSchema,
} from './settings'

describe('defaultSettings', () => {
  it('mirrors the numeric thresholds in defaultConfig', () => {
    expect(defaultSettings.validation).toMatchObject({
      adminTicket: defaultConfig.adminTicket,
      workdayStartMin: defaultConfig.workdayStartMin,
      workdayEndMin: defaultConfig.workdayEndMin,
      minEntryMinutes: defaultConfig.minEntryMinutes,
      maxEntryHours: defaultConfig.maxEntryHours,
      minDayHours: defaultConfig.minDayHours,
      maxDayHours: defaultConfig.maxDayHours,
      maxSummaryChars: defaultConfig.maxSummaryChars,
    })
  })

  it('does not carry the non-serializable ticketPattern', () => {
    expect('ticketPattern' in defaultSettings.validation).toBe(false)
    expect(JSON.parse(JSON.stringify(defaultSettings))).toEqual(defaultSettings)
  })

  it('includes editable connection defaults without secret values', () => {
    expect(defaultSettings.connections).toEqual({
      jira: {
        baseUrl: '',
        email: '',
        apiTokenSaved: false,
      },
      tempo: {
        baseUrl: 'https://api.tempo.io/4',
        apiTokenSaved: false,
      },
    })
  })
})

describe('toValidationConfig', () => {
  it('reattaches the ticket pattern so the result is a usable ValidationConfig', () => {
    const config = toValidationConfig(defaultSettings)
    expect(config.ticketPattern).toBeInstanceOf(RegExp)
    expect(config.ticketPattern.test('ABC-123')).toBe(true)
    expect(config.maxDayHours).toBe(defaultSettings.validation.maxDayHours)
  })

  it('round-trips the default settings back to the default config', () => {
    expect(toValidationConfig(defaultSettings)).toEqual(defaultConfig)
  })
})

describe('cloneSettings', () => {
  it('returns an equal copy whose nested sections can mutate independently', () => {
    const original = mergeSettings({ validation: { maxDayHours: 9 }, ai: { enabled: true } })
    const copy = cloneSettings(original)
    expect(copy).toEqual(original)

    copy.validation.maxDayHours = 10
    copy.connections.jira.email = 'someone@example.com'
    copy.ai.enabled = false
    expect(original.validation.maxDayHours).toBe(9)
    expect(original.connections.jira.email).toBe('')
    expect(original.ai.enabled).toBe(true)
  })
})

describe('mergeSettings', () => {
  it('fills missing fields from defaults (forward-compatible with old stored blobs)', () => {
    const merged = mergeSettings({ validation: { maxDayHours: 10 } })
    expect(merged.validation.maxDayHours).toBe(10)
    expect(merged.validation.minDayHours).toBe(defaultSettings.validation.minDayHours)
    expect(merged.validation.adminTicket).toBe(defaultSettings.validation.adminTicket)
    expect(merged.connections).toEqual(defaultSettings.connections)
  })

  it('returns a clean default when given null/garbage', () => {
    expect(mergeSettings(null)).toEqual(defaultSettings)
    expect(mergeSettings(undefined)).toEqual(defaultSettings)
    expect(mergeSettings('nope')).toEqual(defaultSettings)
  })

  it('ignores unknown keys', () => {
    const merged = mergeSettings({ validation: { maxDayHours: 9 }, bogus: true } as unknown)
    expect('bogus' in merged).toBe(false)
  })

  it('merges notification settings and clamps the threshold to at least one minute', () => {
    const merged = mergeSettings({ notifications: { inactivityEnabled: true, inactivityThresholdMinutes: 45 } })
    expect(merged.notifications.inactivityEnabled).toBe(true)
    expect(merged.notifications.inactivityThresholdMinutes).toBe(45)

    expect(mergeSettings({ notifications: { inactivityThresholdMinutes: 0.5 } }).notifications.inactivityThresholdMinutes).toBe(1)
    // Absent section falls back to defaults.
    expect(mergeSettings({}).notifications).toEqual(defaultSettings.notifications)
  })

  it('merges connection settings and trims normalized values', () => {
    const merged = mergeSettings({
      connections: {
        jira: {
          baseUrl: 'https://example.atlassian.net///',
          email: '  person@example.com  ',
          apiTokenSaved: true,
        },
        tempo: {
          baseUrl: 'https://api.tempo.io/4/',
          apiTokenSaved: true,
        },
      },
    })

    expect(merged.connections).toEqual({
      jira: {
        baseUrl: 'https://example.atlassian.net',
        email: 'person@example.com',
        apiTokenSaved: true,
      },
      tempo: {
        baseUrl: 'https://api.tempo.io/4',
        apiTokenSaved: true,
      },
    })
  })

  it('merges raw settings over a supplied base so older responses do not wipe local metadata', () => {
    const base = mergeSettings({
      connections: {
        jira: { apiTokenSaved: true },
        tempo: { apiTokenSaved: true },
      },
    })

    const merged = mergeSettings({ validation: { maxDayHours: 9 } }, base)

    expect(merged.validation.maxDayHours).toBe(9)
    expect(merged.connections.jira.apiTokenSaved).toBe(true)
    expect(merged.connections.tempo.apiTokenSaved).toBe(true)
  })
})

describe('SaveSettingsInput', () => {
  it('supports optional secret updates without embedding secrets in Settings', () => {
    const input: SaveSettingsInput = {
      settings: defaultSettings,
      secretUpdates: {
        jiraApiToken: 'jira-token',
        tempoApiToken: null,
      },
    }

    expect(input.settings.connections.jira.apiTokenSaved).toBe(false)
    expect(input.secretUpdates?.tempoApiToken).toBeNull()
  })
})

describe('thresholdSchema', () => {
  const valid = { ...defaultSettings.validation }

  it('accepts the default thresholds', () => {
    expect(thresholdSchema.parse(valid)).toEqual(valid)
  })

  it('rejects an end-of-day that is not after the start', () => {
    expect(() =>
      thresholdSchema.parse({ ...valid, workdayStartMin: 600, workdayEndMin: 600 }),
    ).toThrow()
  })

  it('rejects a max day below the min day', () => {
    expect(() => thresholdSchema.parse({ ...valid, minDayHours: 10, maxDayHours: 4 })).toThrow()
  })

  it('rejects an admin ticket that is not a valid key', () => {
    expect(() => thresholdSchema.parse({ ...valid, adminTicket: 'not a ticket' })).toThrow()
  })

  it('rejects out-of-range minutes', () => {
    expect(() => thresholdSchema.parse({ ...valid, workdayStartMin: -1 })).toThrow()
    expect(() => thresholdSchema.parse({ ...valid, workdayEndMin: 2000 })).toThrow()
  })

  it('rejects an out-of-range summary length', () => {
    expect(() => thresholdSchema.parse({ ...valid, maxSummaryChars: 10 })).toThrow()
    expect(() => thresholdSchema.parse({ ...valid, maxSummaryChars: 10001 })).toThrow()
    expect(() => thresholdSchema.parse({ ...valid, maxSummaryChars: 250.5 })).toThrow()
  })
})
