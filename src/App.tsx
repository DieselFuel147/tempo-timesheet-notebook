import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FilterAltIcon from '@mui/icons-material/FilterAlt'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline'
import type { JiraProfile } from '@shared/types'
import { cloneSettings, defaultSettings, type Settings as AppSettings } from '@shared/settings'
import { isPersistedNotebookBlock, isUntrackedBlock, type TruncatedSummaryEntry } from '@shared/notebook'
import { validateNotebookDay, type ValidationIssue } from '@shared/validation'
import { api } from '@app/api'
import { isPushableBlock } from '@app/features/sync/syncStatus'
import { getTimedBlocks, persistedNotebookDay, totalTrackedMinutes, wallClockMinuteForDate } from '@app/features/notebook/blockModel'
import { NotebookEditorPanel } from '@app/features/notebook/NotebookEditorPanel'
import { useNotebookWeek } from '@app/features/notebook/useNotebookWeek'
import { TimelinePanel } from '@app/features/timeline/TimelinePanel'
import { SummaryTruncationDialog } from '@app/features/sync/SummaryTruncationDialog'
import { ActivityLogPage } from '@app/features/activity/ActivityLogPage'
import { ActivityToast } from '@app/features/activity/ActivityToast'
import { useActivityLog, type ActivityEntry, type ActivityOutcome, type NotebookErrorSource } from '@app/features/activity/activityLog'
import { useTempoWorklogs } from '@app/features/sync/useTempoWorklogs'
import { usePushFlow } from '@app/features/sync/usePushFlow'
import { AppHeader } from '@app/features/shell/AppHeader'
import { DateToolbar } from '@app/features/shell/DateToolbar'
import { StatusBar } from '@app/features/shell/StatusBar'
import { StackedPanels, type StackedPanel } from '@app/features/shell/StackedPanels'
import { readTimelineCollapsed, writeTimelineCollapsed } from '@app/features/shell/timelineCollapsed'
import { useAppClock } from '@app/features/shell/useAppClock'
import { useAiStatus } from '@app/features/shell/useAiStatus'
import { useInactivityPrompt } from '@app/features/notifications/useInactivityPrompt'
import { useUserActivity } from '@app/features/notifications/useUserActivity'
import { useAppUpdater } from '@app/features/updater/useAppUpdater'
import { useNotebookDay } from '@app/features/notebook/useNotebookDay'
import { useBlockDrag } from '@app/features/timeline/useBlockDrag'
import { useTimelineSplit } from '@app/features/timeline/useTimelineSplit'
import {
  LINK_PULSE_MS,
  scrollToNotebookBlock,
  scrollToTimelineBlock,
  type LinkSide,
} from '@app/features/linking/blockLink'
import { resolveClickedEntrySpan } from '@app/features/timeline/dropTarget'
import { startOfWeek, todayISO, weekDates } from './dateutil'
import { SettingsPage } from '@app/features/settings/SettingsPage'
import { GuideDialog } from '@app/features/guide/GuideDialog'
import { readAppearance, writeAppearance, type Appearance } from './appearance'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import {
  Box,
  CssBaseline,
  FormControlLabel,
  IconButton,
  Menu,
  Stack,
  Switch,
  ThemeProvider,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useAppTheme } from './useAppTheme'

// Stable identities for the closed truncation gate so the dialog's props
// don't churn (and its draft-reset effect doesn't refire) on every render.
const NO_ENTRIES: TruncatedSummaryEntry[] = []
const NO_IDS: ReadonlySet<string> = new Set()

// Usage hints for the Timeline panel, surfaced via the header info icon so the
// body stays compact. Kept verbatim from the former always-visible caption.
const TIMELINE_HINT =
  'Tap a closed block to reveal drag pins, gap absorb controls, and merge actions. Double click a blank space to create a new entry. Click and drag a block to move it. Shared ticket IDs keep the same color and connect across the timeline. Skinny bars on the right are worklogs already in Tempo.'

type View = 'main' | 'settings' | 'log'

export function App() {
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance())
  const theme = useAppTheme(appearance)
  // Below the md breakpoint the notebook/timeline stack vertically; there they
  // take turns via StackedPanels instead of sharing (and squeezing) the width.
  const stackedMode = useMediaQuery(theme.breakpoints.down('md'))
  const handleAppearanceChange = useCallback((next: Appearance) => {
    setAppearance(next)
    writeAppearance(next)
  }, [])
  const [profile, setProfile] = useState<JiraProfile | null>(null)
  const [date, setDate] = useState(todayISO())
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [view, setView] = useState<View>('main')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Transient attention pulse on whichever panel a cross-panel jump landed in;
  // the highlight flashes and fades, nothing persists.
  const [linkPulse, setLinkPulse] = useState<{ id: string; side: LinkSide } | null>(null)
  const linkPulseTimerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (linkPulseTimerRef.current !== null) window.clearTimeout(linkPulseTimerRef.current)
    },
    [],
  )
  const startLinkPulse = useCallback((id: string, side: LinkSide) => {
    if (linkPulseTimerRef.current !== null) window.clearTimeout(linkPulseTimerRef.current)
    setLinkPulse({ id, side })
    linkPulseTimerRef.current = window.setTimeout(() => {
      setLinkPulse(null)
      linkPulseTimerRef.current = null
    }, LINK_PULSE_MS)
  }, [])
  const [stackedPanel, setStackedPanel] = useState<StackedPanel>('notebook')
  // Side-by-side layout only: StackedPanels always keeps both panels reachable.
  const [timelineCollapsed, setTimelineCollapsed] = useState(() => readTimelineCollapsed())
  const handleTimelineCollapsedChange = useCallback((collapsed: boolean) => {
    setTimelineCollapsed(collapsed)
    writeTimelineCollapsed(collapsed)
  }, [])
  const [showTempoWorklogs, setShowTempoWorklogs] = useState(true)
  // Open guide dialog; sectionId deep-links to a specific guide section
  // (e.g. panels can later open help scoped to themselves).
  const [guideState, setGuideState] = useState<{ sectionId: string | null } | null>(null)
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => {
    api.profile().then(setProfile).catch(() => setProfile(null))
    api.getSettings().then(setSettings).catch(() => setSettings(cloneSettings(defaultSettings)))
  }, [])

  const { tick, getCurrentMinute, resetClockAnchor, clockLabel } = useAppClock()
  const aiRunning = useAiStatus(settings.ai.enabled)
  // macOS nudge when time entries have gone stale (see Settings > Reminders).
  const lastAppActivityRef = useUserActivity()
  useInactivityPrompt({
    enabled: settings.notifications.inactivityEnabled,
    thresholdMinutes: settings.notifications.inactivityThresholdMinutes,
    workdayStartMin: settings.validation.workdayStartMin,
    workdayEndMin: settings.validation.workdayEndMin,
    lastActivityRef: lastAppActivityRef,
  })
  const updater = useAppUpdater()
  const headerUpdateVersion =
    updater.phase.kind === 'available'
      ? updater.phase.update.version
      : updater.phase.kind === 'ready'
        ? updater.phase.version
        : null

  const { entries: activityEntries, record: recordActivity } = useActivityLog()
  const [toastEntry, setToastEntry] = useState<ActivityEntry | null>(null)
  const showToast = useCallback((entry: ActivityEntry) => setToastEntry(entry), [])
  const handleSyncOutcome = useCallback(
    (outcome: ActivityOutcome) => showToast(recordActivity(outcome)),
    [recordActivity, showToast],
  )
  const handleNotebookError = useCallback(
    (source: NotebookErrorSource, message: string) =>
      showToast(recordActivity({ kind: 'notebook-error', source, message })),
    [recordActivity, showToast],
  )

  const {
    day,
    dayRef,
    setDay,
    loading,
    suggestingId,
    activeReopenableId,
    getTextAreaRef,
    commitDay,
    handleTextChange,
    handleTicketChange,
    handleTimeChange,
    handleDurationChange,
    handleSummaryChange,
    handleDeleteBlock,
    handleAbsorbGap,
    handleMerge,
    handleCloseLiveBlock,
    handleCreateEntryAt,
    handleSuggest,
  } = useNotebookDay({
    date,
    getCurrentMinute,
    resetClockAnchor,
    setExpandedId,
    onError: handleNotebookError,
  })

  const tempoConfigured = settings.connections.tempo.apiTokenSaved
  const {
    tempoWorklogs,
    loading: tempoWorklogsLoading,
    error: tempoWorklogsError,
    reload: reloadTempoWorklogs,
  } = useTempoWorklogs({ date, tempoConfigured })

  const weekMonday = useMemo(() => startOfWeek(date), [date])
  const weekDays = useNotebookWeek({ monday: weekMonday, selectedDate: date, selectedDay: day })

  const { timelineWidth, handleSplitPointerDown } = useTimelineSplit()

  const { handlePinPointerDown, handleTimelineBlockPointerDown, handleTimelineBlockClick, blockDragPreview } =
    useBlockDrag({
      dayRef,
      commitDay,
      getCurrentMinute,
      setExpandedId,
    })

  // Timeline → notebook: keep the existing drag-guarded expand toggle, then
  // flash the block's notebook card and reveal it.
  const handleTimelineSelect = useCallback(
    (id: string) => {
      handleTimelineBlockClick(id)
      startLinkPulse(id, 'notebook')
      scrollToNotebookBlock(id)
    },
    [handleTimelineBlockClick, startLinkPulse],
  )

  // Notebook → timeline: any click/focus inside an entry card flashes its
  // block. A hidden/unmounted target panel makes the scroll a no-op.
  const handleNotebookInteract = useCallback(
    (id: string) => {
      startLinkPulse(id, 'timeline')
      scrollToTimelineBlock(id)
    },
    [startLinkPulse],
  )

  // Double-click on a blank timeline spot: size the new entry to the clicked
  // gap (capped fills, anchored edges) and create it from the trailing blank
  // notebook slot.
  const handleCreateEntryAtMinute = useCallback(
    (minute: number) => {
      const currentDay = dayRef.current
      if (!currentDay) return
      const others = getTimedBlocks(currentDay.blocks, getCurrentMinute(currentDay.date)).map((item) => ({
        startMinute: item.startMinute,
        endMinute: item.endMinute,
      }))
      const span = resolveClickedEntrySpan(others, minute)
      handleCreateEntryAt(span.startMinute, span.endMinute)
    },
    [dayRef, getCurrentMinute, handleCreateEntryAt],
  )

  const {
    pushState,
    summaryGate,
    runPushAction,
    handlePushClick,
    handleGateConfirm,
    handleGateEditOverride,
    handleGateCancel,
    handleGatePush,
  } = usePushFlow({
    date,
    maxSummaryChars: settings.validation.maxSummaryChars,
    dayRef,
    setDay,
    reloadTempoWorklogs: (targetDate) => void reloadTempoWorklogs(targetDate, { force: true }),
    onSummaryChange: handleSummaryChange,
    onOutcome: handleSyncOutcome,
  })

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
    () => totalTrackedMinutes(day?.blocks ?? [], nowMinute),
    [day, nowMinute, tick],
  )
  const weekTotalMinutes = useMemo(
    () =>
      weekDates(weekMonday).reduce((sum, iso) => {
        const source = iso === date ? day : weekDays[iso]
        if (!source) return sum
        const nowForDay = iso === date ? nowMinute : wallClockMinuteForDate(iso)
        return sum + totalTrackedMinutes(source.blocks, nowForDay)
      }, 0),
    [weekMonday, weekDays, date, day, nowMinute, tick],
  )
  // Untracked entries persist but stay invisible to every stat: not tracked
  // time, not a ticket, never pushable (isPushableBlock already excludes them).
  const trackedCount = useMemo(
    () => (day?.blocks ?? []).filter((block) => isPersistedNotebookBlock(block) && !isUntrackedBlock(block)).length,
    [day],
  )
  const pushableBlocks = useMemo(() => (day?.blocks ?? []).filter(isPushableBlock), [day])
  const syncedBlocks = useMemo(() => pushableBlocks.filter((block) => block.tempoWorklogId).length, [pushableBlocks])
  const unsyncedBlocks = useMemo(() => pushableBlocks.filter((block) => !block.tempoWorklogId).length, [pushableBlocks])
  const ticketCount = useMemo(() => {
    const tickets = new Set(
      (day?.blocks ?? [])
        .filter((block) => !isUntrackedBlock(block))
        .map((block) => block.ticketId.trim())
        .filter((ticketId) => ticketId.length > 0),
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

  if (view === 'settings') {
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
              onClose={() => setView('main')}
              appearance={appearance}
              onAppearanceChange={handleAppearanceChange}
              updater={updater}
            />
          </Box>
        </Box>
      </ThemeProvider>
    )
  }

  if (view === 'log') {
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
            <ActivityLogPage entries={activityEntries} onClose={() => setView('main')} />
          </Box>
        </Box>
      </ThemeProvider>
    )
  }

  // Shared panel bodies so both layouts stay in sync. minHeight keeps each
  // panel's background covering the full scroll area even when content is short.
  const notebookPanel = (
    <Box
      sx={{
        p: 2,
        minHeight: '100%',
        background: `repeating-linear-gradient(180deg, ${theme.ledger.ruledPaperBase}, ${theme.ledger.ruledPaperBase} 27px, ${theme.ledger.ruledPaperLine} 27px, ${theme.ledger.ruledPaperLine} 28px)`,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Notebook
        </Typography>
        {/* Single persistent toggle for the side-by-side Timeline panel; stays
            in the same spot whether the timeline is shown or hidden. */}
        {!stackedMode && (
          <Tooltip title={timelineCollapsed ? 'Show timeline' : 'Hide timeline'} arrow>
            <IconButton
              size="small"
              aria-label={timelineCollapsed ? 'Show timeline' : 'Hide timeline'}
              onClick={() => handleTimelineCollapsedChange(!timelineCollapsed)}
            >
              <ViewTimelineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <NotebookEditorPanel
        blocks={day?.blocks ?? []}
        adminTicket={settings.validation.adminTicket}
        issuesByBlock={issuesByBlock}
        maxSummaryChars={settings.validation.maxSummaryChars}
        nowMinute={nowMinute}
        pulseId={linkPulse?.side === 'notebook' ? linkPulse.id : null}
        onInteract={handleNotebookInteract}
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
  )

  const timelinePanel = (
    <Box sx={{ p: 2, minHeight: '100%', bgcolor: theme.ledger.rulerPanel }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Timeline
          </Typography>
          <Tooltip title={TIMELINE_HINT} arrow>
            <IconButton size="small" aria-label="About the timeline panel">
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
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
      <TimelinePanel
        blocks={(day?.blocks ?? []).filter((block) => isPersistedNotebookBlock(block))}
        nowMinute={nowMinute}
        expandedId={expandedId}
        pulseId={linkPulse?.side === 'timeline' ? linkPulse.id : null}
        tempoWorklogs={visibleTempoWorklogs}
        localWorklogIds={localWorklogIds}
        blockDragPreview={blockDragPreview}
        onCreateEntryAt={handleCreateEntryAtMinute}
        onToggleExpand={handleTimelineSelect}
        onAbsorbGap={handleAbsorbGap}
        onMerge={handleMerge}
        onPinPointerDown={handlePinPointerDown}
        onBlockPointerDown={handleTimelineBlockPointerDown}
        onDeselect={() => setExpandedId(null)}
      />
    </Box>
  )

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
              updateVersion={headerUpdateVersion}
              onOpenGuide={() => setGuideState({ sectionId: null })}
              onOpenLog={() => setView('log')}
              onOpenSettings={() => setView('settings')}
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

            {loading || !day ? (
              <Box sx={{ p: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              </Box>
            ) : stackedMode ? (
              <StackedPanels
                active={stackedPanel}
                onChange={setStackedPanel}
                notebook={notebookPanel}
                timeline={timelinePanel}
              />
            ) : timelineCollapsed ? (
              // Collapsed timeline: notebook takes the full width; the restore
              // button lives in the Notebook header.
              <Box sx={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0, overflowY: 'auto' }}>
                {notebookPanel}
              </Box>
            ) : (
              <Stack direction="row" sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <Box sx={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0, overflowY: 'auto' }}>
                  {notebookPanel}
                </Box>

                <Box
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize notebook and timeline panels"
                  onPointerDown={handleSplitPointerDown}
                  sx={{
                    display: 'flex',
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
                    width: `${timelineWidth}px`,
                    flexShrink: 0,
                    height: '100%',
                    minHeight: 0,
                    overflowY: 'auto',
                  }}
                >
                  {timelinePanel}
                </Box>
              </Stack>
            )}

            <StatusBar
              trackedCount={trackedCount}
              ticketCount={ticketCount}
              unsyncedCount={unsyncedBlocks}
              syncedCount={syncedBlocks}
              totalMinutes={totalMinutes}
              weekTotalMinutes={weekTotalMinutes}
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

          <GuideDialog
            open={guideState !== null}
            initialSectionId={guideState?.sectionId ?? null}
            onClose={() => setGuideState(null)}
          />

          <ActivityToast
            entry={toastEntry}
            onClose={() => setToastEntry(null)}
            onOpenLog={() => setView('log')}
          />
        </Box>
      </LocalizationProvider>
    </ThemeProvider>
  )
}
