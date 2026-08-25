import { Stack, TextField, Typography } from '@mui/material'
import type { ThresholdSettings } from '@shared/settings'
import { parseTime } from '@shared/validation'
import { minutesToHHmm } from '@app/dateutil'

interface Props {
  validation: ThresholdSettings
  onChange: (patch: Partial<ThresholdSettings>) => void
}

export function ValidationSection({ validation, onChange }: Props) {
  // Numeric fields keep the raw value; blank/NaN falls back to 0 so the input
  // stays controlled while typing. The server re-validates ranges on save.
  function num(key: keyof ThresholdSettings) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.valueAsNumber
      onChange({ [key]: (Number.isNaN(v) ? 0 : v) as ThresholdSettings[typeof key] })
    }
  }

  function time(key: 'workdayStartMin' | 'workdayEndMin') {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const mins = parseTime(e.target.value)
      if (mins !== null) onChange({ [key]: mins })
    }
  }

  return (
    <>
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
          value={validation.adminTicket}
          onChange={(e) => onChange({ adminTicket: e.target.value.trim() })}
          placeholder="ABC-123"
          helperText='Stamped by the “General admin” button on a row.'
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            label="Normal hours - start"
            type="time"
            value={minutesToHHmm(validation.workdayStartMin)}
            onChange={time('workdayStartMin')}
            fullWidth
          />
          <TextField
            label="Normal hours - end"
            type="time"
            value={minutesToHHmm(validation.workdayEndMin)}
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
            value={validation.minEntryMinutes}
            onChange={num('minEntryMinutes')}
            fullWidth
          />
          <TextField
            label="Max entry (hours)"
            type="number"
            slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
            value={validation.maxEntryHours}
            onChange={num('maxEntryHours')}
            fullWidth
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            label="Min day total (hours)"
            type="number"
            slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
            value={validation.minDayHours}
            onChange={num('minDayHours')}
            fullWidth
          />
          <TextField
            label="Max day total (hours)"
            type="number"
            slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
            value={validation.maxDayHours}
            onChange={num('maxDayHours')}
            fullWidth
          />
        </Stack>

        <TextField
          label="Max summary length (characters)"
          type="number"
          slotProps={{ htmlInput: { min: 20, max: 10000 } }}
          value={validation.maxSummaryChars}
          onChange={num('maxSummaryChars')}
          helperText="Auto-generated summaries are cut to this many characters (ellipsis included) before upload. Entries with an explicit Time Entry Summary are not truncated."
        />
      </Stack>
    </>
  )
}
