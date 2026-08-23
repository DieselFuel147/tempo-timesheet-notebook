import { useEffect, useState } from 'react'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { TruncatedSummaryEntry } from '@shared/notebook'
import { minutesToHHmm } from '@app/dateutil'

interface Props {
  open: boolean
  entries: TruncatedSummaryEntry[]
  confirmedIds: ReadonlySet<string>
  pushing: boolean
  onConfirm: (blockId: string) => void
  /** Saves a non-empty edited summary as the entry's Time Entry Summary override. */
  onEditOverride: (blockId: string, value: string) => void
  onCancel: () => void
  onPush: () => void
}

// Shown before a push when one or more entries would upload an auto-truncated
// summary. The push itself is blocked until every row is either confirmed
// as-is or given an explicit override via the inline edit.
export function SummaryTruncationDialog({
  open,
  entries,
  confirmedIds,
  pushing,
  onConfirm,
  onEditOverride,
  onCancel,
  onPush,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  // Fresh rows (and drafts) for each gate; keeps the dialog stateless across pushes.
  useEffect(() => {
    if (open) setDrafts({})
  }, [open, entries])

  const allConfirmed = entries.length > 0 && entries.every((entry) => confirmedIds.has(entry.blockId))

  function handleSaveEdit(entry: TruncatedSummaryEntry) {
    const draft = (drafts[entry.blockId] ?? '').trim()
    if (!draft) return
    onEditOverride(entry.blockId, draft)
    onConfirm(entry.blockId)
  }

  // Accepting the truncated summary discards any unsaved draft so the
  // confirmed state never claims an edit that was not applied.
  function handleConfirmTruncated(entry: TruncatedSummaryEntry) {
    setDrafts((current) => ({ ...current, [entry.blockId]: '' }))
    onConfirm(entry.blockId)
  }

  return (
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (reason !== 'backdropClick') onCancel()
      }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle component="div">
        <Typography variant="h6" component="h2">
          Truncated summaries need confirmation
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {entries.length} worklog summar{entries.length === 1 ? 'y is' : 'ies are'} longer than the configured limit and{' '}
          {entries.length === 1 ? 'will be' : 'would be'} uploaded shortened. Confirm each summary, or replace it with
          your own before pushing.
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {entries.map((entry) => {
          const confirmed = confirmedIds.has(entry.blockId)
          const draft = drafts[entry.blockId] ?? ''
          const trimmedDraft = draft.trim()
          const editDiffers = trimmedDraft.length > 0 && trimmedDraft !== entry.truncated

          return (
            <Paper key={entry.blockId} variant="outlined" sx={{ p: 1.5 }}>
              <Stack spacing={1.25}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'warning.main' }}>
                  Warning: worklog summary for {entry.ticketId || '(no ticket)'} -{' '}
                  {minutesToHHmm(entry.startMinute)} has been truncated, please confirm summary
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      Original notes ({entry.original.length} characters)
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1,
                        maxHeight: 120,
                        overflowY: 'auto',
                        bgcolor: 'background.default',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: 13,
                      }}
                    >
                      {entry.original}
                    </Paper>
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      Will upload as ({entry.truncated.length} characters)
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1,
                        maxHeight: 120,
                        overflowY: 'auto',
                        bgcolor: 'background.default',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: 13,
                      }}
                    >
                      <Box component="span" sx={{ color: confirmed ? 'text.primary' : 'warning.main' }}>
                        {confirmed && trimmedDraft && editDiffers ? trimmedDraft : entry.truncated}
                      </Box>
                    </Paper>
                  </Box>
                </Stack>

                {confirmed ? (
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    icon={<CheckCircleIcon />}
                    label={editDiffers ? 'Confirmed with your edited summary' : 'Confirmed — upload truncated'}
                  />
                ) : (
                  <>
                    <TextField
                      label="Replace with your own summary (optional)"
                      value={draft}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [entry.blockId]: event.target.value }))
                      }
                      placeholder={entry.truncated}
                      fullWidth
                      size="small"
                      helperText="Saved as this entry's Time Entry Summary."
                    />
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      {editDiffers && (
                        <Button variant="contained" size="small" onClick={() => handleSaveEdit(entry)}>
                          Save &amp; confirm
                        </Button>
                      )}
                      <Button variant="outlined" size="small" onClick={() => handleConfirmTruncated(entry)}>
                        Confirm truncated summary
                      </Button>
                    </Stack>
                  </>
                )}
              </Stack>
            </Paper>
          )
        })}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {!allConfirmed &&
            `${entries.length - confirmedIds.size} entr${
              entries.length - confirmedIds.size === 1 ? 'y' : 'ies'
            } left to confirm.`}
        </Typography>
        <Button onClick={onCancel} disabled={pushing}>
          Cancel
        </Button>
        <Button onClick={onPush} variant="contained" disabled={!allConfirmed || pushing}>
          {pushing ? 'Pushing…' : 'Push'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
