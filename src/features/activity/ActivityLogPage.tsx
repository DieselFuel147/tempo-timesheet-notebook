import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import {
  Alert,
  Box,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import dayjs from 'dayjs'
import type { PlannedWorklog } from '@shared/types'
import { prettyDate } from '@app/dateutil'
import { MONO_FONT } from '@app/theme'
import { describeActivityEntry, type ActivityEntry, type NotebookErrorSource } from './activityLog'

interface Props {
  entries: ActivityEntry[]
  onClose: () => void
}

const NOTEBOOK_SOURCE_LABELS: Record<NotebookErrorSource, string> = {
  'day-load': 'Day load',
  'day-save': 'Autosave',
  'ai-suggest': 'AI suggest',
}

function plannedDescription(planned: PlannedWorklog): string {
  const body = planned.request.body as { description?: unknown } | null
  return typeof body?.description === 'string' && body.description.trim().length > 0
    ? body.description
    : 'Notebook block'
}

function entryStatus(entry: ActivityEntry): { label: string; color: 'success' | 'warning' | 'error' } {
  if (entry.category === 'notebook') return { label: 'Failed', color: 'error' }
  if (entry.status === 'failed') return { label: 'Failed', color: 'error' }
  if ('blocked' in entry.summary && entry.summary.blocked.length > 0) return { label: 'Blocked', color: 'error' }
  if ('failed' in entry.summary && entry.summary.failed > 0) return { label: 'Partial', color: 'warning' }
  return { label: entry.action === 'dry-run' ? 'Completed' : 'Synced', color: 'success' }
}

function BlockedMessages({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null
  return (
    <Stack spacing={0.5}>
      {messages.map((message, index) => (
        <Typography key={`blocked-${index}`} variant="caption" color="error.main">
          {message}
        </Typography>
      ))}
    </Stack>
  )
}

function DryRunDetails({ summary }: { summary: Extract<ActivityEntry, { action: 'dry-run' }>['summary'] }) {
  return (
    <Stack spacing={1.25}>
      <Alert severity={summary.blocked.length > 0 ? 'error' : 'info'}>
        {summary.blocked.length > 0
          ? `Dry run blocked by ${summary.blocked.length} validation error${summary.blocked.length === 1 ? '' : 's'}.`
          : `Dry run prepared ${summary.planned.length} worklog request${summary.planned.length === 1 ? '' : 's'} and would skip ${summary.skipped} already-synced block${summary.skipped === 1 ? '' : 's'}.`}
      </Alert>
      <BlockedMessages messages={summary.blocked} />
      {summary.planned.length > 0 && (
        <Stack spacing={1}>
          {summary.planned.map((planned) => (
            <Paper key={planned.blockId} variant="outlined" sx={{ p: 1.25, bgcolor: 'background.default' }}>
              <Stack spacing={0.5}>
                <Typography variant="subtitle2">
                  {planned.ticketId} · {plannedDescription(planned)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_FONT }}>
                  POST {planned.request.url}
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: MONO_FONT, wordBreak: 'break-all' }}>
                  {JSON.stringify(planned.request.body)}
                </Typography>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  )
}

function PushDetails({ summary }: { summary: Extract<ActivityEntry, { action: 'push' }>['summary'] }) {
  return (
    <Stack spacing={1}>
      <Alert severity={summary.failed > 0 || summary.blocked.length > 0 ? 'warning' : 'success'}>
        {summary.blocked.length > 0
          ? `Push blocked by ${summary.blocked.length} validation error${summary.blocked.length === 1 ? '' : 's'}.`
          : `Pushed ${summary.synced} block${summary.synced === 1 ? '' : 's'}, failed ${summary.failed}, skipped ${summary.skipped} already-synced block${summary.skipped === 1 ? '' : 's'}.`}
      </Alert>
      <BlockedMessages messages={summary.blocked} />
      {summary.results.length > 0 && (
        <Stack spacing={0.75}>
          {summary.results.map((result) => (
            <Typography key={result.blockId} variant="caption" sx={{ color: result.ok ? 'success.main' : 'warning.main' }}>
              {result.ticketId}: {result.ok ? `synced as worklog ${result.tempoWorklogId}` : result.error ?? 'failed'}
            </Typography>
          ))}
        </Stack>
      )}
    </Stack>
  )
}

function LogEntryCard({ entry }: { entry: ActivityEntry }) {
  const status = entryStatus(entry)
  const descriptor = describeActivityEntry(entry)
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            {entry.category === 'tempo' ? (
              <>
                <Chip size="small" label={entry.action === 'dry-run' ? 'Dry run' : 'Push'} variant="outlined" />
                <Typography variant="subtitle2">{prettyDate(entry.targetDate)}</Typography>
              </>
            ) : (
              <>
                <Chip size="small" label={NOTEBOOK_SOURCE_LABELS[entry.source]} variant="outlined" />
                <Typography variant="subtitle2">{descriptor.title}</Typography>
              </>
            )}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip size="small" color={status.color} label={status.label} />
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_FONT }}>
              {dayjs(entry.timestamp).format('HH:mm:ss')}
            </Typography>
          </Stack>
        </Stack>
        <Divider />
        {entry.category === 'notebook' ? (
          <Alert severity="error">{entry.message}</Alert>
        ) : entry.status === 'failed' ? (
          <Alert severity="error">{descriptor.detail}</Alert>
        ) : entry.action === 'dry-run' ? (
          <DryRunDetails summary={entry.summary} />
        ) : (
          <PushDetails summary={entry.summary} />
        )}
      </Stack>
    </Paper>
  )
}

// Session-only activity log: every Tempo dry run / push and notebook error
// since the app was opened, newest first.
export function ActivityLogPage({ entries, onClose }: Props) {
  return (
    <>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
        <IconButton type="button" onClick={onClose} title="Back to timesheet" aria-label="Back to timesheet">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Box>
          <Typography variant="h5" component="h2">
            Activity Log
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tempo dry runs, pushes, and notebook errors from this session - newest first.
          </Typography>
        </Box>
      </Stack>

      {entries.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Nothing logged yet. Dry runs, pushes, and errors will appear here as they happen.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {entries.map((entry) => (
            <LogEntryCard key={entry.id} entry={entry} />
          ))}
        </Stack>
      )}
    </>
  )
}
