import { describe, it, expect } from 'vitest'
import { defaultConfig } from './validation'
import {
  defaultSettings,
  toValidationConfig,
  mergeSettings,
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
    })
  })

  it('does not carry the non-serializable ticketPattern', () => {
    expect('ticketPattern' in defaultSettings.validation).toBe(false)
    expect(JSON.parse(JSON.stringify(defaultSettings))).toEqual(defaultSettings)
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

describe('mergeSettings', () => {
  it('fills missing fields from defaults (forward-compatible with old stored blobs)', () => {
    const merged = mergeSettings({ validation: { maxDayHours: 10 } })
    expect(merged.validation.maxDayHours).toBe(10)
    expect(merged.validation.minDayHours).toBe(defaultSettings.validation.minDayHours)
    expect(merged.validation.adminTicket).toBe(defaultSettings.validation.adminTicket)
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
})
