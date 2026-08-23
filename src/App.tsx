import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import FilterAltIcon from '@mui/icons-material/FilterAlt'
import { Tooltip } from '@mui/material'
import type { JiraProfile, NotebookBlock, NotebookDay, TempoWorklog } from '@shared/types'
import { cloneSettings, defaultSettings, type Settings as AppSettings } from '@shared/settings'
import { isPersistedNotebookBlock, truncatedAutoSummaries, type TruncatedSummaryEntry } from '@shared/notebook'
import { validateNotebookDay, parseTime, type ValidationIssue } from '@shared/validation'
import { api } from '@app/api'
import {
  DAY_MINUTES,
  DEBUG_TIME_SCALE,
  MIN_BLOCK_DURATION_MINUTES,
  TIMELINE_REFRESH_MS,
  blockDuration,
  blockHasPushRelevantChanges,
  cloneBlock,
  createBlankBlock,
  effectiveIdleThresholdMs,
  getTimedBlocks,
  markBlockDirty,
  normalizeNotebookDay,
  persistedNotebookDay,
  wallClockMinuteForDate,
} from '@app/features/notebook/blockModel'
import type { PushState } from '@app/features/sync/syncStatus'
import { isPushableBlock } from '@app/features/sync/syncStatus'
import { PX_PER_MINUTE } from '@app/features/timeline/constants'
import { clampTimelineWidth, readTimelineWidth, writeTimelineWidth } from '@app/features/timeline/timelineWidth'
import { NotebookEditorPanel } from '@app/features/notebook/NotebookEditorPanel'
import { TimelinePanel } from '@app/features/timeline/TimelinePanel'
import { SummaryTruncationDialog } from '@app/features/sync/SummaryTruncationDialog'
import { TempoSyncSection } from '@app/features/sync/TempoSyncSection'
import { AppHeader } from '@app/features/shell/AppHeader'
import { DateToolbar } from '@app/features/shell/DateToolbar'
import { StatusBar } from '@app/features/shell/StatusBar'
import { minutesToHHmm, parseDuration, todayISO } from './dateutil'
import { SettingsPage } from '@app/features/settings/SettingsPage'
import { readAppearance, writeAppearance, type Appearance } from './appearance'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import {
  Alert,
  Box,
  CssBaseline,
  FormControlLabel,
  IconButton,
  Menu,
  Stack,
  Switch,
  ThemeProvider,
  Typography,
} from '@mui/material'
import { useAppTheme } from './useAppTheme'

// Stable identities for the closed truncation gate so the dialog's props
// don't churn (and its draft-reset effect doesn't refire) on every render.
const NO_ENTRIES: TruncatedSummaryEntry[] = []
const NO_IDS: ReadonlySet<string> = new Set()

interface DayTimeAnchor {
  date: string
  wallClockStartMs: number
  minuteBase: number
}

// Pointer travel (px) before a press on a block body counts as a drag rather
// than a click.
const DRAG_START_THRESHOLD_PX = 4

export function App() {
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance())
  const theme = useAppTheme(appearance)
  const handleAppearanceChange = useCallback((next: Appearance) => {
    setAppearance(next)
    writeAppearance(next)
  }, [])
  const [profile, setProfile] = useState<JiraProfile | null>(null)
  const [date, setDate] = useState(todayISO())
  const [day, setDay] = useState<NotebookDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [timelineTick, setTimelineTick] = useState(0)
  const [pushState, setPushState] = useState<PushState>({ mode: 'idle' })
  // Blocks the push until every auto-truncated summary is confirmed in the
  // modal. Null = gate closed. Recomputed fresh on every Push click (no
  // persistence — each attempt re-warns).
  const [summaryGate, setSummaryGate] = useState<{
    entries: TruncatedSummaryEntry[]
    confirmedIds: Set<string>
  } | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)
  const [suggestingId, setSuggestingId] = useState<string | null>(null)
  const [aiRunning, setAiRunning] = useState(false)
  const [tempoWorklogs, setTempoWorklogs] = useState<TempoWorklog[]>([])
  const [tempoWorklogsLoading, setTempoWorklogsLoading] = useState(false)
  const [tempoWorklogsError, setTempoWorklogsError] = useState<string | null>(null)
  const [showTempoWorklogs, setShowTempoWorklogs] = useState(true)
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<HTMLElement | null>(null)
  // Per-date cache so flipping back to an already-loaded day doesn't refetch.
  const tempoWorklogCache = useRef<Map<string, TempoWorklog[]>>(new Map())
  const [timelineWidth, setTimelineWidth] = useState<number>(() => readTimelineWidth())
  const timelineWidthRef = useRef(timelineWidth)
  useEffect(() => {
    timelineWidthRef.current = timelineWidth
  }, [timelineWidth])

  // Reveal the Tempo sync section automatically once a dry-run or push finishes
  // so the request preview / results are visible without a manual toggle.
  useEffect(() => {
    if (pushState.mode === 'done') setSyncOpen(true)
  }, [pushState])

  const dayRef = useRef<NotebookDay | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivityRef = useRef<number | null>(null)
  // Set while a timeline block body drag is in flight; the click that follows
  // pointerup must not toggle that block's expansion.
  const justDraggedIdRef = useRef<string | null>(null)
  const dayTimeAnchorRef = useRef<DayTimeAnchor | null>(null)
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const textAreaRefCallbacks = useRef(new Map<string, (element: HTMLTextAreaElement | null) => void>())

  // Dedicated anchor for the top-right clock, independent of the currently
  // viewed date. Must never touch dayTimeAnchorRef (that one has the
  // side-effecting getCurrentMinute semantics tied to the selected day).
  const clockAnchorRef = useRef<{ startMs: number; baseMinutes: number } | null>(null)
  if (!clockAnchorRef.current) {
    const now = new Date()
    clockAnchorRef.current = {
      startMs: Date.now(),
      baseMinutes: now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60,
    }
  }

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
      return Math.min(DAY_MINUTES, Math.max(0, minuteBase))
    }

    const elapsedMinutes = ((now - anchor.wallClockStartMs) / 60000) * DEBUG_TIME_SCALE
    return Math.min(DAY_MINUTES, Math.max(0, Math.floor(anchor.minuteBase + elapsedMinutes)))
  }, [])

  useEffect(() => {
    api.profile().then(setProfile).catch(() => setProfile(null))
    api.getSettings().then(setSettings).catch(() => setSettings(cloneSettings(defaultSettings)))
  }, [])

  // Poll the local model's loaded/unloaded state for the status bar, but only
  // while AI is enabled so we don't invoke the command needlessly.
  useEffect(() => {
    if (!settings.ai.enabled) {
      setAiRunning(false)
      return
    }
    let cancelled = false
    const poll = () => {
      api
        .aiStatus()
        .then((status) => {
          if (!cancelled) setAiRunning(status.running)
        })
        .catch(() => {
          if (!cancelled) setAiRunning(false)
        })
    }
    poll()
    const handle = setInterval(poll, 4000)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [settings.ai.enabled])

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

  // Track the active date so async worklog fetches can tell whether their
  // result still applies to what the user is looking at.
  const dateRef = useRef(date)
  useEffect(() => {
    dateRef.current = date
  }, [date])

  const tempoConfigured = settings.connections.tempo.apiTokenSaved

  const loadTempoWorklogs = useCallback(
    async (targetDate: string, options?: { force?: boolean }) => {
      if (!tempoConfigured) {
        tempoWorklogCache.current.clear()
        setTempoWorklogs([])
        setTempoWorklogsError(null)
        setTempoWorklogsLoading(false)
        return
      }
      if (!options?.force) {
        const cached = tempoWorklogCache.current.get(targetDate)
        if (cached) {
          setTempoWorklogs(cached)
          setTempoWorklogsError(null)
          return
        }
      }
      setTempoWorklogsLoading(true)
      setTempoWorklogsError(null)
      try {
        const worklogs = await api.getTempoWorklogs(targetDate)
        tempoWorklogCache.current.set(targetDate, worklogs)
        if (targetDate === dateRef.current) setTempoWorklogs(worklogs)
      } catch (cause) {
        if (targetDate === dateRef.current) {
          setTempoWorklogs([])
          setTempoWorklogsError((cause as Error).message)
        }
      } finally {
        if (targetDate === dateRef.current) setTempoWorklogsLoading(false)
      }
    },
    [tempoConfigured],
  )

  // Lazy, per-day read of confirmed Tempo worklogs — fired on navigation and
  // once Tempo becomes configured. Never blocks the notebook render.
  useEffect(() => {
    void loadTempoWorklogs(date)
  }, [date, loadTempoWorklogs])

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
        index === activeIndex
          ? { ...block, closed: true, endMinute: Math.max(block.startMinute ?? nowMinute, nowMinute), manualEnd: false }
          : block,
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

      // Auto-closed entries (idle timeout) reopen when the user keeps typing —
      // that is the "continue this note" affordance. Manually closed entries
      // (end time / duration / Stop pill) must never lose their end time, so
      // they fall through to a plain text edit.
      if (reopenableId === id && block.manualEnd !== true) {
        blocks[index] = patchBlock(block, {
          text: value,
          closed: false,
          endMinute: null,
          manualEnd: false,
          summaryOverride: block.summaryOverride,
        })
        return { date: currentDay.date, blocks }
      }

      if (isUnstartedDraft) {
        if (activeIndex !== -1) {
          blocks[activeIndex] = patchBlock(blocks[activeIndex], {
            closed: true,
            endMinute: Math.max(blocks[activeIndex].startMinute ?? nowMinute, nowMinute),
            manualEnd: false,
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

  // Manual (retroactive) time entry. Deliberately does NOT touch lastActivityRef
  // or auto-close siblings — unlike live typing — so the idle timer can't stomp
  // a hand-set time and overlaps are left for validation to flag.
  const handleTimeChange = useCallback((id: string, edge: 'start' | 'end', value: string) => {
    const minutes = value.trim() === '' ? null : parseTime(value)
    if (value.trim() !== '' && minutes === null) return
      commitDay((currentDay) => ({
        date: currentDay.date,
        blocks: currentDay.blocks.map((block) => {
          if (block.id !== id) return block
          if (edge === 'start') {
            return minutes === null
              ? patchBlock(block, { startMinute: null, endMinute: null, closed: false, manualEnd: false })
              : patchBlock(block, { startMinute: minutes })
          }
          return minutes === null
            ? patchBlock(block, { endMinute: null, closed: false, manualEnd: false })
            : patchBlock(block, { endMinute: minutes, closed: true, manualEnd: true })
        }),
      }))
  }, [commitDay, patchBlock])

  const handleDurationChange = useCallback((id: string, value: string) => {
    const durationMinutes = parseDuration(value)
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.map((block) => {
        if (block.id !== id) return block
        if (block.startMinute === null) return block
        if (durationMinutes === null || durationMinutes <= 0) {
          return patchBlock(block, { endMinute: null, closed: false, manualEnd: false })
        }
        const endMinute = Math.min(block.startMinute + durationMinutes, 1439)
        return patchBlock(block, { endMinute, closed: true, manualEnd: true })
      }),
    }))
  }, [commitDay, patchBlock])

  const handleDeleteBlock = useCallback((id: string) => {
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.filter((block) => block.id !== id),
    }))
    setExpandedId((current) => (current === id ? null : current))
  }, [commitDay])

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

  // Whole-block drag: shifts both edges by the same delta so the duration is
  // preserved, clamped against neighbouring blocks and the day bounds. A
  // genuine drag suppresses the click that would otherwise toggle expansion.
  const handleTimelineBlockPointerDown = useCallback(
    (id: string, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      // Interactive controls inside the block (pins, merge/absorb buttons)
      // handle their own pointer events; only the body starts a move.
      if ((event.target as HTMLElement).closest('button')) return

      const currentDay = dayRef.current
      if (!currentDay) return
      const timedBlocks = getTimedBlocks(currentDay.blocks, getCurrentMinute(currentDay.date))
      const timedIndex = timedBlocks.findIndex((item) => item.block.id === id)
      if (timedIndex === -1) return

      const current = timedBlocks[timedIndex]
      if (!current.block.closed) return
      const startMinute = current.startMinute
      const duration = current.endMinute - current.startMinute
      const previous = timedBlocks[timedIndex - 1]
      const next = timedBlocks[timedIndex + 1]
      const minDelta = (previous?.endMinute ?? 0) - startMinute
      const maxDelta = (next?.startMinute ?? DAY_MINUTES) - current.endMinute
      const pointerStart = event.clientY
      let moved = false
      let lastApplied: number | null = null

      event.preventDefault()

      const onMove = (moveEvent: PointerEvent) => {
        const offsetY = moveEvent.clientY - pointerStart
        if (!moved && Math.abs(offsetY) < DRAG_START_THRESHOLD_PX) return
        moved = true
        justDraggedIdRef.current = id

        const applied = Math.min(Math.max(Math.round(offsetY / PX_PER_MINUTE), minDelta), maxDelta)
        if (applied === lastApplied) return
        lastApplied = applied
        commitDay((dayState) => ({
          date: dayState.date,
          blocks: replaceBlockById(dayState.blocks, id, (block) =>
            markBlockDirty({ ...block, startMinute: startMinute + applied, endMinute: startMinute + applied + duration }),
          ),
        }))
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        // The click event (if any) fires after pointerup; clear the suppression
        // flag on a later tick so a click that never arrives can't swallow the
        // next legitimate one.
        window.setTimeout(() => {
          if (justDraggedIdRef.current === id) justDraggedIdRef.current = null
        }, 0)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [commitDay, getCurrentMinute, replaceBlockById],
  )

  // Click handler for timeline blocks: ignores the synthetic click that follows
  // a block drag so dragging never toggles expansion.
  const handleTimelineBlockClick = useCallback((id: string) => {
    if (justDraggedIdRef.current === id) {
      justDraggedIdRef.current = null
      return
    }
    setExpandedId((current) => (current === id ? null : id))
  }, [])

  const handleSummaryChange = useCallback((id: string, value: string) => {
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.map((block) =>
        block.id === id
          ? patchBlock(block, { summaryOverride: value.trim().length > 0 ? value : null })
          : block,
      ),
    }))
  }, [commitDay, patchBlock])

  // One-click close of a live entry ("logging now" pill): stamps the end at
  // the current minute and freezes the block. The text stays fully editable —
  // only timing is locked. End is clamped to at least start + one minute so an
  // instant close can't create an invalid zero-duration range.
  const handleCloseLiveBlock = useCallback((id: string) => {
    commitDay((currentDay) => {
      const nowMinute = getCurrentMinute(currentDay.date)
      return {
        date: currentDay.date,
        blocks: currentDay.blocks.map((block) =>
          block.id === id && !block.closed && block.startMinute !== null
            ? patchBlock(block, {
                closed: true,
                endMinute: Math.max(nowMinute, block.startMinute + MIN_BLOCK_DURATION_MINUTES),
                manualEnd: true,
              })
            : block,
        ),
      }
    })
  }, [commitDay, getCurrentMinute, patchBlock])

  const handleSuggest = useCallback(async (id: string) => {
    const currentDay = dayRef.current
    const block = currentDay?.blocks.find((candidate) => candidate.id === id)
    const notes = block?.text.trim() ?? ''
    if (!notes) return

    setSuggestingId(id)
    setError(null)
    try {
      const suggestion = (await api.suggestSummary(notes)).trim()
      if (suggestion) handleSummaryChange(id, suggestion)
    } catch (cause) {
      setError(`Suggest failed: ${(cause as Error).message}`)
    } finally {
      setSuggestingId(null)
    }
  }, [handleSummaryChange])

  const runPushAction = useCallback(async (action: 'dry-run' | 'push') => {
    setPushState({ mode: 'running', action })
    setError(null)
    try {
      const summary = action === 'dry-run' ? await api.dryRunDay(date) : await api.pushDay(date)
      if (action === 'push') {
        const refreshed = await api.getDay(date)
        setDay(normalizeNotebookDay(refreshed))
        // Newly-synced blocks now exist in Tempo — refresh the overlay.
        void loadTempoWorklogs(date, { force: true })
      }
      setPushState({ mode: 'done', action, summary })
    } catch (cause) {
      setError(`${action === 'dry-run' ? 'Dry run' : 'Push'} failed: ${(cause as Error).message}`)
      setPushState({ mode: 'idle' })
    }
  }, [date, loadTempoWorklogs])

  // Push entry point: intercepts the push when any unsynced entry would
  // upload an auto-truncated summary, and only proceeds once every one has
  // been confirmed (as-is or replaced with an override) in the modal.
  const handlePushClick = useCallback(() => {
    const entries = truncatedAutoSummaries(
      dayRef.current?.blocks ?? [],
      settings.validation.maxSummaryChars,
    )
    if (entries.length === 0) {
      void runPushAction('push')
      return
    }
    setSummaryGate({ entries, confirmedIds: new Set() })
  }, [runPushAction, settings.validation.maxSummaryChars])

  const handleGateConfirm = useCallback((blockId: string) => {
    setSummaryGate((gate) =>
      gate ? { ...gate, confirmedIds: new Set([...gate.confirmedIds, blockId]) } : gate,
    )
  }, [])

  const handleGateEditOverride = useCallback(
    (blockId: string, value: string) => {
      handleSummaryChange(blockId, value)
    },
    [handleSummaryChange],
  )

  const handleGateCancel = useCallback(() => setSummaryGate(null), [])

  const handleGatePush = useCallback(() => {
    setSummaryGate(null)
    void runPushAction('push')
  }, [runPushAction])

  const handleSplitPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = timelineWidthRef.current

    const onMove = (moveEvent: PointerEvent) => {
      // Handle sits to the left of the timeline panel, so dragging left (a
      // smaller clientX) widens the timeline.
      setTimelineWidth(clampTimelineWidth(startWidth + (startX - moveEvent.clientX)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      writeTimelineWidth(timelineWidthRef.current)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const nowMinute = day ? getCurrentMinute(day.date) : getCurrentMinute(date)
  const clockLabel = useMemo(() => {
    if (DEBUG_TIME_SCALE === 1) {
      const now = new Date()
      return minutesToHHmm(now.getHours() * 60 + now.getMinutes())
    }
    const anchor = clockAnchorRef.current
    if (!anchor) return minutesToHHmm(0)
    const simMinutes = anchor.baseMinutes + ((Date.now() - anchor.startMs) / 60000) * DEBUG_TIME_SCALE
    return minutesToHHmm(Math.floor(simMinutes))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineTick])
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
  const trackedCount = useMemo(() => (day?.blocks ?? []).filter(isPersistedNotebookBlock).length, [day])
  const pushableBlocks = useMemo(() => (day?.blocks ?? []).filter(isPushableBlock), [day])
  const syncedBlocks = useMemo(() => pushableBlocks.filter((block) => block.tempoWorklogId).length, [pushableBlocks])
  const unsyncedBlocks = useMemo(() => pushableBlocks.filter((block) => !block.tempoWorklogId).length, [pushableBlocks])
  const ticketCount = useMemo(() => {
    const tickets = new Set(
      (day?.blocks ?? []).map((block) => block.ticketId.trim()).filter((ticketId) => ticketId.length > 0),
    )
    return tickets.size
  }, [day])
  const localWorklogIds = useMemo(() => {
    const ids = new Set<number>()
    for (const block of day?.blocks ?? []) {
      if (typeof block.tempoWorklogId === 'number') ids.add(block.tempoWorklogId)
    }
    return ids
  }, [day])
  const visibleTempoWorklogs = showTempoWorklogs ? tempoWorklogs : []
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
        <Box
          sx={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.default',
            overflowY: 'auto',
            py: 4,
            px: 2,
          }}
        >
          <Box sx={{ maxWidth: 900, mx: 'auto', width: '100%' }}>
            <SettingsPage
              settings={settings}
              onSaved={setSettings}
              onClose={() => setShowSettings(false)}
              appearance={appearance}
              onAppearanceChange={handleAppearanceChange}
            />
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
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.default',
          }}
        >
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <AppHeader
              profile={profile}
              clockLabel={clockLabel}
              isLiveTyping={isLiveTyping}
              onOpenSettings={() => setShowSettings(true)}
            />

            <DateToolbar
              date={date}
              onChangeDate={setDate}
              actionRunning={pushState.mode === 'running'}
              dryRunRunning={dryRunRunning}
              pushRunning={pushRunning}
              pushBlocked={pushBlocked}
              pushableCount={pushableBlocks.length}
              onDryRun={() => void runPushAction('dry-run')}
              onPushClick={handlePushClick}
            />

            <TempoSyncSection
              open={syncOpen}
              onToggle={() => setSyncOpen((open) => !open)}
              errorCount={errorCount}
              pushableCount={pushableBlocks.length}
              pushState={pushState}
              blocks={day?.blocks}
            />

            {error && (
              <Box sx={{ px: { xs: 2, md: 3 }, pt: 2 }}>
                <Alert severity="error">{error}</Alert>
              </Box>
            )}

            {loading || !day ? (
              <Box sx={{ p: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              </Box>
            ) : (
              <Stack direction={{ xs: 'column', md: 'row' }} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <Box
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    p: 2,
                    overflowY: 'auto',
                    height: { xs: 'auto', md: '100%' },
                    minHeight: 0,
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
                    maxSummaryChars={settings.validation.maxSummaryChars}
                    onTextChange={handleTextChange}
                    onTicketChange={handleTicketChange}
                    onTimeChange={handleTimeChange}
                    onDurationChange={handleDurationChange}
                    onSummaryChange={handleSummaryChange}
                    onSuggest={handleSuggest}
                    onCloseLiveBlock={handleCloseLiveBlock}
                    suggestingId={suggestingId}
                    onDeleteBlock={handleDeleteBlock}
                    activeReopenableId={activeReopenableId}
                    getTextAreaRef={getTextAreaRef}
                  />
                </Box>

                <Box
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize notebook and timeline panels"
                  onPointerDown={handleSplitPointerDown}
                  sx={{
                    display: { xs: 'none', md: 'flex' },
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    width: '7px',
                    cursor: 'col-resize',
                    borderLeft: '1px solid',
                    borderColor: 'divider',
                    touchAction: 'none',
                    '&:hover .split-grip': { opacity: 1 },
                  }}
                >
                  <Box
                    className="split-grip"
                    sx={{ width: '3px', height: 36, borderRadius: 2, bgcolor: 'text.disabled', opacity: 0.45, transition: 'opacity 150ms' }}
                  />
                </Box>

                <Box
                  sx={{
                    width: { xs: '100%', md: `${timelineWidth}px` },
                    flexShrink: 0,
                    p: 2,
                    overflowY: 'auto',
                    height: { xs: 'auto', md: '100%' },
                    minHeight: 0,
                    bgcolor: theme.ledger.rulerPanel,
                  }}
                >
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        Timeline
                      </Typography>
                      <Tooltip title="Timeline filters" arrow>
                        <IconButton
                          size="small"
                          aria-label="Timeline filters"
                          onClick={(event) => setFilterMenuAnchor(event.currentTarget)}
                        >
                          <FilterAltIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Menu
                        anchorEl={filterMenuAnchor}
                        open={Boolean(filterMenuAnchor)}
                        onClose={() => setFilterMenuAnchor(null)}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                      >
                        <Box sx={{ px: 2, py: 0.5 }}>
                          <FormControlLabel
                            control={
                              <Switch
                                size="small"
                                checked={showTempoWorklogs}
                                onChange={(event) => setShowTempoWorklogs(event.target.checked)}
                              />
                            }
                            label="Show Tempo worklogs"
                          />
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 220 }}>
                            {!tempoConfigured
                              ? 'Connect Tempo in settings to load existing worklogs.'
                              : tempoWorklogsLoading
                                ? 'Loading worklogs from Tempo…'
                                : tempoWorklogsError
                                  ? `Couldn't load Tempo worklogs: ${tempoWorklogsError}`
                                  : `${tempoWorklogs.length} confirmed worklog${tempoWorklogs.length === 1 ? '' : 's'} in Tempo for this day.`}
                          </Typography>
                        </Box>
                      </Menu>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Tap a closed block to reveal drag pins, gap absorb controls, and merge actions. Shared ticket IDs keep the same color and connect across the timeline. Hatched bars on the right are worklogs already in Tempo.
                    </Typography>
                  </Stack>
                  <TimelinePanel
                    blocks={day.blocks.filter((block) => isPersistedNotebookBlock(block))}
                    nowMinute={nowMinute}
                    expandedId={expandedId}
                    tempoWorklogs={visibleTempoWorklogs}
                    localWorklogIds={localWorklogIds}
                    onToggleExpand={handleTimelineBlockClick}
                    onAbsorbGap={handleAbsorbGap}
                    onMerge={handleMerge}
                    onPinPointerDown={handlePinPointerDown}
                    onBlockPointerDown={handleTimelineBlockPointerDown}
                    onDeselect={() => setExpandedId(null)}
                  />
                </Box>
              </Stack>
            )}

            <StatusBar
              trackedCount={trackedCount}
              ticketCount={ticketCount}
              unsyncedCount={unsyncedBlocks}
              syncedCount={syncedBlocks}
              totalMinutes={totalMinutes}
              errorCount={errorCount}
              warningCount={warningCount}
              aiEnabled={settings.ai.enabled}
              aiRunning={aiRunning}
            />
          </Box>

          <SummaryTruncationDialog
            open={summaryGate !== null}
            entries={summaryGate?.entries ?? NO_ENTRIES}
            confirmedIds={summaryGate?.confirmedIds ?? NO_IDS}
            pushing={pushRunning}
            onConfirm={handleGateConfirm}
            onEditOverride={handleGateEditOverride}
            onCancel={handleGateCancel}
            onPush={handleGatePush}
          />
        </Box>
      </LocalizationProvider>
    </ThemeProvider>
  )
}
