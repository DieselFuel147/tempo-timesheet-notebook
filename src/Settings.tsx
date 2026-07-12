import { useState } from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { Alert, Box, Button, Paper, Stack, TextField, Typography, IconButton } from '@mui/material'
import type {
  SecretUpdates,
  Settings as AppSettings,
  ThresholdSettings,
} from '../shared/settings'
import { defaultSettings } from '../shared/settings'
import { parseTime } from '../shared/validation'
import { minutesToHHmm } from './dateutil'
import { api } from './api'

interface Props {
  settings: AppSettings
  onSaved: (settings: AppSettings) => void
  onClose: () => void
}

interface DraftState {
  validation: ThresholdSettings
  jiraBaseUrl: string
  jiraEmail: string
  tempoBaseUrl: string
  jiraApiToken: string
  tempoApiToken: string
  clearJiraApiToken: boolean
  clearTempoApiToken: boolean
}

function buildDraft(settings: AppSettings): DraftState {
  return {
    validation: { ...settings.validation },
    jiraBaseUrl: settings.connections.jira.baseUrl,
    jiraEmail: settings.connections.jira.email,
    tempoBaseUrl: settings.connections.tempo.baseUrl,
    jiraApiToken: '',
    tempoApiToken: '',
    clearJiraApiToken: false,
    clearTempoApiToken: false,
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function draftToSettings(draft: DraftState, settings: AppSettings): AppSettings {
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
  }
}

function draftToSecretUpdates(draft: DraftState): SecretUpdates | undefined {
  const secretUpdates: SecretUpdates = {}
  if (draft.clearJiraApiToken) secretUpdates.jiraApiToken = null
  else if (draft.jiraApiToken) secretUpdates.jiraApiToken = draft.jiraApiToken
  if (draft.clearTempoApiToken) secretUpdates.tempoApiToken = null
  else if (draft.tempoApiToken) secretUpdates.tempoApiToken = draft.tempoApiToken
  return Object.keys(secretUpdates).length ? secretUpdates : undefined
}

// A general settings page. Today it edits the validation thresholds; new config
// sections (ports, credentials, admin defaults, …) get their own <fieldset>.
export function Settings({ settings, onSaved, onClose }: Props) {
  const [draft, setDraft] = useState<DraftState>(() => buildDraft(settings))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const settingsDraft = draftToSettings(draft, settings)
  const dirty =
    JSON.stringify(settingsDraft) !== JSON.stringify(settings) ||
    !!draft.jiraApiToken ||
    !!draft.tempoApiToken ||
    draft.clearJiraApiToken ||
    draft.clearTempoApiToken

  function setValidation<K extends keyof ThresholdSettings>(key: K, value: ThresholdSettings[K]) {
    setDraft((d) => ({ ...d, validation: { ...d.validation, [key]: value } }))
    setSaved(false)
  }

  function setField<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  // Numeric fields keep the raw value; blank/NaN falls back to 0 so the input
  // stays controlled while typing. The server re-validates ranges on save.
  const num = (key: keyof ThresholdSettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.valueAsNumber
    setValidation(key, (Number.isNaN(v) ? 0 : v) as ThresholdSettings[typeof key])
  }

  const time = (key: 'workdayStartMin' | 'workdayEndMin') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const mins = parseTime(e.target.value)
    if (mins !== null) setValidation(key, mins)
  }

  function setToken(key: 'jiraApiToken' | 'tempoApiToken', clearKey: 'clearJiraApiToken' | 'clearTempoApiToken') {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft((d) => ({ ...d, [key]: e.target.value, [clearKey]: false }))
      setSaved(false)
    }
  }

  function clearToken(clearKey: 'clearJiraApiToken' | 'clearTempoApiToken', tokenKey: 'jiraApiToken' | 'tempoApiToken') {
    setDraft((d) => ({ ...d, [clearKey]: true, [tokenKey]: '' }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const nextSettings = draftToSettings(draft, settings)
      const result = await api.saveSettings(
        {
          settings: nextSettings,
          secretUpdates: draftToSecretUpdates(draft),
        },
        settings,
      )
      onSaved(result)
      setDraft(buildDraft(result))
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
        <IconButton type="button" onClick={onClose} title="Back to timesheet" aria-label="Back to timesheet">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="h5" component="h2">Settings</Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
          Jira and Tempo
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Manage the connection details the app uses for profile lookup, ticket search, and Tempo pushes.
        </Typography>

        <Stack spacing={1.5} sx={{ mb: 3 }}>
          <TextField
            label="Jira base URL"
            value={draft.jiraBaseUrl}
            onChange={(e) => setField('jiraBaseUrl', e.target.value)}
            placeholder="https://your-company.atlassian.net"
            helperText="Atlassian site root; trailing slash removed automatically on save."
          />

          <TextField
            label="Jira email"
            value={draft.jiraEmail}
            onChange={(e) => setField('jiraEmail', e.target.value)}
            placeholder="name@company.com"
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' } }}>
            <TextField
              label="Jira API token"
              type="password"
              value={draft.jiraApiToken}
              onChange={setToken('jiraApiToken', 'clearJiraApiToken')}
              fullWidth
              helperText={
                draft.clearJiraApiToken
                  ? 'Will be cleared on save.'
                  : settings.connections.jira.apiTokenSaved
                    ? 'Saved in app storage. Enter a new value to replace it.'
                    : 'Not saved yet.'
              }
            />
            <Button
              type="button"
              variant="outlined"
              onClick={() => clearToken('clearJiraApiToken', 'jiraApiToken')}
              sx={{ minWidth: { sm: 140 } }}
            >
              Clear saved token
            </Button>
          </Stack>

          <TextField
            label="Tempo base URL"
            value={draft.tempoBaseUrl}
            onChange={(e) => setField('tempoBaseUrl', e.target.value)}
            placeholder="https://api.tempo.io/4"
            helperText="API root used for dry run and push requests."
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' } }}>
            <TextField
              label="Tempo API token"
              type="password"
              value={draft.tempoApiToken}
              onChange={setToken('tempoApiToken', 'clearTempoApiToken')}
              fullWidth
              helperText={
                draft.clearTempoApiToken
                  ? 'Will be cleared on save.'
                  : settings.connections.tempo.apiTokenSaved
                    ? 'Saved in app storage. Enter a new value to replace it.'
                    : 'Not saved yet.'
              }
            />
            <Button
              type="button"
              variant="outlined"
              onClick={() => clearToken('clearTempoApiToken', 'tempoApiToken')}
              sx={{ minWidth: { sm: 140 } }}
            >
              Clear saved token
            </Button>
          </Stack>
        </Stack>

        <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
          Validation thresholds
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          These drive the live warnings on the day view. Errors (bad ticket, end before start,
          overlaps) always block a push regardless of these.
        </Typography>

        <Stack spacing={1.5}>
          <TextField
            label="General admin ticket"
            value={draft.validation.adminTicket}
            onChange={(e) => setValidation('adminTicket', e.target.value.trim())}
            placeholder="ABC-123"
            helperText='Stamped by the “General admin” button on a row.'
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Normal hours — start"
              type="time"
              value={minutesToHHmm(draft.validation.workdayStartMin)}
              onChange={time('workdayStartMin')}
              fullWidth
            />
            <TextField
              label="Normal hours — end"
              type="time"
              value={minutesToHHmm(draft.validation.workdayEndMin)}
              onChange={time('workdayEndMin')}
              fullWidth
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Entries outside this window warn (Early / Late).
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Min entry (minutes)"
              type="number"
              slotProps={{ htmlInput: { min: 0 } }}
              value={draft.validation.minEntryMinutes}
              onChange={num('minEntryMinutes')}
              fullWidth
            />
            <TextField
              label="Max entry (hours)"
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
              value={draft.validation.maxEntryHours}
              onChange={num('maxEntryHours')}
              fullWidth
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Min day total (hours)"
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
              value={draft.validation.minDayHours}
              onChange={num('minDayHours')}
              fullWidth
            />
            <TextField
              label="Max day total (hours)"
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
              value={draft.validation.maxDayHours}
              onChange={num('maxDayHours')}
              fullWidth
            />
          </Stack>
        </Stack>
      </Paper>

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 2 }}>
        <Button
          type="button"
          variant="outlined"
          startIcon={<RestartAltIcon fontSize="small" />}
          onClick={() => {
            setDraft(buildDraft(defaultSettings))
            setSaved(false)
          }}
          title="Restore built-in defaults and clear pending token edits (not saved until you press Save)"
        >
          Reset to defaults
        </Button>
        <Typography variant="body2" color="success.main" sx={{ flex: 1 }}>
          {saved && !dirty ? 'Saved ✓' : ''}
        </Typography>
        <Button type="button" variant="contained" disabled={saving || !dirty} onClick={save}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </Stack>
    </Box>
  )
}
