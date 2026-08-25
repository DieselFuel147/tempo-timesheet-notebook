import { memo, useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import AssistantIcon from '@mui/icons-material/Assistant'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import {
  alpha,
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
import { autoSummary, isLunchBlock, isPersistedNotebookBlock } from '@shared/notebook'
import type { ValidationIssue } from '@shared/validation'
import {
  complete12hDraftMinutes,
  EMPTY_TIME_12H_DRAFT,
  format12hDraft,
  formatHours,
  minutesTo12hTime,
  minutesToHHmm,
  parse12hDraftInput,
  parseDuration,
  type Time12hDraft,
} from '@app/dateutil'
import { assignBlockColors } from '@app/features/notebook/blockColors'
import { blockSyncLabel } from '@app/features/sync/syncStatus'
import { LINK_PULSE_MS } from '@app/features/linking/blockLink'
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
  nowMinute: number
  onTimeChange: (edge: 'start' | 'end', value: string) => void
  onDurationChange: (value: string) => void
}

// Grey overlay text drawn over an empty time field: the live-clock hint while
// unfocused, or the blank scaffold while the field is being edited.
const TIME_FIELD_OVERLAY_SX = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  color: 'text.disabled',
  fontFamily: MONO_FONT,
  fontSize: 13,
} as const

// Compact, editable start–end times for retroactive entry, as masked "h:mm
// am/pm" text fields. The native time control was replaced because WebKit
// paints empty segments with real-looking digits that read as recorded times,
// offers no way to tell a typed digit from its own sample, and silently
// resets half-finished entries. Here the field only ever shows what was
// actually typed: a complete valid entry commits immediately (unlocking the
// end field), anything incomplete reverts on blur. The end is disabled until
// a start exists so the block never lands in an invalid state.
function NotebookTimeFields({ block, nowMinute, onTimeChange, onDurationChange }: NotebookTimeFieldsProps) {
  const startValue = block.startMinute === null ? '' : minutesTo12hTime(block.startMinute)
  const endValue = block.endMinute === null ? '' : minutesTo12hTime(block.endMinute)
  const durationMinutes = block.startMinute !== null && block.endMinute !== null
    ? Math.max(0, block.endMinute - block.startMinute)
    : null
  const displayDuration = durationMinutes !== null ? formatHours(durationMinutes) : ''
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  // In-progress drafts per edge while a field is focused; committed values in
  // `block` take back over on blur so abandoned drafts simply revert.
  const [drafts, setDrafts] = useState<{ start: Time12hDraft; end: Time12hDraft }>({
    start: EMPTY_TIME_12H_DRAFT,
    end: EMPTY_TIME_12H_DRAFT,
  })
  const [focusedEdge, setFocusedEdge] = useState<'start' | 'end' | null>(null)
  const liveClockLabel = minutesTo12hTime(nowMinute)
  const timeFieldSx = { width: 104, '& .MuiInputBase-root': { backgroundColor: 'background.paper' }, '& input': { fontFamily: MONO_FONT, fontSize: 13, py: 0.5, px: 0.5, textAlign: 'center', lineHeight: 1 } }
  const durationFieldSx = { width: 72, '& .MuiInputBase-root': { backgroundColor: 'background.paper' }, '& input': { fontFamily: MONO_FONT, fontSize: 13, py: 0.5, px: 0.5, textAlign: 'center', lineHeight: 1 } }

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

  const renderTimeField = (edge: 'start' | 'end', value: string, disabled: boolean) => {
    const isFocused = focusedEdge === edge
    const draft = drafts[edge]
    return (
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <TextField
          size="small"
          value={isFocused ? format12hDraft(draft) : value}
          onChange={(event) => {
            const nextDraft = parse12hDraftInput(event.target.value)
            setDrafts((prev) => ({ ...prev, [edge]: nextDraft }))
            // Committing mid-edit keeps the field usable without leaving it:
            // a complete entry unlocks the end field right away.
            const minutes = complete12hDraftMinutes(nextDraft)
            if (minutes !== null) onTimeChange(edge, minutesToHHmm(minutes))
          }}
          onFocus={() => {
            setFocusedEdge(edge)
            setDrafts((prev) => ({
              ...prev,
              // Reparsing the committed display seeds edits of existing times.
              [edge]: value === '' ? EMPTY_TIME_12H_DRAFT : parse12hDraftInput(value),
            }))
          }}
          onBlur={() => setFocusedEdge(null)}
          disabled={disabled}
          slotProps={{
            htmlInput: {
              'aria-label': edge === 'start' ? 'Start time' : 'End time',
              title: 'Type h:mm then A or P — e.g. "945p" for 9:45 pm',
              spellCheck: false,
              maxLength: 9,
            },
          }}
          sx={timeFieldSx}
        />
        {isFocused && draft.hour === '' && draft.minute === '' && (
          <Typography aria-hidden sx={TIME_FIELD_OVERLAY_SX}>
            {'--:-- --'}
          </Typography>
        )}
        {!isFocused && value === '' && (
          <Typography aria-hidden sx={TIME_FIELD_OVERLAY_SX}>
            {liveClockLabel}
          </Typography>
        )}
      </Box>
    )
  }

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
      {renderTimeField('start', startValue, false)}
      <Typography variant="caption" color="text.secondary">
        –
      </Typography>
      {renderTimeField('end', endValue, block.startMinute === null)}
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
  /** Current minute-of-day for the viewed day; drives the live time hints. */
  nowMinute: number
  /** Entry playing the attention pulse after a cross-panel jump. */
  pulseId: string | null
  /** Any click/focus inside a block card; App links it to the timeline. */
  onInteract: (id: string) => void
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
  nowMinute,
  pulseId,
  onInteract,
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

  // Any click or keyboard focus inside a block card reports that card as the
  // active entry so App can select it in the timeline. Capture phase so inputs
  // and buttons can't stop the event before it reaches us.
  const handleInteract = useCallback(
    (event: SyntheticEvent) => {
      const card = (event.target as HTMLElement).closest('[data-notebook-block-id]')
      const id = card?.getAttribute('data-notebook-block-id')
      if (id) onInteract(id)
    },
    [onInteract],
  )

  return (
    <Box onClickCapture={handleInteract} onFocusCapture={handleInteract}>
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
          // LUNCH keeps the fixed amber so it reads as non-work in both panels.
          const accent = isLunchBlock(block) ? theme.ledger.lunchBlock : blockColorMap.get(block.id) ?? null
          const isPulsing = pulseId === block.id

          return (
            <Paper
              key={block.id}
              variant="outlined"
              data-notebook-block-id={block.id}
              sx={{
                p: 1.25,
                borderColor: isReopenable ? 'warning.main' : 'divider',
                borderStyle: isReopenable ? 'dashed' : 'solid',
                borderLeft: accent && !isReopenable ? `3px solid ${accent}` : undefined,
                backgroundColor: theme.ledger.entryCardBg,
                // Attention pulse after a cross-panel jump; fades back to the
                // card's plain look when it finishes (nothing persists).
                ...(isPulsing && {
                  animation: `nb-link-pulse ${LINK_PULSE_MS}ms ease-out`,
                  '@keyframes nb-link-pulse': {
                    '0%': { boxShadow: `0 0 0 8px ${alpha(theme.palette.primary.main, 0.55)}` },
                    '100%': { boxShadow: '0 0 0 0 transparent' },
                  },
                }),
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
                  <NotebookTimeFields block={block} nowMinute={nowMinute} onTimeChange={(edge, value) => onTimeChange(block.id, edge, value)} onDurationChange={(value) => onDurationChange(block.id, value)} />
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
