import { useState } from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { Alert, Box, Button, Paper, Stack, TextField, Typography, IconButton } from '@mui/material'
import type { Settings as AppSettings, ThresholdSettings } from '../shared/settings'
import { defaultSettings } from '../shared/settings'
import { parseTime } from '../shared/validation'
import { minutesToHHmm } from './dateutil'
import { api } from './api'

interface Props {
  settings: AppSettings
  onSaved: (settings: AppSettings) => void
  onClose: () => void
}

// A general settings page. Today it edits the validation thresholds; new config
// sections (ports, credentials, admin defaults, …) get their own <fieldset>.
export function Settings({ settings, onSaved, onClose }: Props) {
  const [draft, setDraft] = useState<ThresholdSettings>({ ...settings.validation })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.validation)

  function set<K extends keyof ThresholdSettings>(key: K, value: ThresholdSettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  // Numeric fields keep the raw value; blank/NaN falls back to 0 so the input
  // stays controlled while typing. The server re-validates ranges on save.
  const num = (key: keyof ThresholdSettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.valueAsNumber
    set(key, (Number.isNaN(v) ? 0 : v) as ThresholdSettings[typeof key])
  }

  const time = (key: 'workdayStartMin' | 'workdayEndMin') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const mins = parseTime(e.target.value)
    if (mins !== null) set(key, mins)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const result = await api.saveSettings(draft)
      onSaved(result)
      setDraft({ ...result.validation })
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
          Validation thresholds
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          These drive the live warnings on the day view. Errors (bad ticket, end before start,
          overlaps) always block a push regardless of these.
        </Typography>

        <Stack spacing={1.5}>
          <TextField
            label="General admin ticket"
            value={draft.adminTicket}
            onChange={(e) => set('adminTicket', e.target.value.trim())}
            placeholder="ABC-123"
            helperText='Stamped by the “General admin” button on a row.'
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Normal hours — start"
              type="time"
              value={minutesToHHmm(draft.workdayStartMin)}
              onChange={time('workdayStartMin')}
              fullWidth
            />
            <TextField
              label="Normal hours — end"
              type="time"
              value={minutesToHHmm(draft.workdayEndMin)}
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
              value={draft.minEntryMinutes}
              onChange={num('minEntryMinutes')}
              fullWidth
            />
            <TextField
              label="Max entry (hours)"
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
              value={draft.maxEntryHours}
              onChange={num('maxEntryHours')}
              fullWidth
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Min day total (hours)"
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
              value={draft.minDayHours}
              onChange={num('minDayHours')}
              fullWidth
            />
            <TextField
              label="Max day total (hours)"
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
              value={draft.maxDayHours}
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
            setDraft({ ...defaultSettings.validation })
            setSaved(false)
          }}
          title="Restore built-in defaults (not saved until you press Save)"
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
