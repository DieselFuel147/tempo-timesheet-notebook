import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { Alert, Box, Collapse, IconButton, Paper, Stack, Typography } from '@mui/material'
import type { NotebookBlock } from '@shared/types'
import { notebookBlockSummary } from '@shared/notebook'
import type { PushState } from './syncStatus'
import { MONO_FONT } from '@app/theme'

interface Props {
  open: boolean
  onToggle: () => void
  errorCount: number
  pushableCount: number
  pushState: PushState
  /** Current day's blocks, used to label planned dry-run requests. */
  blocks: NotebookBlock[] | undefined
}

// Collapsible strip summarizing the last dry-run / push outcome.
export function TempoSyncSection({ open, onToggle, errorCount, pushableCount, pushState, blocks }: Props) {
  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack
        direction="row"
        spacing={1}
        onClick={onToggle}
        sx={{ px: { xs: 2, md: 3 }, py: 1, cursor: 'pointer', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2">Tempo sync</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Closed notebook blocks with valid tickets are the push candidates. Editing synced timing, ticket, or summary marks that block unsynced again.
          </Typography>
        </Box>
        <IconButton size="small" aria-label={open ? 'Collapse Tempo sync' : 'Expand Tempo sync'}>
          <ExpandMoreIcon
            fontSize="small"
            sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
          />
        </IconButton>
      </Stack>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <Box sx={{ px: { xs: 2, md: 3 }, pb: 2 }}>
          <Stack spacing={1.25}>
            {errorCount > 0 && (
              <Alert severity="error">Resolve validation errors before pushing notebook blocks to Tempo.</Alert>
            )}

            {pushableCount === 0 && (
              <Alert severity="info">No closed notebook blocks are ready for Tempo yet.</Alert>
            )}

            {pushState.mode === 'done' && 'dryRun' in pushState.summary && (
              <Stack spacing={1}>
                <Alert severity={pushState.summary.blocked.length > 0 ? 'error' : 'info'}>
                  {pushState.summary.blocked.length > 0
                    ? `Dry run blocked by ${pushState.summary.blocked.length} validation error${pushState.summary.blocked.length === 1 ? '' : 's'}.`
                    : `Dry run prepared ${pushState.summary.planned.length} worklog request${pushState.summary.planned.length === 1 ? '' : 's'} and would skip ${pushState.summary.skipped} already-synced block${pushState.summary.skipped === 1 ? '' : 's'}.`}
                </Alert>
                {pushState.summary.blocked.length > 0 && (
                  <Stack spacing={0.5}>
                    {pushState.summary.blocked.map((message, index) => (
                      <Typography key={`dry-blocked-${index}`} variant="caption" color="error.main">
                        {message}
                      </Typography>
                    ))}
                  </Stack>
                )}
                {pushState.summary.planned.length > 0 && (
                  <Stack spacing={1}>
                    {pushState.summary.planned.map((planned) => {
                      const matchingBlock = blocks?.find((block) => block.id === planned.blockId)
                      return (
                        <Paper key={planned.blockId} variant="outlined" sx={{ p: 1.25, bgcolor: 'background.default' }}>
                          <Stack spacing={0.5}>
                            <Typography variant="subtitle2">
                              {planned.ticketId} · {matchingBlock ? notebookBlockSummary(matchingBlock) : 'Notebook block'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_FONT }}>
                              POST {planned.request.url}
                            </Typography>
                            <Typography variant="caption" sx={{ fontFamily: MONO_FONT, wordBreak: 'break-all' }}>
                              {JSON.stringify(planned.request.body)}
                            </Typography>
                          </Stack>
                        </Paper>
                      )
                    })}
                  </Stack>
                )}
              </Stack>
            )}

            {pushState.mode === 'done' && !('dryRun' in pushState.summary) && (
              <Stack spacing={1}>
                <Alert severity={pushState.summary.failed > 0 || pushState.summary.blocked.length > 0 ? 'warning' : 'success'}>
                  {pushState.summary.blocked.length > 0
                    ? `Push blocked by ${pushState.summary.blocked.length} validation error${pushState.summary.blocked.length === 1 ? '' : 's'}.`
                    : `Pushed ${pushState.summary.synced} block${pushState.summary.synced === 1 ? '' : 's'}, failed ${pushState.summary.failed}, skipped ${pushState.summary.skipped} already-synced block${pushState.summary.skipped === 1 ? '' : 's'}.`}
                </Alert>
                {pushState.summary.blocked.length > 0 && (
                  <Stack spacing={0.5}>
                    {pushState.summary.blocked.map((message, index) => (
                      <Typography key={`push-blocked-${index}`} variant="caption" color="error.main">
                        {message}
                      </Typography>
                    ))}
                  </Stack>
                )}
                {pushState.summary.results.length > 0 && (
                  <Stack spacing={0.75}>
                    {pushState.summary.results.map((result) => (
                      <Typography key={result.blockId} variant="caption" sx={{ color: result.ok ? 'success.main' : 'warning.main' }}>
                        {result.ticketId}: {result.ok ? `synced as worklog ${result.tempoWorklogId}` : result.error ?? 'failed'}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>
        </Box>
      </Collapse>
    </Box>
  )
}
