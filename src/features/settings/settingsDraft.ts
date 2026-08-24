import type { AiSettings, NotificationSettings, SecretUpdates, Settings, ThresholdSettings } from '@shared/settings'

/** Editable snapshot of the settings form; secrets start blank every visit. */
export interface DraftState {
  validation: ThresholdSettings
  jiraBaseUrl: string
  jiraEmail: string
  tempoBaseUrl: string
  jiraApiToken: string
  tempoApiToken: string
  clearJiraApiToken: boolean
  clearTempoApiToken: boolean
  ai: AiSettings
  notifications: NotificationSettings
}

export function buildDraft(settings: Settings): DraftState {
  return {
    validation: { ...settings.validation },
    jiraBaseUrl: settings.connections.jira.baseUrl,
    jiraEmail: settings.connections.jira.email,
    tempoBaseUrl: settings.connections.tempo.baseUrl,
    jiraApiToken: '',
    tempoApiToken: '',
    clearJiraApiToken: false,
    clearTempoApiToken: false,
    ai: { ...settings.ai },
    notifications: { ...settings.notifications },
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function draftToSettings(draft: DraftState, settings: Settings): Settings {
  return {
    validation: { ...draft.validation },
    connections: {
      jira: {
        baseUrl: normalizeBaseUrl(draft.jiraBaseUrl),
        email: draft.jiraEmail.trim(),
        apiTokenSaved: draft.clearJiraApiToken ? false : settings.connections.jira.apiTokenSaved || !!draft.jiraApiToken,
      },
      tempo: {
        baseUrl: normalizeBaseUrl(draft.tempoBaseUrl),
        apiTokenSaved: draft.clearTempoApiToken ? false : settings.connections.tempo.apiTokenSaved || !!draft.tempoApiToken,
      },
    },
    ai: {
      enabled: draft.ai.enabled,
      binaryPath: draft.ai.binaryPath.trim(),
      modelPath: draft.ai.modelPath.trim(),
      idleTimeoutSecs: draft.ai.idleTimeoutSecs,
      systemPrompt: draft.ai.systemPrompt,
    },
    notifications: { ...draft.notifications },
  }
}

export function draftToSecretUpdates(draft: DraftState): SecretUpdates | undefined {
  const secretUpdates: SecretUpdates = {}
  if (draft.clearJiraApiToken) secretUpdates.jiraApiToken = null
  else if (draft.jiraApiToken) secretUpdates.jiraApiToken = draft.jiraApiToken
  if (draft.clearTempoApiToken) secretUpdates.tempoApiToken = null
  else if (draft.tempoApiToken) secretUpdates.tempoApiToken = draft.tempoApiToken
  return Object.keys(secretUpdates).length ? secretUpdates : undefined
}
