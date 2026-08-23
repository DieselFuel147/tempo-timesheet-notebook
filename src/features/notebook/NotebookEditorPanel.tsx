import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import AssistantIcon from '@mui/icons-material/Assistant'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  InputBase,
  Paper,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import type { NotebookBlock } from '@shared/types'
import { autoSummary, isPersistedNotebookBlock } from '@shared/notebook'
import type { ValidationIssue } from '@shared/validation'
import { formatHours, minutesToHHmm, parseDuration } from '@app/dateutil'
import { assignBlockColors } from '@app/features/notebook/blockColors'
import { blockSyncLabel } from '@app/features/sync/syncStatus'
import { TicketField } from '@app/features/notebook/TicketField'
import { MONO_FONT } from '@app/theme'

interface NotebookTicketFieldProps {
  block: NotebookBlock
  invalid: boolean
  adminTicket: string
  onTicketChange: (ticketId: string) => void
}

function NotebookTicketField({ block, invalid, adminTicket, onTicketChange }: NotebookTicketFieldProps) {
  return (
    <Box sx={{ '& .MuiAutocomplete-root': { width: '100%' }, '& .MuiTextField-root': { width: '100%' } }}>
      <TicketField
        value={block.ticketId}
        invalid={invalid}
        adminTicket={adminTicket}
        onChange={onTicketChange}
        onAdmin={() => onTicketChange(adminTicket)}
      />
    </Box>
  )
}

interface NotebookTimeFieldsProps {
  block: NotebookBlock
  onTimeChange: (edge: 'start' | 'end', value: string) => void
  onDurationChange: (value: string) => void
}

// Compact, editable start–end times for retroactive entry. Native "HH:mm"
// inputs map straight onto the block's minutes-from-midnight model; the end is
// disabled until a start exists so the block never lands in an invalid state.
function NotebookTimeFields({ block, onTimeChange, onDurationChange }: NotebookTimeFieldsProps) {
  const startValue = block.startMinute === null ? '' : minutesToHHmm(block.startMinute)
  const endValue = block.endMinute === null ? '' : minutesToHHmm(block.endMinute)
  const durationMinutes = block.startMinute !== null && block.endMinute !== null
    ? Math.max(0, block.endMinute - block.startMinute)
    : null
  const displayDuration = durationMinutes !== null ? formatHours(durationMinutes) : ''
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const timeFieldSx = { width: 104, '& input': { fontFamily: MONO_FONT, fontSize: 13, py: 0.5, px: 0.5, textAlign: 'center', lineHeight: 1 } }
  const durationFieldSx = { width: 72, '& input': { fontFamily: MONO_FONT, fontSize: 13, py: 0.5, px: 0.5, textAlign: 'center', lineHeight: 1 } }

  useEffect(() => {
    setEditValue(displayDuration)
  }, [block.id, displayDuration])

  const handleDurationBlur = useCallback(() => {
    const parsed = parseDuration(editValue)
    if (parsed !== null && parsed > 0) {
      onDurationChange(editValue)
    }
    setIsEditing(false)
  }, [editValue, block.id, onDurationChange])

  const handleDurationFocus = useCallback(() => {
    setIsEditing(true)
    setEditValue(displayDuration)
  }, [displayDuration])

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
      <TextField
        size="small"
        type="time"
        value={startValue}
        onChange={(event) => onTimeChange('start', event.target.value)}
        slotProps={{ htmlInput: { 'aria-label': 'Start time' } }}
        sx={timeFieldSx}
      />
      <Typography variant="caption" color="text.secondary">
        –
      </Typography>
      <TextField
        size="small"
        type="time"
        value={endValue}
        onChange={(event) => onTimeChange('end', event.target.value)}
        disabled={block.startMinute === null}
        slotProps={{ htmlInput: { 'aria-label': 'End time' } }}
        sx={timeFieldSx}
      />
      <TextField
        size="small"
        value={isEditing ? editValue : displayDuration}
        placeholder="0m"
        onChange={(event) => setEditValue(event.target.value)}
        onBlur={isEditing ? handleDurationBlur : undefined}
        onFocus={handleDurationFocus}
        disabled={block.startMinute === null}
        slotProps={{ htmlInput: { 'aria-label': 'Duration' } }}
        sx={durationFieldSx}
      />
    </Stack>
  )
}

export interface NotebookEditorPanelProps {
  blocks: NotebookBlock[]
  adminTicket: string
  issuesByBlock: Map<string, ValidationIssue[]>
  maxSummaryChars: number
  onTextChange: (id: string, value: string, eventTarget?: HTMLTextAreaElement | null) => void
  onTicketChange: (id: string, ticketId: string) => void
  onTimeChange: (id: string, edge: 'start' | 'end', value: string) => void
  onDurationChange: (id: string, value: string) => void
  onSummaryChange: (id: string, value: string) => void
  onSuggest: (id: string) => void
  onCloseLiveBlock: (id: string) => void
  suggestingId: string | null
  onDeleteBlock: (id: string) => void
  activeReopenableId: string | null
  getTextAreaRef: (id: string) => (element: HTMLTextAreaElement | null) => void
}

export const NotebookEditorPanel = memo(function NotebookEditorPanel({
  blocks,
  adminTicket,
  issuesByBlock,
  maxSummaryChars,
  onTextChange,
  onTicketChange,
  onTimeChange,
  onDurationChange,
  onSummaryChange,
  onSuggest,
  onCloseLiveBlock,
  suggestingId,
  onDeleteBlock,
  activeReopenableId,
  getTextAreaRef,
}: NotebookEditorPanelProps) {
  const theme = useTheme()
  const activeStartedId = blocks.findLast((block) => block.startMinute !== null && !block.closed)?.id ?? null
  const blockColorMap = useMemo(() => assignBlockColors(blocks, theme.blockColors), [blocks, theme.blockColors])

  return (
    <Box>
      {blocks.length === 1 && !isPersistedNotebookBlock(blocks[0]) && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Start typing below. The first keystroke opens the first notebook block.
        </Typography>
      )}

      <Stack spacing={1.25}>
        {blocks.map((block) => {
          const issues = issuesByBlock.get(block.id) ?? []
          const ticketInvalid = issues.some((issue) => issue.code === 'INVALID_TICKET' && issue.level === 'error')
          const isBlank = !isPersistedNotebookBlock(block)
          const isReopenable = block.id === activeReopenableId
          const isLive = block.id === activeStartedId
          const syncChip = blockSyncLabel(block)
          const accent = blockColorMap.get(block.id) ?? null

          return (
            <Paper
              key={block.id}
              variant="outlined"
              sx={{
                p: 1.25,
                borderColor: isReopenable ? 'warning.main' : 'divider',
                borderStyle: isReopenable ? 'dashed' : 'solid',
                borderLeft: accent && !isReopenable ? `3px solid ${accent}` : undefined,
                backgroundColor: isBlank ? 'transparent' : 'background.paper',
              }}
            >
              <Stack spacing={1}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  useFlexGap
                  sx={{ alignItems: { xs: 'stretch', sm: 'center' }, flexWrap: 'wrap', justifyContent: 'space-between' }}
                >
                  <Box sx={{ flex: '1 1 200px', minWidth: 140, maxWidth: { sm: 260 } }}>
                    <NotebookTicketField
                      block={block}
                      invalid={ticketInvalid}
                      adminTicket={adminTicket}
                      onTicketChange={(ticketId) => onTicketChange(block.id, ticketId)}
                    />
                  </Box>
                  <NotebookTimeFields block={block} onTimeChange={(edge, value) => onTimeChange(block.id, edge, value)} onDurationChange={(value) => onDurationChange(block.id, value)} />
                  {block.startMinute !== null && block.endMinute !== null && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_FONT, whiteSpace: 'nowrap' }}>
                      {formatHours(block.endMinute - block.startMinute)}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Chip
                      size="small"
                      color={isLive ? 'primary' : isReopenable ? 'warning' : 'default'}
                      label={
                        block.startMinute === null
                          ? 'waiting to start'
                          : block.closed
                            ? 'closed'
                            : 'logging now'
                        }
                      // Live entries close on pill click, stamping the end at the current minute.
                      onClick={isLive ? () => onCloseLiveBlock(block.id) : undefined}
                      title={
                        isLive
                          ? 'Stop logging: close this entry at the current time (text stays editable)'
                          : undefined
                      }
                      sx={isLive ? { cursor: 'pointer' } : undefined}
                    />
                    {syncChip && <Chip size="small" color={syncChip.color} variant="outlined" label={syncChip.label} />}
                  </Stack>
                </Stack>

                <InputBase
                  inputRef={getTextAreaRef(block.id)}
                  value={block.text}
                  placeholder={
                    isBlank
                      ? 'Type a note…'
                      : isReopenable
                        ? 'Continue this note or add more detail…'
                        : 'Add more detail…'
                  }
                  onChange={(event) =>
                    onTextChange(
                      block.id,
                      event.target.value,
                      event.target instanceof HTMLTextAreaElement ? event.target : null,
                    )
                  }
                  fullWidth
                  multiline
                  minRows={2}
                  sx={{
                    alignItems: 'flex-start',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    px: 1,
                    py: 0.75,
                    fontSize: '15px',
                    lineHeight: 1.6,
                    backgroundColor: 'background.paper',
                    '& textarea': {
                      resize: 'none',
                    },
                  }}
                />

                {!isBlank && (
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                      Time Entry Summary
                    </Typography>
                    <InputBase
                      value={block.summaryOverride ?? ''}
                      placeholder={autoSummary(block.text, maxSummaryChars)}
                      onChange={(event) => onSummaryChange(block.id, event.target.value)}
                      fullWidth
                      sx={{
                        flex: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        px: 1,
                        py: 0.5,
                        fontSize: 13,
                        backgroundColor: 'background.paper',
                      }}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        startIcon={
                          suggestingId === block.id ? <CircularProgress size={14} /> : <AssistantIcon />
                        }
                        disabled={suggestingId !== null || block.text.trim().length === 0}
                        onClick={() => onSuggest(block.id)}
                        title={
                          block.text.trim().length === 0
                            ? 'Add notes first'
                            : 'Summarize these notes with the local AI model'
                        }
                      >
                        {suggestingId === block.id ? 'Suggesting…' : 'Suggest'}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteOutlineIcon />}
                        onClick={() => onDeleteBlock(block.id)}
                      >
                        Delete
                      </Button>
                    </Stack>
                  </Stack>
                )}

                {issues.length > 0 && (
                  <Stack spacing={0.5}>
                    {issues.map((issue, index) => (
                      <Typography
                        key={`${block.id}-${issue.code}-${index}`}
                        variant="caption"
                        sx={{ color: issue.level === 'error' ? 'error.main' : 'warning.main' }}
                      >
                        {issue.message}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Paper>
          )
        })}
      </Stack>
    </Box>
  )
})
