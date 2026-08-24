import { useState } from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { Alert, Box, Button, IconButton, Paper, Stack, Typography } from '@mui/material'
import type { Settings as AppSettings } from '@shared/settings'
import { defaultSettings } from '@shared/settings'
import { api } from '@app/api'
import type { Appearance } from '@app/appearance'
import { buildDraft, draftToSecretUpdates, draftToSettings, type DraftState } from './settingsDraft'
import { AppearanceSection } from './sections/AppearanceSection'
import { ConnectionsSection } from './sections/ConnectionsSection'
import { ValidationSection } from './sections/ValidationSection'
import { AiSection } from './sections/AiSection'
import { UpdaterSection } from '@app/features/updater/UpdaterSection'
import type { AppUpdater } from '@app/features/updater/useAppUpdater'

interface Props {
  settings: AppSettings
  onSaved: (settings: AppSettings) => void
  onClose: () => void
  appearance: Appearance
  onAppearanceChange: (value: Appearance) => void
  updater: AppUpdater
}

// A general settings page. Today it edits the validation thresholds; new config
// sections (ports, credentials, admin defaults, …) get their own section
// component under ./sections.
export function SettingsPage({ settings, onSaved, onClose, appearance, onAppearanceChange, updater }: Props) {
  const [draft, setDraft] = useState<DraftState>(() => buildDraft(settings))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const update = (patch: Partial<DraftState>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaved(false)
  }

  const settingsDraft = draftToSettings(draft, settings)
  const dirty =
    JSON.stringify(settingsDraft) !== JSON.stringify(settings) ||
    !!draft.jiraApiToken ||
    !!draft.tempoApiToken ||
    draft.clearJiraApiToken ||
    draft.clearTempoApiToken

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
    <Box sx={{ maxWidth: 700, mx: 'auto' }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
        <IconButton type="button" onClick={onClose} title="Back to timesheet" aria-label="Back to timesheet">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="h5" component="h2">Settings</Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <AppearanceSection appearance={appearance} onAppearanceChange={onAppearanceChange} />

      <ConnectionsSection draft={draft} settings={settings} onChange={update} />

      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <ValidationSection validation={draft.validation} onChange={(validation) => update({ validation: { ...draft.validation, ...validation } })} />
      </Paper>

      <AiSection ai={draft.ai} onChange={(ai) => update({ ai: { ...draft.ai, ...ai } })} />

      <UpdaterSection updater={updater} />

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

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 4 }}>
        Version {__APP_VERSION__}
      </Typography>
    </Box>
  )
}
