import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SettingsIcon from '@mui/icons-material/Settings'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import TodayIcon from '@mui/icons-material/Today'
import EditIcon from '@mui/icons-material/Edit'
import CheckIcon from '@mui/icons-material/Check'
import UndoIcon from '@mui/icons-material/Undo'
import LinkIcon from '@mui/icons-material/Link'
import type { JiraProfile, NotebookBlock, NotebookDay } from '../shared/types'
import { defaultSettings, type Settings as AppSettings } from '../shared/settings'
import { notebookBlockSummary } from '../shared/notebook'
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
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  IconButton,
  InputBase,
  Paper,
  Stack,
  ThemeProvider,
  Typography,
} from '@mui/material'
import { theme } from './theme'
import { TicketField } from './TicketField'

const IDLE_THRESHOLD_MS = 3 * 60 * 1000
const TIMELINE_REFRESH_MS = 1000
const PX_PER_MINUTE = 2
const MIN_BLOCK_HEIGHT = 42
const COLORS = ['#5b86f7', '#8a6bf0', '#39b88f', '#e0a13a', '#d46b91']

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

function nowMinuteForDate(date: string): number {
  const now = new Date()
  const today = todayISO()
  if (date !== today) return 17 * 60
  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
}

function blockDuration(block: NotebookBlock, nowMinute: number): number | null {
  if (block.startMinute === null) return null
  const endMinute = block.closed ? block.endMinute : nowMinute
  if (endMinute === null) return null
  return Math.max(0, endMinute - block.startMinute)
}

function isPersistedBlock(block: NotebookBlock): boolean {
  return block.startMinute !== null || block.text.trim().length > 0 || block.ticketId.trim().length > 0
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
  activeReopenableId,
  getTextAreaRef,
}: NotebookEditorPanelProps) {
  const lastStartedId = blocks.findLast((block) => block.startMinute !== null && !block.closed)?.id ?? null

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
          const isLive = block.id === lastStartedId
          const summary = notebookBlockSummary(block)

          return (
            <Paper
              key={block.id}
              variant="outlined"
              sx={{
                p: 1.25,
                borderColor: isReopenable ? 'warning.main' : 'divider',
                borderStyle: isReopenable ? 'dashed' : 'solid',
                backgroundColor: isBlank ? 'rgba(255,255,255,0.02)' : 'background.paper',
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
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 1,
                    px: 1,
                    py: 0.75,
                    backgroundColor: 'rgba(255,255,255,0.03)',
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
                    <Button size="small" startIcon={<EditIcon />} onClick={() => onSelectSummaryEdit(block.id)}>
                      Edit summary
                    </Button>
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
}

function TimelinePanel({ blocks, nowMinute, expandedId, onToggleExpand, onSelectSummaryEdit }: TimelinePanelProps) {
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
        colors.set(ticketId, COLORS[nextColor % COLORS.length])
        nextColor += 1
      }
    }
    return colors
  }, [blocks])

  const timedBlocks = blocks.filter((block) => block.startMinute !== null)
  const maxMinute = Math.max(nowMinute, ...timedBlocks.map((block) => (block.closed ? block.endMinute ?? nowMinute : nowMinute)), 17 * 60)
  const timelineHeight = Math.max(320, maxMinute * PX_PER_MINUTE + 64)

  return (
    <Box sx={{ position: 'relative', minHeight: timelineHeight, pr: 1, pl: 5, py: 2 }}>
      {Array.from({ length: Math.ceil(maxMinute / 60) + 2 }).map((_, hourIndex) => {
        const minute = hourIndex * 60
        if (minute > maxMinute + 60) return null
        return (
          <Box key={minute} sx={{ position: 'absolute', insetInline: 0, top: minute * PX_PER_MINUTE + 16 }}>
            <Typography
              variant="caption"
              sx={{ position: 'absolute', left: -40, top: -8, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
            >
              {`${String(Math.floor(minute / 60)).padStart(2, '0')}:00`}
            </Typography>
            <Box sx={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} />
          </Box>
        )
      })}

      {timedBlocks.map((block, index) => {
        const startMinute = block.startMinute ?? 0
        const endMinute = block.closed ? block.endMinute ?? startMinute : nowMinute
        const duration = Math.max(1, endMinute - startMinute)
        const height = Math.max(MIN_BLOCK_HEIGHT, duration * PX_PER_MINUTE)
        const top = startMinute * PX_PER_MINUTE + 16
        const ticketId = block.ticketId.trim()
        const color = ticketId ? ticketColors.get(ticketId) ?? COLORS[index % COLORS.length] : COLORS[index % COLORS.length]
        const ticketCount = ticketId ? ticketCounts.get(ticketId) ?? 0 : 0
        const summary = notebookBlockSummary(block)
        const expanded = expandedId === block.id

        return (
          <Paper
            key={block.id}
            elevation={0}
            onClick={() => block.closed && onToggleExpand(block.id)}
            sx={{
              position: 'absolute',
              top,
              left: 16,
              right: 0,
              minHeight: height,
              p: 1,
              bgcolor: color,
              color: '#fff',
              borderRadius: 1.5,
              cursor: block.closed ? 'pointer' : 'default',
              boxShadow: expanded ? '0 0 0 2px rgba(255,255,255,0.5)' : 'none',
            }}
          >
            <Stack spacing={0.75}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.9)' }}>
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
                    sx={{ bgcolor: 'rgba(0,0,0,0.2)', color: '#fff' }}
                  />
                )}
              </Stack>

              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {summary}
              </Typography>

              {expanded && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button size="small" variant="contained" color="inherit" onClick={(event) => { event.stopPropagation(); onSelectSummaryEdit(block.id) }}>
                    Edit summary
                  </Button>
                  <Chip size="small" label="Phase 4: drag, absorb gap, merge" sx={{ bgcolor: 'rgba(0,0,0,0.2)', color: '#fff' }} />
                </Stack>
              )}
            </Stack>
          </Paper>
        )
      })}
    </Box>
  )
}

export function App() {
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

  const dayRef = useRef<NotebookDay | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivityRef = useRef<number | null>(null)
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const textAreaRefCallbacks = useRef(new Map<string, (element: HTMLTextAreaElement | null) => void>())

  useEffect(() => {
    dayRef.current = day
  }, [day])

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
        })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date])

  useEffect(() => {
    const handle = setInterval(() => {
      setTimelineTick((tick) => tick + 1)
      const lastActivity = lastActivityRef.current
      const currentDay = dayRef.current
      if (!currentDay || lastActivity === null) return
      if (Date.now() - lastActivity < IDLE_THRESHOLD_MS) return

      const nowMinute = nowMinuteForDate(currentDay.date)
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
  }, [])

  const scheduleSave = useCallback((nextDay: NotebookDay) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.saveDay({ day: persistedNotebookDay(nextDay) }).catch((cause) => setError(`Save failed: ${(cause as Error).message}`))
    }, 500)
  }, [])

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
      const nowMinute = nowMinuteForDate(currentDay.date)
      const index = currentDay.blocks.findIndex((block) => block.id === id)
      if (index === -1) return currentDay
      const blocks = currentDay.blocks.map(cloneBlock)
      const block = blocks[index]
      const isTrailingBlank = index === blocks.length - 1 && block.startMinute === null
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

      if (reopenableId === id) {
        blocks[index] = {
          ...block,
          text: value,
          closed: false,
          endMinute: null,
          summaryOverride: block.summaryOverride,
        }
        return { date: currentDay.date, blocks }
      }

      if (isTrailingBlank) {
        const activeIndex = blocks.findIndex((candidate) => candidate.startMinute !== null && !candidate.closed)
        if (activeIndex !== -1) {
          blocks[activeIndex] = {
            ...blocks[activeIndex],
            closed: true,
            endMinute: Math.max(blocks[activeIndex].startMinute ?? nowMinute, nowMinute),
          }
        }
        blocks[index] = {
          ...block,
          startMinute: nowMinute,
          endMinute: null,
          closed: false,
          text: value,
        }
        blocks.push(createBlankBlock(currentDay.date))
        return { date: currentDay.date, blocks }
      }

      blocks[index] = { ...block, text: value }
      return { date: currentDay.date, blocks }
    })

    if (eventTarget) {
      eventTarget.style.height = 'auto'
      eventTarget.style.height = `${eventTarget.scrollHeight}px`
    }
  }, [commitDay])

  const handleTicketChange = useCallback((id: string, ticketId: string) => {
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.map((block) => (block.id === id ? { ...block, ticketId } : block)),
    }))
  }, [commitDay])

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
        block.id === summaryEditorId ? { ...block, summaryOverride: summary.length > 0 ? summary : null } : block,
      ),
    }))
    setSummaryEditorId(null)
    setSummaryDraft('')
  }, [commitDay, summaryDraft, summaryEditorId])

  const nowMinute = day ? nowMinuteForDate(day.date) : nowMinuteForDate(date)
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
  const ticketCount = useMemo(() => {
    const tickets = new Set(
      (day?.blocks ?? []).map((block) => block.ticketId.trim()).filter((ticketId) => ticketId.length > 0),
    )
    return tickets.size
  }, [day])
  const errorCount = validationIssues.filter((issue) => issue.level === 'error').length
  const warningCount = validationIssues.filter((issue) => issue.level === 'warning').length

  if (showSettings) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Container maxWidth="md" sx={{ py: 3, pb: 8 }}>
          <Settings settings={settings} onSaved={setSettings} onClose={() => setShowSettings(false)} />
        </Container>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Container maxWidth="xl" sx={{ py: 3, pb: 8 }}>
          <Stack spacing={2}>
            <Box
              component="header"
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
              }}
            >
              <Box>
                <Typography variant="h5" component="h1">
                  Timesheet Notebook
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {buildLegacyProfileLabel(profile)}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <IconButton size="small" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
                  <ChevronLeftIcon />
                </IconButton>
                <DatePicker value={dayjs(date)} onChange={(newValue) => setDate(newValue?.format('YYYY-MM-DD') || date)} />
                <IconButton size="small" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
                  <ChevronRightIcon />
                </IconButton>
                <IconButton size="small" onClick={() => setDate(todayISO())} aria-label="Today">
                  <TodayIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={() => setShowSettings(true)} aria-label="Settings">
                  <SettingsIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>

            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="h6">{prettyDate(date)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Notes are the source of truth. Time is inferred while you work, and the ruler mirrors the same blocks.
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip label={`${trackedCount} blocks`} variant="outlined" />
                  <Chip label={`${ticketCount} tickets`} variant="outlined" />
                  <Chip label={`${formatHours(Math.round(totalMinutes))} tracked`} color="primary" variant="outlined" />
                  <Chip label={`${errorCount} errors`} color={errorCount > 0 ? 'error' : 'default'} variant="outlined" />
                  <Chip label={`${warningCount} warnings`} color={warningCount > 0 ? 'warning' : 'default'} variant="outlined" />
                </Stack>
              </Stack>
            </Paper>

            {error && <Alert severity="error">{error}</Alert>}

            {summaryEditorId && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1}>
                  <Typography variant="subtitle2">Edit Tempo summary</Typography>
                  <InputBase
                    value={summaryDraft}
                    onChange={(event) => setSummaryDraft(event.target.value)}
                    placeholder="Short summary to send to Tempo"
                    fullWidth
                    sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1, px: 1, py: 0.75 }}
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
            )}

            {loading || !day ? (
              <Typography variant="body2" color="text.secondary">
                Loading…
              </Typography>
            ) : (
              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                <Stack direction={{ xs: 'column', md: 'row' }} sx={{ minHeight: 540 }}>
                  <Box
                    sx={{
                      flex: 1.25,
                      p: 2,
                      borderRight: { xs: 'none', md: '1px solid rgba(255,255,255,0.08)' },
                      borderBottom: { xs: '1px solid rgba(255,255,255,0.08)', md: 'none' },
                      background:
                        'repeating-linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.03) 31px, rgba(255,255,255,0.045) 31px, rgba(255,255,255,0.045) 32px)',
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
                      activeReopenableId={activeReopenableId}
                      getTextAreaRef={getTextAreaRef}
                    />
                  </Box>

                  <Box sx={{ width: { xs: '100%', md: 380 }, p: 2, bgcolor: 'rgba(255,255,255,0.02)' }}>
                    <Stack spacing={1}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        Ruler
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Phase 3 includes live mirroring and summary editing. Boundary drag, gap absorb, and merge land in Phase 4.
                      </Typography>
                    </Stack>
                    <TimelinePanel
                      blocks={day.blocks.filter((block) => isPersistedBlock(block))}
                      nowMinute={nowMinute}
                      expandedId={expandedId}
                      onToggleExpand={(id) => setExpandedId((current) => (current === id ? null : id))}
                      onSelectSummaryEdit={openSummaryEditor}
                    />
                  </Box>
                </Stack>
              </Paper>
            )}
          </Stack>
        </Container>
      </LocalizationProvider>
    </ThemeProvider>
  )
}
