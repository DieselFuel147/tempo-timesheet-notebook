import { useEffect, useState } from 'react'
import PsychologyIcon from '@mui/icons-material/Psychology'
import { api } from '@app/api'
import { Autocomplete, Box, TextField, useTheme } from '@mui/material'
import { UNTRACKED_TICKET_ID } from '@shared/notebook'
import { MONO_FONT } from '@app/theme'

interface Props {
  value: string
  invalid: boolean
  adminTicket: string
  onChange: (key: string) => void
  onAdmin: () => void
}

interface TicketOption {
  key: string
  summary: string
  label: string
}

// Pinned to the top of every suggestion list so logging untracked time is
// always one click away; the key itself bypasses ticket-shape validation and
// never syncs.
const UNTRACKED_OPTION: TicketOption = {
  key: UNTRACKED_TICKET_ID,
  summary: 'Untracked time - kept local, never pushed',
  label: `${UNTRACKED_TICKET_ID} - Untracked time - kept local, never pushed`,
}

// Ticket input with debounced Jira autocomplete. Turns red when the value is
// non-empty but not a valid key. Autocomplete is best-effort: if Jira isn't
// reachable, the field still works as a plain text input.
export function TicketField({ value, invalid, adminTicket, onChange, onAdmin }: Props) {
  const theme = useTheme()
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState<TicketOption[]>([])

  useEffect(() => {
    setLoading(true)
    const handle = setTimeout(() => {
      api
        .tickets(value.trim())
        .then((list) =>
          setOptions([UNTRACKED_OPTION, ...list.slice(0, 8).map((s) => ({ ...s, label: `${s.key} - ${s.summary}` }))]),
        )
        .catch(() => setOptions([UNTRACKED_OPTION]))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(handle)
  }, [value])

  const adminTitle = `Log as general admin (${adminTicket})`

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Autocomplete<TicketOption, false, false, true>
        freeSolo
        openOnFocus
        inputValue={value}
        options={options}
        loading={loading}
        filterOptions={(x) => x}
        onChange={(_, newValue) => {
          if (typeof newValue === 'string') {
            onChange(newValue.toUpperCase())
          } else if (newValue && newValue.key) {
            onChange(newValue.key)
          }
        }}
        onInputChange={(_, newValue) => onChange(newValue.toUpperCase())}
        getOptionLabel={(opt) => (typeof opt === 'string' ? opt : opt.key)}
        isOptionEqualToValue={(opt, val) => opt.key === (typeof val === 'string' ? val : val.key)}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="ABC-123"
            error={invalid}
            size="small"
            sx={{
              width: 220,
              '& .MuiInputBase-root': {
                backgroundColor: 'background.paper',
                borderRadius: 1,
              },
              '& .MuiInputBase-input': {
                fontFamily: MONO_FONT,
                fontWeight: 600,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
              },
            }}
            slotProps={{
              input: params.slotProps.input,
              htmlInput: {
                ...params.slotProps.htmlInput,
                spellCheck: false,
                autoCapitalize: 'characters',
              },
            }}
          />
        )}
        renderOption={(props, opt) => (
          <li {...props}>
            <Box sx={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
              {typeof opt === 'string' ? opt : opt.key}
            </Box>
            <Box sx={{ color: theme.palette.text.secondary, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {typeof opt === 'string' ? '' : opt.summary}
            </Box>
          </li>
        )}
      />
      <PsychologyIcon
        sx={{ color: theme.palette.text.secondary, cursor: 'pointer', fontSize: 18 }}
        titleAccess={adminTitle}
        onClick={onAdmin}
      />
    </Box>
  )
}
