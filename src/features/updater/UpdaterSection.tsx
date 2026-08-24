import { Alert, Box, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import type { AppUpdater } from './useAppUpdater'

interface Props {
  updater: AppUpdater
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function UpdaterSection({ updater }: Props) {
  const { phase } = updater

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
        Updates
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The app checks GitHub releases at launch and offers signed updates in place. Your data and
        credentials are untouched by an update.
      </Typography>

      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        {phase.kind === 'checking' && (
          <>
            <LinearProgress sx={{ width: '100%' }} />
            <Typography variant="body2" color="text.secondary">
              Checking for updates…
            </Typography>
          </>
        )}

        {phase.kind === 'idle' && (
          <Button type="button" variant="outlined" size="small" onClick={updater.checkForUpdate}>
            Check for updates
          </Button>
        )}

        {phase.kind === 'upToDate' && (
          <>
            <Alert severity="success" sx={{ width: '100%' }}>
              You're on the latest version.
            </Alert>
            <Button type="button" variant="outlined" size="small" onClick={updater.checkForUpdate}>
              Check again
            </Button>
          </>
        )}

        {phase.kind === 'available' && (
          <>
            <Alert severity="info" sx={{ width: '100%' }}>
              Version {phase.update.version} is available. Current version is {__APP_VERSION__}.
            </Alert>
            {phase.update.notes && (
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                {phase.update.notes}
              </Typography>
            )}
            <Button type="button" variant="contained" size="small" onClick={() => void updater.install()}>
              Download &amp; install
            </Button>
          </>
        )}

        {phase.kind === 'downloading' && (
          <>
            <Box sx={{ width: '100%' }}>
              <LinearProgress
                variant={phase.totalBytes ? 'determinate' : 'indeterminate'}
                value={phase.totalBytes ? Math.min(100, (phase.receivedBytes / phase.totalBytes) * 100) : undefined}
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              Downloading update…{' '}
              {phase.totalBytes
                ? `${formatBytes(phase.receivedBytes)} of ${formatBytes(phase.totalBytes)}`
                : formatBytes(phase.receivedBytes)}
            </Typography>
          </>
        )}

        {phase.kind === 'ready' && (
          <>
            <Alert severity="success" sx={{ width: '100%' }}>
              Version {phase.version} installed. Restart to finish updating.
            </Alert>
            <Button type="button" variant="contained" size="small" onClick={() => void updater.restartToUpdate()}>
              Restart app
            </Button>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <Alert severity="error" sx={{ width: '100%' }}>
              Update check failed: {phase.message}
            </Alert>
            <Button type="button" variant="outlined" size="small" onClick={updater.checkForUpdate}>
              Try again
            </Button>
          </>
        )}
      </Stack>
    </Paper>
  )
}
