import { useCallback, useEffect, useMemo, useState } from 'react'
import FilterAltIcon from '@mui/icons-material/FilterAlt'
import type { JiraProfile } from '@shared/types'
import { cloneSettings, defaultSettings, type Settings as AppSettings } from '@shared/settings'
import { isPersistedNotebookBlock, type TruncatedSummaryEntry } from '@shared/notebook'
import { validateNotebookDay, type ValidationIssue } from '@shared/validation'
import { api } from '@app/api'
import { isPushableBlock } from '@app/features/sync/syncStatus'
import { blockDuration, persistedNotebookDay } from '@app/features/notebook/blockModel'
import { NotebookEditorPanel } from '@app/features/notebook/NotebookEditorPanel'
import { TimelinePanel } from '@app/features/timeline/TimelinePanel'
import { SummaryTruncationDialog } from '@app/features/sync/SummaryTruncationDialog'
import { TempoSyncSection } from '@app/features/sync/TempoSyncSection'
import { useTempoWorklogs } from '@app/features/sync/useTempoWorklogs'
import { usePushFlow } from '@app/features/sync/usePushFlow'
import { AppHeader } from '@app/features/shell/AppHeader'
import { DateToolbar } from '@app/features/shell/DateToolbar'
import { StatusBar } from '@app/features/shell/StatusBar'
import { useAppClock } from '@app/features/shell/useAppClock'
import { useAiStatus } from '@app/features/shell/useAiStatus'
import { useNotebookDay } from '@app/features/notebook/useNotebookDay'
import { useBlockDrag } from '@app/features/timeline/useBlockDrag'
import { useTimelineSplit } from '@app/features/timeline/useTimelineSplit'
import { todayISO } from './dateutil'
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
  Tooltip,
  Typography,
} from '@mui/material'
import { useAppTheme } from './useAppTheme'

// Stable identities for the closed truncation gate so the dialog's props
// don't churn (and its draft-reset effect doesn't refire) on every render.
const NO_ENTRIES: TruncatedSummaryEntry[] = []
const NO_IDS: ReadonlySet<string> = new Set()

export function App() {
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance())
  const theme = useAppTheme(appearance)
  const handleAppearanceChange = useCallback((next: Appearance) => {
    setAppearance(next)
    writeAppearance(next)
  }, [])
  const [profile, setProfile] = useState<JiraProfile | null>(null)
  const [date, setDate] = useState(todayISO())
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)
  const [showTempoWorklogs, setShowTempoWorklogs] = useState(true)
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => {
    api.profile().then(setProfile).catch(() => setProfile(null))
    api.getSettings().then(setSettings).catch(() => setSettings(cloneSettings(defaultSettings)))
  }, [])

  const { tick, getCurrentMinute, resetClockAnchor, clockLabel } = useAppClock()
  const aiRunning = useAiStatus(settings.ai.enabled)

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
    handleSuggest,
  } = useNotebookDay({
    date,
    getCurrentMinute,
    resetClockAnchor,
    setExpandedId,
    onError: setError,
  })

  const tempoConfigured = settings.connections.tempo.apiTokenSaved
  const {
    tempoWorklogs,
    loading: tempoWorklogsLoading,
    error: tempoWorklogsError,
    reload: reloadTempoWorklogs,
  } = useTempoWorklogs({ date, tempoConfigured })

  const { timelineWidth, handleSplitPointerDown } = useTimelineSplit()

  const { handlePinPointerDown, handleTimelineBlockPointerDown, handleTimelineBlockClick } = useBlockDrag({
    dayRef,
    commitDay,
    getCurrentMinute,
    setExpandedId,
  })

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
    onError: setError,
  })

  // Reveal the Tempo sync section automatically once a dry-run or push finishes
  // so the request preview / results are visible without a manual toggle.
  useEffect(() => {
    if (pushState.mode === 'done') setSyncOpen(true)
  }, [pushState])

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
    [day, nowMinute, tick],
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
