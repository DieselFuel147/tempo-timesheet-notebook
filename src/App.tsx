import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import SettingsIcon from '@mui/icons-material/Settings'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import TodayIcon from '@mui/icons-material/Today'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import EditIcon from '@mui/icons-material/Edit'
import CheckIcon from '@mui/icons-material/Check'
import UndoIcon from '@mui/icons-material/Undo'
import LinkIcon from '@mui/icons-material/Link'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import UploadIcon from '@mui/icons-material/Upload'
import SyncIcon from '@mui/icons-material/Sync'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { DryRunSummary, JiraProfile, NotebookBlock, NotebookDay, PushSummary } from '../shared/types'
import { defaultSettings, type Settings as AppSettings } from '../shared/settings'
import { isPersistedNotebookBlock, notebookBlockSummary } from '../shared/notebook'
import { validateNotebookDay, type ValidationIssue } from '../shared/validation'
import { api } from './api'
import { addDays, formatHours, prettyDate, todayISO } from './dateutil'
import { Settings } from './Settings'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Collapse,
  CssBaseline,
  IconButton,
  InputBase,
  Paper,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography,
  useTheme,
} from '@mui/material'
import { MONO_FONT } from './theme'
import { useAppTheme } from './useAppTheme'
import { TicketField } from './TicketField'

const IDLE_THRESHOLD_MS = 3 * 60 * 1000
const TIMELINE_REFRESH_MS = 1000
const PX_PER_MINUTE = 2
const MIN_BLOCK_HEIGHT = 42
const MIN_BLOCK_DURATION_MINUTES = 1
const DEBUG_TIME_SCALE = Number(import.meta.env.VITE_NOTEBOOK_TIME_SCALE ?? '1')

// Chronological color assignment with shared-ticket grouping: blocks sharing a
// non-empty ticket ID adopt the earliest color assigned to that ticket; every
// other persisted block cycles through the palette. Used by both the editor
// left-borders and the ruler so a ticket keeps one color across both surfaces.
function assignBlockColors(blocks: NotebookBlock[], palette: string[]): Map<string, string> {
  const byBlock = new Map<string, string>()
  const byTicket = new Map<string, string>()
  let next = 0
  for (const block of blocks) {
    if (!isPersistedBlock(block)) continue
    const ticketId = block.ticketId.trim()
    let color: string
    if (ticketId) {
      if (!byTicket.has(ticketId)) {
        byTicket.set(ticketId, palette[next % palette.length])
        next += 1
      }
      color = byTicket.get(ticketId) as string
    } else {
      color = palette[next % palette.length]
      next += 1
    }
    byBlock.set(block.id, color)
  }
  return byBlock
}

type PushState =
  | { mode: 'idle' }
  | { mode: 'running'; action: 'dry-run' | 'push' }
  | { mode: 'done'; action: 'dry-run' | 'push'; summary: DryRunSummary | PushSummary }

interface DayTimeAnchor {
  date: string
  wallClockStartMs: number
  minuteBase: number
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    validation: { ...settings.validation },
    connections: {
      jira: { ...settings.connections.jira },
      tempo: { ...settings.connections.tempo },
    },
  }
}

function createBlankBlock(date: string): NotebookBlock {
  return {
    id: crypto.randomUUID(),
    date,
    startMinute: null,
    endMinute: null,
    text: '',
    closed: false,
    ticketId: '',
    summaryOverride: null,
    tempoWorklogId: null,
    syncedAt: null,
  }
}

function cloneBlock(block: NotebookBlock): NotebookBlock {
  return {
    ...block,
    summaryOverride: block.summaryOverride ?? null,
    tempoWorklogId: block.tempoWorklogId ?? null,
    syncedAt: block.syncedAt ?? null,
  }
}

function markBlockDirty(block: NotebookBlock): NotebookBlock {
  return {
    ...block,
    tempoWorklogId: null,
    syncedAt: null,
  }
}

function blockHasPushRelevantChanges(previous: NotebookBlock, next: NotebookBlock): boolean {
  return (
    previous.startMinute !== next.startMinute ||
    previous.endMinute !== next.endMinute ||
    previous.closed !== next.closed ||
    previous.ticketId !== next.ticketId ||
    notebookBlockSummary(previous) !== notebookBlockSummary(next)
  )
}

function normalizeNotebookDay(day: NotebookDay): NotebookDay {
  const clonedBlocks = day.blocks.map(cloneBlock)
  const blocks = clonedBlocks.length > 0 ? clonedBlocks : [createBlankBlock(day.date)]
  const last = blocks[blocks.length - 1]
  const needsTrailingBlank =
    last.startMinute !== null || last.text.trim().length > 0 || last.ticketId.trim().length > 0

  return {
    date: day.date,
    blocks: needsTrailingBlank ? [...blocks, createBlankBlock(day.date)] : blocks,
  }
}

function persistedNotebookDay(day: NotebookDay): NotebookDay {
  return {
    date: day.date,
    blocks: day.blocks
      .filter((block) => block.startMinute !== null || block.text.trim().length > 0 || block.ticketId.trim().length > 0)
      .map(cloneBlock),
  }
}

function wallClockMinuteForDate(date: string): number {
  const now = new Date()
  const today = todayISO()
  if (date !== today) return 17 * 60
  return now.getHours() * 60 + now.getMinutes()
}

function effectiveIdleThresholdMs(): number {
  return IDLE_THRESHOLD_MS / Math.max(DEBUG_TIME_SCALE, 0.0001)
}

function blockDuration(block: NotebookBlock, nowMinute: number): number | null {
  if (block.startMinute === null) return null
  const endMinute = block.closed ? block.endMinute : nowMinute
  if (endMinute === null) return null
  return Math.max(0, endMinute - block.startMinute)
}

interface TimedBlockInfo {
  block: NotebookBlock
  index: number
  startMinute: number
  endMinute: number
}

function getTimedBlocks(blocks: NotebookBlock[], nowMinute: number): TimedBlockInfo[] {
  return blocks
    .map((block, index) => {
      if (block.startMinute === null) return null
      return {
        block,
        index,
        startMinute: block.startMinute,
        endMinute: block.closed ? block.endMinute ?? block.startMinute : nowMinute,
      }
    })
    .filter((item): item is TimedBlockInfo => item !== null)
    .sort((left, right) => left.startMinute - right.startMinute)
}

function isPersistedBlock(block: NotebookBlock): boolean {
  return block.startMinute !== null || block.text.trim().length > 0 || block.ticketId.trim().length > 0
}

function isPushableBlock(block: NotebookBlock): boolean {
  return block.closed && block.startMinute !== null && block.endMinute !== null && notebookBlockSummary(block).trim().length > 0
}

function blockSyncLabel(block: NotebookBlock): { label: string; color: 'default' | 'success' | 'warning' } | null {
  if (!isPersistedNotebookBlock(block) || !isPushableBlock(block)) return null
  if (block.tempoWorklogId) return { label: 'synced to Tempo', color: 'success' }
  return { label: 'ready to sync', color: 'warning' }
}

function buildLegacyProfileLabel(profile: JiraProfile | null): string {
  return profile ? `${profile.displayName} · ${profile.timeZone}` : 'not connected to Jira'
}

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

interface NotebookEditorPanelProps {
  blocks: NotebookBlock[]
  adminTicket: string
  issuesByBlock: Map<string, ValidationIssue[]>
  onTextChange: (id: string, value: string, eventTarget?: HTMLTextAreaElement | null) => void
  onTicketChange: (id: string, ticketId: string) => void
  onSelectSummaryEdit: (id: string) => void
  onDeleteBlock: (id: string) => void
  activeReopenableId: string | null
  getTextAreaRef: (id: string) => (element: HTMLTextAreaElement | null) => void
}

const NotebookEditorPanel = memo(function NotebookEditorPanel({
  blocks,
  adminTicket,
  issuesByBlock,
  onTextChange,
  onTicketChange,
  onSelectSummaryEdit,
  onDeleteBlock,
  activeReopenableId,
  getTextAreaRef,
}: NotebookEditorPanelProps) {
  const theme = useTheme()
  const activeStartedId = blocks.findLast((block) => block.startMinute !== null && !block.closed)?.id ?? null
  const blockColorMap = useMemo(() => assignBlockColors(blocks, theme.blockColors), [blocks, theme.blockColors])

  return (
    <Box>
      {blocks.length === 1 && !isPersistedBlock(blocks[0]) && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Start typing below. The first keystroke opens the first notebook block.
        </Typography>
      )}

      <Stack spacing={1.25}>
        {blocks.map((block) => {
          const issues = issuesByBlock.get(block.id) ?? []
          const ticketInvalid = issues.some((issue) => issue.code === 'INVALID_TICKET' && issue.level === 'error')
          const isBlank = !isPersistedBlock(block)
          const isReopenable = block.id === activeReopenableId
          const isLive = block.id === activeStartedId
          const summary = notebookBlockSummary(block)
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
                  sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <NotebookTicketField
                      block={block}
                      invalid={ticketInvalid}
                      adminTicket={adminTicket}
                      onTicketChange={(ticketId) => onTicketChange(block.id, ticketId)}
                    />
                  </Box>
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
                    />
                    {syncChip && <Chip size="small" color={syncChip.color} variant="outlined" label={syncChip.label} />}
                    {isReopenable && (
                      <Chip size="small" icon={<UndoIcon />} label="tap to continue" variant="outlined" />
                    )}
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

                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Summary: {summary}
                  </Typography>
                  {!isBlank && (
                    <Stack direction="row" spacing={1}>
                      <Button size="small" startIcon={<EditIcon />} onClick={() => onSelectSummaryEdit(block.id)}>
                        Edit summary
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
                  )}
                </Stack>

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

interface TimelinePanelProps {
  blocks: NotebookBlock[]
  nowMinute: number
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onSelectSummaryEdit: (id: string) => void
  onAbsorbGap: (id: string, direction: 'up' | 'down') => void
  onMerge: (id: string, direction: 'prev' | 'next') => void
  onPinPointerDown: (id: string, edge: 'start' | 'end', event: ReactPointerEvent<HTMLDivElement>) => void
}

function TimelinePanel({
  blocks,
  nowMinute,
  expandedId,
  onToggleExpand,
  onSelectSummaryEdit,
  onAbsorbGap,
  onMerge,
  onPinPointerDown,
}: TimelinePanelProps) {
  const theme = useTheme()
  const palette = theme.blockColors
  const ticketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const block of blocks) {
      if (block.startMinute === null) continue
      const ticketId = block.ticketId.trim()
      if (!ticketId) continue
      counts.set(ticketId, (counts.get(ticketId) ?? 0) + 1)
    }
    return counts
  }, [blocks])

  const ticketColors = useMemo(() => {
    const colors = new Map<string, string>()
    let nextColor = 0
    for (const block of blocks) {
      if (block.startMinute === null) continue
      const ticketId = block.ticketId.trim()
      if (!ticketId) continue
      if (!colors.has(ticketId)) {
        colors.set(ticketId, palette[nextColor % palette.length])
        nextColor += 1
      }
    }
    return colors
  }, [blocks, palette])

  const timedBlocks = useMemo(() => getTimedBlocks(blocks, nowMinute), [blocks, nowMinute])
  const minVisibleMinute = useMemo(() => {
    const firstMinute = timedBlocks.length > 0 ? Math.min(...timedBlocks.map((block) => block.startMinute), nowMinute) : nowMinute
    return Math.max(0, Math.floor((firstMinute - 30) / 60) * 60)
  }, [nowMinute, timedBlocks])

  const maxMinute = Math.max(nowMinute, ...timedBlocks.map((block) => block.endMinute), minVisibleMinute + 120)
  const timelineHeight = Math.max(320, (maxMinute - minVisibleMinute) * PX_PER_MINUTE + 64)

  const ticketPositions = useMemo(() => {
    const positions = new Map<string, Array<{ top: number; bottom: number; color: string }>>()
    for (const timedBlock of timedBlocks) {
      const ticketId = timedBlock.block.ticketId.trim()
      if (!ticketId) continue
      const color = ticketColors.get(ticketId) ?? palette[0]
      const top = (timedBlock.startMinute - minVisibleMinute) * PX_PER_MINUTE + 16
      const bottom = (timedBlock.endMinute - minVisibleMinute) * PX_PER_MINUTE + 16
      const list = positions.get(ticketId) ?? []
      list.push({ top, bottom, color })
      positions.set(ticketId, list)
    }
    return positions
  }, [minVisibleMinute, ticketColors, timedBlocks])

  const connectors = useMemo(() => {
    const items: Array<{ id: string; top: number; height: number; color: string }> = []
    ticketPositions.forEach((positions, ticketId) => {
      for (let index = 0; index < positions.length - 1; index += 1) {
        const current = positions[index]
        const next = positions[index + 1]
        const height = Math.max(0, next.top - current.bottom)
        if (height <= 0) continue
        items.push({
          id: `${ticketId}-${index}`,
          top: current.bottom,
          height,
          color: current.color,
        })
      }
    })
    return items
  }, [ticketPositions])

  return (
    <Box sx={{ position: 'relative', minHeight: timelineHeight, pr: 1, pl: 5, py: 2 }}>
      {Array.from({ length: Math.ceil((maxMinute - minVisibleMinute) / 60) + 2 }).map((_, hourIndex) => {
        const minute = minVisibleMinute + hourIndex * 60
        if (minute > maxMinute + 60) return null
        return (
          <Box key={minute} sx={{ position: 'absolute', insetInline: 0, top: (minute - minVisibleMinute) * PX_PER_MINUTE + 16 }}>
            <Typography
              variant="caption"
              sx={{ position: 'absolute', left: -40, top: -8, color: 'text.secondary', fontFamily: MONO_FONT, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
            >
              {`${String(Math.floor(minute / 60)).padStart(2, '0')}:00`}
            </Typography>
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />
          </Box>
        )
      })}

      {connectors.map((connector) => (
        <Box
          key={connector.id}
          sx={{
            position: 'absolute',
            top: connector.top,
            left: 20,
            height: connector.height,
            borderLeft: `2px dashed ${connector.color}`,
            opacity: 0.55,
          }}
        />
      ))}

      {timedBlocks.map((timedBlock, index) => {
        const { block } = timedBlock
        const startMinute = timedBlock.startMinute
        const endMinute = timedBlock.endMinute
        const duration = Math.max(1, endMinute - startMinute)
        const height = Math.max(MIN_BLOCK_HEIGHT, duration * PX_PER_MINUTE)
        const top = (startMinute - minVisibleMinute) * PX_PER_MINUTE + 16
        const ticketId = block.ticketId.trim()
        const color = ticketId ? ticketColors.get(ticketId) ?? palette[index % palette.length] : palette[index % palette.length]
        const ticketCount = ticketId ? ticketCounts.get(ticketId) ?? 0 : 0
        const summary = notebookBlockSummary(block)
        const expanded = expandedId === block.id
        const previous = timedBlocks[index - 1]
        const next = timedBlocks[index + 1]
        const gapAbove = previous ? Math.max(0, startMinute - previous.endMinute) : 0
        const gapBelow = next ? Math.max(0, next.startMinute - endMinute) : 0
        const showAbsorbUp = expanded && block.closed && gapAbove > 0
        const showAbsorbDown = expanded && block.closed && gapBelow > 0
        const canMergePrev = expanded && block.closed && !!previous?.block.closed
        const canMergeNext = expanded && block.closed && !!next?.block.closed

        return (
          <Box key={block.id} sx={{ position: 'absolute', top, left: 16, right: 0 }}>
            {gapAbove > 0 && (
              <Box
                sx={{
                  position: 'absolute',
              top: -gapAbove * PX_PER_MINUTE,
                  left: 4,
                  width: 8,
                  height: Math.max(6, gapAbove * PX_PER_MINUTE),
                  background: `repeating-linear-gradient(135deg, ${theme.ledger.gapStripe}, ${theme.ledger.gapStripe} 4px, transparent 4px, transparent 8px)`,
                  opacity: 0.8,
                }}
              />
            )}

            <Paper
              elevation={0}
              onClick={() => block.closed && onToggleExpand(block.id)}
              sx={{
                position: 'relative',
                minHeight: height,
                p: 1,
                bgcolor: color,
                color: '#F4F5EF',
                borderRadius: 1.5,
                cursor: block.closed ? 'pointer' : 'default',
                boxShadow: expanded
                  ? `0 0 0 2px ${theme.palette.text.primary}`
                  : '0 2px 5px rgba(0,0,0,0.18)',
              }}
            >
              {expanded && block.closed && (
                <>
                  <Box
                    onPointerDown={(event) => onPinPointerDown(block.id, 'start', event)}
                    onClick={(event) => event.stopPropagation()}
                    sx={{
                      position: 'absolute',
                      left: -7,
                      top: -7,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      bgcolor: 'warning.main',
                      border: `2px solid ${theme.ledger.pinBorder}`,
                      touchAction: 'none',
                      cursor: 'ns-resize',
                    }}
                  />
                  <Box
                    onPointerDown={(event) => onPinPointerDown(block.id, 'end', event)}
                    onClick={(event) => event.stopPropagation()}
                    sx={{
                      position: 'absolute',
                      left: -7,
                      bottom: -7,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      bgcolor: 'warning.main',
                      border: `2px solid ${theme.ledger.pinBorder}`,
                      touchAction: 'none',
                      cursor: 'ns-resize',
                    }}
                  />
                </>
              )}

              {showAbsorbUp && (
                <IconButton
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation()
                    onAbsorbGap(block.id, 'up')
                  }}
                  sx={{
                    position: 'absolute',
                    top: -16,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    bgcolor: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                  }}
                >
                  <KeyboardArrowUpIcon fontSize="small" />
                </IconButton>
              )}

              {showAbsorbDown && (
                <IconButton
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation()
                    onAbsorbGap(block.id, 'down')
                  }}
                  sx={{
                    position: 'absolute',
                    bottom: -16,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    bgcolor: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                  }}
                >
                  <KeyboardArrowDownIcon fontSize="small" />
                </IconButton>
              )}

              <Stack spacing={0.75}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="caption" sx={{ fontFamily: MONO_FONT, fontSize: 10, fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.9)' }}>
                    {`${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')} - ${
                      block.closed
                        ? `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`
                        : 'now'
                    }`}
                  </Typography>
                  {ticketId && (
                    <Chip
                      size="small"
                      icon={ticketCount > 1 ? <LinkIcon sx={{ color: '#fff !important' }} /> : undefined}
                      label={ticketCount > 1 ? `${ticketId} · ${ticketCount}` : ticketId}
                      sx={{ bgcolor: theme.ledger.ticketBadgeBg, color: '#fff', fontFamily: MONO_FONT, fontWeight: 600 }}
                    />
                  )}
                </Stack>

                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {summary}
                </Typography>

                {expanded && (
                  <Stack spacing={1} onClick={(event) => event.stopPropagation()}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button size="small" variant="contained" color="inherit" onClick={() => onSelectSummaryEdit(block.id)}>
                        Edit summary
                      </Button>
                      {canMergePrev && (
                        <Button size="small" variant="contained" color="inherit" onClick={() => onMerge(block.id, 'prev')}>
                          Merge with previous
                        </Button>
                      )}
                      {canMergeNext && (
                        <Button size="small" variant="contained" color="inherit" onClick={() => onMerge(block.id, 'next')}>
                          Merge with next
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                )}
              </Stack>
            </Paper>
          </Box>
        )
      })}
    </Box>
  )
}

export function App() {
  const theme = useAppTheme()
  const [profile, setProfile] = useState<JiraProfile | null>(null)
  const [date, setDate] = useState(todayISO())
  const [day, setDay] = useState<NotebookDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [summaryEditorId, setSummaryEditorId] = useState<string | null>(null)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [timelineTick, setTimelineTick] = useState(0)
  const [pushState, setPushState] = useState<PushState>({ mode: 'idle' })
  const [syncOpen, setSyncOpen] = useState(false)

  // Reveal the Tempo sync section automatically once a dry-run or push finishes
  // so the request preview / results are visible without a manual toggle.
  useEffect(() => {
    if (pushState.mode === 'done') setSyncOpen(true)
  }, [pushState])

  const dayRef = useRef<NotebookDay | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivityRef = useRef<number | null>(null)
  const dayTimeAnchorRef = useRef<DayTimeAnchor | null>(null)
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const textAreaRefCallbacks = useRef(new Map<string, (element: HTMLTextAreaElement | null) => void>())

  useEffect(() => {
    dayRef.current = day
  }, [day])

  const getCurrentMinute = useCallback((forDate: string) => {
    const now = Date.now()
    const minuteBase = wallClockMinuteForDate(forDate)
    const anchor = dayTimeAnchorRef.current

    if (!anchor || anchor.date !== forDate) {
      dayTimeAnchorRef.current = {
        date: forDate,
        wallClockStartMs: now,
        minuteBase,
      }
      return minuteBase
    }

    const elapsedMinutes = ((now - anchor.wallClockStartMs) / 60000) * DEBUG_TIME_SCALE
    return Math.floor(anchor.minuteBase + elapsedMinutes)
  }, [])

  useEffect(() => {
    api.profile().then(setProfile).catch(() => setProfile(null))
    api.getSettings().then(setSettings).catch(() => setSettings(cloneSettings(defaultSettings)))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getDay(date)
      .then((loaded) => {
        if (cancelled) return
        setDay(normalizeNotebookDay(loaded))
        lastActivityRef.current = null
        dayTimeAnchorRef.current = {
          date: loaded.date,
          wallClockStartMs: Date.now(),
          minuteBase: wallClockMinuteForDate(loaded.date),
        }
        setExpandedId(null)
        setSummaryEditorId(null)
        setSummaryDraft('')
        setPushState({ mode: 'idle' })
      })
      .catch((cause) => {
        if (cancelled) return
        setError((cause as Error).message)
        const fallbackDay = normalizeNotebookDay({ date, blocks: [] })
        setDay(fallbackDay)
        dayTimeAnchorRef.current = {
          date,
          wallClockStartMs: Date.now(),
          minuteBase: wallClockMinuteForDate(date),
        }
        setPushState({ mode: 'idle' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date])

  const scheduleSave = useCallback((nextDay: NotebookDay) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.saveDay({ day: persistedNotebookDay(nextDay) }).catch((cause) => setError(`Save failed: ${(cause as Error).message}`))
    }, 500)
  }, [])

  useEffect(() => {
    const handle = setInterval(() => {
      setTimelineTick((tick) => tick + 1)
      const lastActivity = lastActivityRef.current
      const currentDay = dayRef.current
      if (!currentDay || lastActivity === null) return
      if (Date.now() - lastActivity < effectiveIdleThresholdMs()) return

      const nowMinute = getCurrentMinute(currentDay.date)
      const activeIndex = currentDay.blocks.findIndex((block) => block.startMinute !== null && !block.closed)
      if (activeIndex === -1) return

      const nextBlocks = currentDay.blocks.map((block, index) =>
        index === activeIndex ? { ...block, closed: true, endMinute: Math.max(block.startMinute ?? nowMinute, nowMinute) } : block,
      )
      const normalized = normalizeNotebookDay({ date: currentDay.date, blocks: nextBlocks })
      setDay(normalized)
      scheduleSave(normalized)
      lastActivityRef.current = null
    }, TIMELINE_REFRESH_MS)

    return () => clearInterval(handle)
  }, [getCurrentMinute, scheduleSave])

  const commitDay = useCallback((update: (current: NotebookDay) => NotebookDay, save = true) => {
    const currentDay = dayRef.current
    if (!currentDay) return
    const nextDay = normalizeNotebookDay(update(currentDay))
    dayRef.current = nextDay
    setDay(nextDay)
    if (save) scheduleSave(nextDay)
  }, [scheduleSave])

  const getTextAreaRef = useCallback((id: string) => {
    if (!textAreaRefCallbacks.current.has(id)) {
      textAreaRefCallbacks.current.set(id, (element: HTMLTextAreaElement | null) => {
        textAreaRefs.current[id] = element
      })
    }
    return textAreaRefCallbacks.current.get(id) as (element: HTMLTextAreaElement | null) => void
  }, [])

  const replaceBlockById = useCallback((blocks: NotebookBlock[], id: string, mutate: (block: NotebookBlock) => NotebookBlock) => {
    return blocks.map((block) => (block.id === id ? mutate(block) : block))
  }, [])

  const patchBlock = useCallback((block: NotebookBlock, patch: Partial<NotebookBlock>) => {
    const nextBlock = { ...block, ...patch }
    return blockHasPushRelevantChanges(block, nextBlock) ? markBlockDirty(nextBlock) : nextBlock
  }, [])

  const activeReopenableId = useMemo(() => {
    if (!day || day.blocks.length < 2) return null
    const previous = day.blocks[day.blocks.length - 2]
    const trailing = day.blocks[day.blocks.length - 1]
    if (
      previous.closed &&
      previous.startMinute !== null &&
      trailing.startMinute === null &&
      trailing.text.trim() === '' &&
      trailing.ticketId.trim() === ''
    ) {
      return previous.id
    }
    return null
  }, [day])

  const handleTextChange = useCallback((id: string, value: string, eventTarget?: HTMLTextAreaElement | null) => {
    lastActivityRef.current = Date.now()
    commitDay((currentDay) => {
      const nowMinute = getCurrentMinute(currentDay.date)
      const index = currentDay.blocks.findIndex((block) => block.id === id)
      if (index === -1) return currentDay
      const blocks = currentDay.blocks.map(cloneBlock)
      const block = blocks[index]
      const isUnstartedDraft = block.startMinute === null && !block.closed
      const isTrailingBlank = index === blocks.length - 1 && isUnstartedDraft
      const reopenableId = (() => {
        if (blocks.length < 2) return null
        const previous = blocks[blocks.length - 2]
        const trailing = blocks[blocks.length - 1]
        if (
          previous.closed &&
          previous.startMinute !== null &&
          trailing.startMinute === null &&
          trailing.text.trim() === '' &&
          trailing.ticketId.trim() === ''
        ) {
          return previous.id
        }
        return null
      })()
      const activeIndex = blocks.findIndex((candidate) => candidate.startMinute !== null && !candidate.closed)

      if (reopenableId === id) {
        blocks[index] = patchBlock(block, {
          text: value,
          closed: false,
          endMinute: null,
          summaryOverride: block.summaryOverride,
        })
        return { date: currentDay.date, blocks }
      }

      if (isUnstartedDraft) {
        if (activeIndex !== -1) {
          blocks[activeIndex] = patchBlock(blocks[activeIndex], {
            closed: true,
            endMinute: Math.max(blocks[activeIndex].startMinute ?? nowMinute, nowMinute),
          })
        }
        blocks[index] = patchBlock(block, {
          startMinute: nowMinute,
          endMinute: null,
          closed: false,
          text: value,
        })
        if (isTrailingBlank) blocks.push(createBlankBlock(currentDay.date))
        return { date: currentDay.date, blocks }
      }

      blocks[index] = patchBlock(block, { text: value })
      return { date: currentDay.date, blocks }
    })

    if (eventTarget) {
      eventTarget.style.height = 'auto'
      eventTarget.style.height = `${eventTarget.scrollHeight}px`
    }
  }, [commitDay, getCurrentMinute, patchBlock])

  const handleTicketChange = useCallback((id: string, ticketId: string) => {
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.map((block) => (block.id === id ? patchBlock(block, { ticketId }) : block)),
    }))
  }, [commitDay, patchBlock])

  const handleDeleteBlock = useCallback((id: string) => {
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.filter((block) => block.id !== id),
    }))
    setExpandedId((current) => (current === id ? null : current))
    setSummaryEditorId((current) => (current === id ? null : current))
    setSummaryDraft((draft) => (summaryEditorId === id ? '' : draft))
  }, [commitDay, summaryEditorId])

  const handleAbsorbGap = useCallback((id: string, direction: 'up' | 'down') => {
    commitDay((currentDay) => {
      const timedBlocks = getTimedBlocks(currentDay.blocks, getCurrentMinute(currentDay.date))
      const timedIndex = timedBlocks.findIndex((item) => item.block.id === id)
      if (timedIndex === -1) return currentDay

      const current = timedBlocks[timedIndex]
      const neighbor = direction === 'up' ? timedBlocks[timedIndex - 1] : timedBlocks[timedIndex + 1]
      if (!neighbor || !current.block.closed || !neighbor.block.closed) return currentDay

      const updatedBlocks = replaceBlockById(currentDay.blocks, id, (block) => {
        const dirty = markBlockDirty(block)
        return direction === 'up'
          ? { ...dirty, startMinute: neighbor.endMinute }
          : { ...dirty, endMinute: neighbor.startMinute }
      })

      return { date: currentDay.date, blocks: updatedBlocks }
    })
  }, [commitDay, getCurrentMinute, replaceBlockById])

  const handleMerge = useCallback((id: string, direction: 'prev' | 'next') => {
    commitDay((currentDay) => {
      const timedBlocks = getTimedBlocks(currentDay.blocks, getCurrentMinute(currentDay.date))
      const timedIndex = timedBlocks.findIndex((item) => item.block.id === id)
      if (timedIndex === -1) return currentDay

      const current = timedBlocks[timedIndex]
      const neighbor = direction === 'prev' ? timedBlocks[timedIndex - 1] : timedBlocks[timedIndex + 1]
      if (!neighbor || !current.block.closed || !neighbor.block.closed) return currentDay

      const earlier = direction === 'prev' ? neighbor.block : current.block
      const later = direction === 'prev' ? current.block : neighbor.block
      const mergedId = earlier.id

      const mergedBlock: NotebookBlock = markBlockDirty({
        ...earlier,
        endMinute: later.endMinute,
        text: [earlier.text, later.text].filter(Boolean).join('\n'),
        summaryOverride: null,
        ticketId: earlier.ticketId || later.ticketId,
      })

      return {
        date: currentDay.date,
        blocks: currentDay.blocks
          .filter((block) => block.id !== current.block.id && block.id !== neighbor.block.id)
          .concat(mergedBlock)
          .sort((left, right) => {
            const leftStart = left.startMinute ?? Number.MAX_SAFE_INTEGER
            const rightStart = right.startMinute ?? Number.MAX_SAFE_INTEGER
            if (leftStart !== rightStart) return leftStart - rightStart
            return left.id.localeCompare(right.id)
          })
          .map((block) => (block.id === mergedId ? mergedBlock : block)),
      }
    })
    setExpandedId(null)
    setSummaryEditorId(null)
    setSummaryDraft('')
  }, [commitDay, getCurrentMinute])

  const handlePinPointerDown = useCallback(
    (id: string, edge: 'start' | 'end', event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const currentDay = dayRef.current
      if (!currentDay) return
      const nowMinute = getCurrentMinute(currentDay.date)
      const timedBlocks = getTimedBlocks(currentDay.blocks, nowMinute)
      const timedIndex = timedBlocks.findIndex((item) => item.block.id === id)
      if (timedIndex === -1) return

      const current = timedBlocks[timedIndex]
      const previous = timedBlocks[timedIndex - 1]
      const next = timedBlocks[timedIndex + 1]
      const startValue = edge === 'start' ? current.startMinute : current.endMinute
      const pointerStart = event.clientY

      const onMove = (moveEvent: PointerEvent) => {
        const deltaMinutes = Math.round((moveEvent.clientY - pointerStart) / PX_PER_MINUTE)
        let nextValue = startValue + deltaMinutes

        if (edge === 'start') {
          const min = previous?.endMinute ?? 0
          const max = current.endMinute - MIN_BLOCK_DURATION_MINUTES
          nextValue = Math.min(Math.max(nextValue, min), max)
          commitDay((dayState) => ({
            date: dayState.date,
            blocks: replaceBlockById(dayState.blocks, id, (block) => markBlockDirty({ ...block, startMinute: nextValue })),
          }))
        } else {
          const min = current.startMinute + MIN_BLOCK_DURATION_MINUTES
          const max = next?.startMinute ?? getCurrentMinute(currentDay.date)
          nextValue = Math.min(Math.max(nextValue, min), max)
          commitDay((dayState) => ({
            date: dayState.date,
            blocks: replaceBlockById(dayState.blocks, id, (block) => markBlockDirty({ ...block, endMinute: nextValue })),
          }))
        }
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [commitDay, getCurrentMinute, replaceBlockById],
  )

  const openSummaryEditor = useCallback((id: string) => {
    const block = day?.blocks.find((candidate) => candidate.id === id)
    if (!block) return
    setSummaryEditorId(id)
    setSummaryDraft(block.summaryOverride ?? notebookBlockSummary(block))
  }, [day])

  const saveSummaryOverride = useCallback(() => {
    if (!summaryEditorId) return
    const summary = summaryDraft.trim()
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.map((block) =>
        block.id === summaryEditorId
          ? patchBlock(block, { summaryOverride: summary.length > 0 ? summary : null })
          : block,
      ),
    }))
    setSummaryEditorId(null)
    setSummaryDraft('')
  }, [commitDay, patchBlock, summaryDraft, summaryEditorId])

  const runPushAction = useCallback(async (action: 'dry-run' | 'push') => {
    setPushState({ mode: 'running', action })
    setError(null)
    try {
      const summary = action === 'dry-run' ? await api.dryRunDay(date) : await api.pushDay(date)
      if (action === 'push') {
        const refreshed = await api.getDay(date)
        setDay(normalizeNotebookDay(refreshed))
      }
      setPushState({ mode: 'done', action, summary })
    } catch (cause) {
      setError(`${action === 'dry-run' ? 'Dry run' : 'Push'} failed: ${(cause as Error).message}`)
      setPushState({ mode: 'idle' })
    }
  }, [date])

  const nowMinute = day ? getCurrentMinute(day.date) : getCurrentMinute(date)
  const validationIssues = useMemo(
    () => (day ? validateNotebookDay(persistedNotebookDay(day).blocks) : []),
    [day],
  )
  const issuesByBlock = useMemo(() => {
    const map = new Map<string, ValidationIssue[]>()
    for (const issue of validationIssues) {
      if (!issue.entryId) continue
      const list = map.get(issue.entryId) ?? []
      list.push(issue)
      map.set(issue.entryId, list)
    }
    return map
  }, [validationIssues])
  const totalMinutes = useMemo(
    () =>
      (day?.blocks ?? []).reduce((sum, block) => {
        const duration = blockDuration(block, nowMinute)
        return sum + (duration && duration > 0 ? duration : 0)
      }, 0),
    [day, nowMinute, timelineTick],
  )
  const trackedCount = useMemo(() => (day?.blocks ?? []).filter(isPersistedBlock).length, [day])
  const pushableBlocks = useMemo(() => (day?.blocks ?? []).filter(isPushableBlock), [day])
  const syncedBlocks = useMemo(() => pushableBlocks.filter((block) => block.tempoWorklogId).length, [pushableBlocks])
  const unsyncedBlocks = useMemo(() => pushableBlocks.filter((block) => !block.tempoWorklogId).length, [pushableBlocks])
  const ticketCount = useMemo(() => {
    const tickets = new Set(
      (day?.blocks ?? []).map((block) => block.ticketId.trim()).filter((ticketId) => ticketId.length > 0),
    )
    return tickets.size
  }, [day])
  const errorCount = validationIssues.filter((issue) => issue.level === 'error').length
  const warningCount = validationIssues.filter((issue) => issue.level === 'warning').length
  const pushBlocked = errorCount > 0 || unsyncedBlocks === 0
  const isLiveTyping = (day?.blocks ?? []).some((block) => block.startMinute !== null && !block.closed)
  const dryRunRunning = pushState.mode === 'running' && pushState.action === 'dry-run'
  const pushRunning = pushState.mode === 'running' && pushState.action === 'push'

  if (showSettings) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 4, px: 2 }}>
          <Box sx={{ maxWidth: 900, mx: 'auto' }}>
            <Settings settings={settings} onSaved={setSettings} onClose={() => setShowSettings(false)} />
          </Box>
        </Box>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Box
          sx={{
            minHeight: '100vh',
            bgcolor: 'background.default',
            display: 'flex',
            justifyContent: 'center',
            p: { xs: 1.5, md: 3 },
          }}
        >
          <Paper
            elevation={8}
            sx={{
              width: '100%',
              maxWidth: 1200,
              borderRadius: 2,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <AppBar position="static" elevation={0} sx={{ bgcolor: theme.ledger.barBg, color: theme.ledger.barText }}>
              <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}>
                <Stack direction="row" spacing={1.5} sx={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
                  <AccessTimeIcon />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" component="h1" sx={{ lineHeight: 1.15, fontWeight: 600 }} noWrap>
                      Protecht Timesheet Notebook
                    </Typography>
                    <Typography variant="caption" sx={{ fontFamily: MONO_FONT, color: theme.ledger.headerCaption, display: 'block' }} noWrap>
                      {buildLegacyProfileLabel(profile)}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: isLiveTyping ? 'secondary.main' : theme.ledger.headerCaption,
                      }}
                    />
                    <Typography variant="caption" sx={{ fontFamily: MONO_FONT }}>
                      {isLiveTyping ? 'logging' : 'idle'}
                    </Typography>
                  </Stack>
                  <IconButton color="inherit" size="small" onClick={() => setShowSettings(true)} aria-label="Settings">
                    <SettingsIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Toolbar>
            </AppBar>

            <Box
              sx={{
                px: { xs: 2, md: 3 },
                py: 1.5,
                bgcolor: theme.ledger.instructionBar,
                borderBottom: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 2,
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                  {prettyDate(date)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Notes are the source of truth. Time is inferred while you work, and the ruler mirrors the same blocks.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <IconButton size="small" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
                  <ChevronLeftIcon />
                </IconButton>
                <DatePicker
                  value={dayjs(date)}
                  onChange={(newValue) => setDate(newValue?.format('YYYY-MM-DD') || date)}
                  slotProps={{ textField: { size: 'small', sx: { width: 150, bgcolor: 'background.paper', borderRadius: 1 } } }}
                />
                <IconButton size="small" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
                  <ChevronRightIcon />
                </IconButton>
                <IconButton size="small" onClick={() => setDate(todayISO())} aria-label="Today">
                  <TodayIcon fontSize="small" />
                </IconButton>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => void runPushAction('dry-run')}
                  disabled={pushState.mode === 'running' || pushableBlocks.length === 0}
                >
                  {dryRunRunning ? 'Running dry run…' : 'Dry run'}
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={pushRunning ? <SyncIcon /> : <UploadIcon />}
                  onClick={() => void runPushAction('push')}
                  disabled={pushState.mode === 'running' || pushBlocked}
                >
                  {pushRunning ? 'Pushing…' : 'Push'}
                </Button>
              </Stack>
            </Box>

            <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
              <Stack
                direction="row"
                spacing={1}
                onClick={() => setSyncOpen((open) => !open)}
                sx={{ px: { xs: 2, md: 3 }, py: 1, cursor: 'pointer', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2">Tempo sync</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Closed notebook blocks with valid tickets are the push candidates. Editing synced timing, ticket, or summary marks that block unsynced again.
                  </Typography>
                </Box>
                <IconButton size="small" aria-label={syncOpen ? 'Collapse Tempo sync' : 'Expand Tempo sync'}>
                  <ExpandMoreIcon
                    fontSize="small"
                    sx={{ transform: syncOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
                  />
                </IconButton>
              </Stack>
              <Collapse in={syncOpen} timeout="auto" unmountOnExit>
                <Box sx={{ px: { xs: 2, md: 3 }, pb: 2 }}>
                  <Stack spacing={1.25}>
                {errorCount > 0 && (
                  <Alert severity="error">Resolve validation errors before pushing notebook blocks to Tempo.</Alert>
                )}

                {pushableBlocks.length === 0 && (
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
                          const matchingBlock = day?.blocks.find((block) => block.id === planned.blockId)
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

            {error && (
              <Box sx={{ px: { xs: 2, md: 3 }, pt: 2 }}>
                <Alert severity="error">{error}</Alert>
              </Box>
            )}

            {summaryEditorId && (
              <Box sx={{ px: { xs: 2, md: 3 }, pt: 2 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Edit Tempo summary</Typography>
                    <InputBase
                      value={summaryDraft}
                      onChange={(event) => setSummaryDraft(event.target.value)}
                      placeholder="Short summary to send to Tempo"
                      fullWidth
                      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1, py: 0.75, bgcolor: 'background.default' }}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button variant="contained" startIcon={<CheckIcon />} onClick={saveSummaryOverride}>
                        Save summary
                      </Button>
                      <Button variant="text" onClick={() => setSummaryEditorId(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              </Box>
            )}

            {loading || !day ? (
              <Box sx={{ p: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              </Box>
            ) : (
              <Stack direction={{ xs: 'column', md: 'row' }} sx={{ flex: 1, minHeight: 0 }}>
                <Box
                  sx={{
                    flex: 1.25,
                    p: 2,
                    overflowY: 'auto',
                    maxHeight: { xs: 'none', md: 640 },
                    borderRight: { xs: 'none', md: '1px solid' },
                    borderBottom: { xs: '1px solid', md: 'none' },
                    borderColor: 'divider',
                    background: `repeating-linear-gradient(180deg, ${theme.ledger.ruledPaperBase}, ${theme.ledger.ruledPaperBase} 27px, ${theme.ledger.ruledPaperLine} 27px, ${theme.ledger.ruledPaperLine} 28px)`,
                  }}
                >
                  <Typography variant="subtitle1" sx={{ mb: 1.25, fontWeight: 600 }}>
                    Notebook
                  </Typography>
                  <NotebookEditorPanel
                    blocks={day.blocks}
                    adminTicket={settings.validation.adminTicket}
                    issuesByBlock={issuesByBlock}
                    onTextChange={handleTextChange}
                    onTicketChange={handleTicketChange}
                    onSelectSummaryEdit={openSummaryEditor}
                    onDeleteBlock={handleDeleteBlock}
                    activeReopenableId={activeReopenableId}
                    getTextAreaRef={getTextAreaRef}
                  />
                </Box>

                <Box
                  sx={{
                    width: { xs: '100%', md: 380 },
                    p: 2,
                    overflowY: 'auto',
                    maxHeight: { xs: 'none', md: 640 },
                    bgcolor: theme.ledger.rulerPanel,
                  }}
                >
                  <Stack spacing={1}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      Ruler
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Tap a closed block to reveal drag pins, gap absorb controls, and merge actions. Shared ticket IDs keep the same color and connect across the timeline.
                    </Typography>
                  </Stack>
                  <TimelinePanel
                    blocks={day.blocks.filter((block) => isPersistedBlock(block))}
                    nowMinute={nowMinute}
                    expandedId={expandedId}
                    onToggleExpand={(id) => setExpandedId((current) => (current === id ? null : id))}
                    onSelectSummaryEdit={openSummaryEditor}
                    onAbsorbGap={handleAbsorbGap}
                    onMerge={handleMerge}
                    onPinPointerDown={handlePinPointerDown}
                  />
                </Box>
              </Stack>
            )}

            <Stack
              direction="row"
              useFlexGap
              spacing={2}
              sx={{ px: { xs: 2, md: 3 }, py: 1.5, mt: 'auto', bgcolor: theme.ledger.barBg, color: theme.ledger.barText, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Stack direction="row" useFlexGap spacing={2.5} sx={{ flexWrap: 'wrap' }}>
                {[
                  `blocks · ${trackedCount}`,
                  `tickets · ${ticketCount}`,
                  `ready · ${unsyncedBlocks}`,
                  `synced · ${syncedBlocks}`,
                  `tracked · ${formatHours(Math.round(totalMinutes))}`,
                  `errors · ${errorCount}`,
                  `warnings · ${warningCount}`,
                ].map((stat) => (
                  <Typography key={stat} variant="caption" sx={{ fontFamily: MONO_FONT }}>
                    {stat}
                  </Typography>
                ))}
              </Stack>
              <Typography variant="caption" sx={{ fontFamily: MONO_FONT, opacity: 0.75 }}>
                tap block · pins + merge
              </Typography>
            </Stack>
          </Paper>
        </Box>
      </LocalizationProvider>
    </ThemeProvider>
  )
}
