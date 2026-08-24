import CloseIcon from '@mui/icons-material/Close'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Snackbar from '@mui/material/Snackbar'
import Typography from '@mui/material/Typography'
import { describeActivityEntry, type ActivityEntry } from './activityLog'

interface Props {
  entry: ActivityEntry | null
  onClose: () => void
  onOpenLog: () => void
}

// Transient confirmation for any logged event (Tempo dry-run / push outcome or
// a notebook error). Clicking it opens the activity log; the X just dismisses.
export function ActivityToast({ entry, onClose, onOpenLog }: Props) {
  const descriptor = entry ? describeActivityEntry(entry) : null
  return (
    <Snackbar
      key={entry?.id}
      open={entry !== null}
      autoHideDuration={6000}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {descriptor ? (
        <Alert
          severity={descriptor.severity}
          variant="filled"
          elevation={6}
          sx={{ cursor: 'pointer', alignItems: 'center' }}
          onClick={() => {
            onClose()
            onOpenLog()
          }}
          action={
            <IconButton
              size="small"
              color="inherit"
              aria-label="Dismiss notification"
              sx={{ alignSelf: 'flex-start', mt: -0.25 }}
              onClick={(event) => {
                event.stopPropagation()
                onClose()
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          }
        >
          <Box sx={{ minWidth: 260 }}>
            <Typography variant="subtitle2" component="div">
              {descriptor.title}
            </Typography>
            <Typography variant="caption" component="div" sx={{ display: 'block' }}>
              {descriptor.detail} — click to view the log
            </Typography>
          </Box>
        </Alert>
      ) : undefined}
    </Snackbar>
  )
}
