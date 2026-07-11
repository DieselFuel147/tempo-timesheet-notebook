import type { Entry } from '../shared/types'
import type { ValidationIssue } from '../shared/validation'
import { entryDurationMinutes } from '../shared/validation'
import { formatHours } from './dateutil'
import { TicketField } from './TicketField'
import { Paper, TextField, Chip, IconButton, List, ListItem, Typography, Box } from '@mui/material'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import ErrorIcon from '@mui/icons-material/Error'
import WarningIcon from '@mui/icons-material/Warning'
import { theme } from './theme'

interface Props {
  entry: Entry
  issues: ValidationIssue[]
  adminTicket: string
  onPatch: (patch: Partial<Entry>) => void
  onDelete: () => void
}

export function EntryRow({ entry, issues, adminTicket, onPatch, onDelete }: Props) {
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  const ticketInvalid = errors.some((i) => i.code === 'INVALID_TICKET')

  const duration = entryDurationMinutes(entry)
  const synced = !!entry.tempoWorklogId

  return (
    <Paper
      variant="outlined"
      sx={{
        position: 'relative',
        borderColor: errors.length ? theme.palette.error.main : warnings.length ? theme.palette.warning.main : undefined,
        borderLeftWidth: 3,
        mb: 1,
      }}
    >
      <IconButton
        size="small"
        title="Delete entry"
        aria-label="Delete entry"
        onClick={onDelete}
        sx={{ position: 'absolute', top: 6, right: 6 }}
      >
        <CancelOutlinedIcon fontSize="small" />
      </IconButton>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', p: 0.8, pr: 5.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <TextField
            type="time"
            value={entry.start}
            onChange={(e) => onPatch({ start: e.target.value })}
            size="small"
            slotProps={{ htmlInput: { 'aria-label': 'Start time' } }}
          />
          <Typography sx={{ color: theme.palette.text.secondary }}>–</Typography>
          <TextField
            type="time"
            value={entry.end}
            onChange={(e) => onPatch({ end: e.target.value })}
            size="small"
            slotProps={{ htmlInput: { 'aria-label': 'End time' } }}
          />
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.8rem',
              minWidth: '44px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {duration !== null && duration > 0 ? formatHours(duration) : '—'}
          </Typography>
        </Box>

        <TicketField
          value={entry.ticketKey}
          invalid={ticketInvalid}
          onChange={(ticketKey) => onPatch({ ticketKey })}
          onAdmin={() => onPatch({ ticketKey: adminTicket })}
        />

        <TextField
          value={entry.summary}
          placeholder="What were you doing?"
          onChange={(e) => onPatch({ summary: e.target.value })}
          size="small"
          sx={{ flex: '1 1 160px', minWidth: '120px' }}
          slotProps={{ htmlInput: { 'aria-label': 'Summary' } }}
        />

        <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
          {synced && (
            <Chip
              label="✓ Tempo"
              size="small"
              color="success"
              variant="outlined"
              title={`Logged to Tempo (worklog ${entry.tempoWorklogId})`}
            />
          )}
        </Box>
      </Box>

      {issues.length > 0 && (
        <List dense sx={{ fontSize: '0.8rem', pt: 0 }}>
          {issues.map((i, idx) => (
            <ListItem key={idx} sx={{ px: 0 }}>
              {i.level === 'error' ? (
                <ErrorIcon sx={{ color: theme.palette.error.main, mr: 0.5, fontSize: 16 }} />
              ) : (
                <WarningIcon sx={{ color: theme.palette.warning.main, mr: 0.5, fontSize: 16 }} />
              )}
              <Typography sx={{ color: i.level === 'error' ? theme.palette.error.main : theme.palette.warning.main }}>
                {i.message}
              </Typography>
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  )
}
