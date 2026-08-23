import { describe, expect, it } from 'vitest'
import { defaultSettings, mergeSettings } from '@shared/settings'
import { buildDraft, draftToSecretUpdates, draftToSettings } from './settingsDraft'

describe('buildDraft', () => {
  it('copies editable fields and blanks pending secrets', () => {
    const settings = mergeSettings({
      validation: { adminTicket: 'ABC-1' },
      connections: { jira: { baseUrl: 'https://jira.example.com/', email: ' dev@example.com ' } },
      ai: { enabled: true },
    })
    const draft = buildDraft(settings)
    expect(draft.validation).toEqual(settings.validation)
    // Stored URLs are pre-normalized by mergeSettings (trailing slashes stripped).
    expect(draft.jiraBaseUrl).toBe('https://jira.example.com')
    expect(draft.jiraEmail).toBe('dev@example.com')
    expect(draft.tempoBaseUrl).toBe(settings.connections.tempo.baseUrl)
    expect(draft.jiraApiToken).toBe('')
    expect(draft.tempoApiToken).toBe('')
    expect(draft.clearJiraApiToken).toBe(false)
    expect(draft.clearTempoApiToken).toBe(false)
    expect(draft.ai).toEqual(settings.ai)
    // Mutating the draft must not leak into the source settings.
    draft.validation.adminTicket = 'OTHER-1'
    expect(settings.validation.adminTicket).toBe('ABC-1')
  })
})

describe('draftToSettings', () => {
  const base = buildDraft(defaultSettings)

  it('trims base URLs and email', () => {
    const next = draftToSettings(
      { ...base, jiraBaseUrl: 'https://jira.example.com///', tempoBaseUrl: ' https://api.tempo.io/4/ ', jiraEmail: ' dev@example.com ' },
      defaultSettings,
    )
    expect(next.connections.jira.baseUrl).toBe('https://jira.example.com')
    expect(next.connections.tempo.baseUrl).toBe('https://api.tempo.io/4')
    expect(next.connections.jira.email).toBe('dev@example.com')
  })

  it('marks a token saved only when one was entered and not cleared', () => {
    const withToken = draftToSettings({ ...base, jiraApiToken: 'secret' }, defaultSettings)
    expect(withToken.connections.jira.apiTokenSaved).toBe(true)

    const cleared = draftToSettings({ ...base, jiraApiToken: 'secret', clearJiraApiToken: true }, { ...defaultSettings, connections: { ...defaultSettings.connections, jira: { ...defaultSettings.connections.jira, apiTokenSaved: true } } })
    expect(cleared.connections.jira.apiTokenSaved).toBe(false)
  })

  it('keeps an existing saved flag when no new token is typed', () => {
    const saved = { ...defaultSettings, connections: { ...defaultSettings.connections, tempo: { ...defaultSettings.connections.tempo, apiTokenSaved: true } } }
    const untouched = draftToSettings(buildDraft(saved), saved)
    expect(untouched.connections.tempo.apiTokenSaved).toBe(true)
  })

  it('passes validation thresholds through unchanged', () => {
    const draft = buildDraft(mergeSettings({ validation: { minDayHours: 6, maxSummaryChars: 250 } }))
    expect(draftToSettings(draft, defaultSettings).validation).toEqual(draft.validation)
  })
})

describe('draftToSecretUpdates', () => {
  const base = buildDraft(defaultSettings)

  it('returns undefined when nothing secret changed', () => {
    expect(draftToSecretUpdates(base)).toBeUndefined()
  })

  it('sends newly typed tokens', () => {
    expect(draftToSecretUpdates({ ...base, jiraApiToken: 'a', tempoApiToken: 'b' })).toEqual({
      jiraApiToken: 'a',
      tempoApiToken: 'b',
    })
  })

  it('clearing wins over a typed replacement', () => {
    expect(draftToSecretUpdates({ ...base, jiraApiToken: 'a', clearJiraApiToken: true })).toEqual({
      jiraApiToken: null,
    })
  })
})
