import { useState } from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
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
    <div className="settings-page">
      <div className="settings-head">
        <button type="button" className="icon-btn" onClick={onClose} title="Back to timesheet">
          <ArrowBackIcon fontSize="small" />
        </button>
        <h2>Settings</h2>
      </div>

      {error && <div className="banner error-banner">{error}</div>}

      <fieldset className="settings-group">
        <legend>Validation thresholds</legend>
        <p className="settings-hint">
          These drive the live warnings on the day view. Errors (bad ticket, end
          before start, overlaps) always block a push regardless of these.
        </p>

        <div className="settings-field">
          <label htmlFor="adminTicket">General admin ticket</label>
          <input
            id="adminTicket"
            value={draft.adminTicket}
            onChange={(e) => set('adminTicket', e.target.value.trim())}
            placeholder="ABC-123"
          />
          <span className="field-note">Stamped by the “General admin” button on a row.</span>
        </div>

        <div className="settings-row">
          <div className="settings-field">
            <label htmlFor="workdayStart">Normal hours — start</label>
            <input
              id="workdayStart"
              type="time"
              value={minutesToHHmm(draft.workdayStartMin)}
              onChange={time('workdayStartMin')}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="workdayEnd">Normal hours — end</label>
            <input
              id="workdayEnd"
              type="time"
              value={minutesToHHmm(draft.workdayEndMin)}
              onChange={time('workdayEndMin')}
            />
          </div>
        </div>
        <span className="field-note">Entries outside this window warn (Early / Late).</span>

        <div className="settings-row">
          <div className="settings-field">
            <label htmlFor="minEntry">Min entry (minutes)</label>
            <input id="minEntry" type="number" min={0} value={draft.minEntryMinutes} onChange={num('minEntryMinutes')} />
          </div>
          <div className="settings-field">
            <label htmlFor="maxEntry">Max entry (hours)</label>
            <input id="maxEntry" type="number" min={0} step={0.25} value={draft.maxEntryHours} onChange={num('maxEntryHours')} />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-field">
            <label htmlFor="minDay">Min day total (hours)</label>
            <input id="minDay" type="number" min={0} step={0.25} value={draft.minDayHours} onChange={num('minDayHours')} />
          </div>
          <div className="settings-field">
            <label htmlFor="maxDay">Max day total (hours)</label>
            <input id="maxDay" type="number" min={0} step={0.25} value={draft.maxDayHours} onChange={num('maxDayHours')} />
          </div>
        </div>
      </fieldset>

      <div className="settings-actions">
        <button
          type="button"
          className="reset-btn"
          onClick={() => {
            setDraft({ ...defaultSettings.validation })
            setSaved(false)
          }}
          title="Restore built-in defaults (not saved until you press Save)"
        >
          <RestartAltIcon fontSize="small" /> Reset to defaults
        </button>
        <span className="settings-status">{saved && !dirty ? 'Saved ✓' : ''}</span>
        <button type="button" className="push-btn" disabled={saving || !dirty} onClick={save}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
