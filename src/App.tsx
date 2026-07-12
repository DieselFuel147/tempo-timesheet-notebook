import { useEffect, useRef, useState } from 'react'
import SettingsIcon from '@mui/icons-material/Settings'
import type { Day, Entry, JiraProfile, PushSummary, DryRunSummary } from '../shared/types'
import {
  validateDay,
  entryDurationMinutes,
  parseTime,
  type ValidationIssue,
} from '../shared/validation'
import { defaultSettings, toValidationConfig, type Settings as AppSettings } from '../shared/settings'
import { api } from './api'
import { addDays, todayISO, prettyDate, minutesToHHmm, formatHours } from './dateutil'
import { EntryRow } from './EntryRow'
import { Settings } from './Settings'
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import { ThemeProvider, CssBaseline, Stack, IconButton, Alert, Button, TextField, Paper, Typography, Box, Container, Chip } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import { theme } from './theme'

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    validation: { ...settings.validation },
    connections: {
      jira: { ...settings.connections.jira },
      tempo: { ...settings.connections.tempo },
    },
  }
}

export function App() {
  const [profile, setProfile] = useState<JiraProfile | null>(null)
  const [date, setDate] = useState(todayISO())
  const [day, setDay] = useState<Day | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<PushSummary | null>(null)
  const [plan, setPlan] = useState<DryRunSummary | null>(null)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [showSettings, setShowSettings] = useState(false)

  // Mirror of `day` for event handlers, to avoid stale-closure reads.
  const dayRef = useRef<Day | null>(null)
  useEffect(() => {
    dayRef.current = day
  }, [day])

  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.profile().then(setProfile).catch(() => setProfile(null))
    api.getSettings().then(setSettings).catch(() => setSettings(cloneSettings(defaultSettings)))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPushResult(null)
    setPlan(null)
    api
      .getDay(date)
      .then((d) => {
        if (!cancelled) setDay(d)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date])

  function persistEntry(entry: Entry, sortOrder: number, immediate = false) {
    const existing = saveTimers.current.get(entry.id)
    if (existing) clearTimeout(existing)
    const run = () => {
      api
        .saveEntry({
          id: entry.id,
          date: entry.date,
          start: entry.start,
          end: entry.end,
          ticketKey: entry.ticketKey,
          summary: entry.summary,
          sortOrder,
        })
        .catch((e) => setError(`Save failed: ${(e as Error).message}`))
      saveTimers.current.delete(entry.id)
    }
    if (immediate) run()
    else saveTimers.current.set(entry.id, setTimeout(run, 600))
  }

  function patchEntry(id: string, patch: Partial<Entry>) {
    const d = dayRef.current
    if (!d) return
    const entries = d.entries.map((e) => (e.id === id ? { ...e, ...patch } : e))
    const idx = entries.findIndex((e) => e.id === id)
    setDay({ ...d, entries })
    persistEntry(entries[idx], idx)
  }

  function addEntry() {
    const d = dayRef.current
    if (!d) return
    const last = d.entries[d.entries.length - 1]
    const startMin = last ? (parseTime(last.end) ?? 9 * 60) : 9 * 60
    const entry: Entry = {
      id: crypto.randomUUID(),
      date: d.date,
      start: minutesToHHmm(startMin),
      end: minutesToHHmm(startMin + 30),
      ticketKey: '',
      summary: '',
      tempoWorklogId: null,
      syncedAt: null,
    }
    const entries = [...d.entries, entry]
    setDay({ ...d, entries })
    persistEntry(entry, entries.length - 1, true)
  }

  function deleteEntry(id: string) {
    const d = dayRef.current
    if (!d) return
    const t = saveTimers.current.get(id)
    if (t) {
      clearTimeout(t)
      saveTimers.current.delete(id)
    }
    setDay({ ...d, entries: d.entries.filter((e) => e.id !== id) })
    api.deleteEntry(id).catch((e) => setError(`Delete failed: ${(e as Error).message}`))
  }

  function onNotesChange(notes: string) {
    const d = dayRef.current
    if (!d) return
    setDay({ ...d, notes })
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => {
      api.saveNotes(d.date, notes).catch((e) => setError(`Notes save failed: ${(e as Error).message}`))
    }, 700)
  }

  async function handlePush() {
    setPushing(true)
    setError(null)
    setPlan(null)
    try {
      const summary = await api.pushDay(date)
      setPushResult(summary)
      setDay(await api.getDay(date)) // refresh so synced entries show their badge
    } catch (e) {
      setError(`Push failed: ${(e as Error).message}`)
    } finally {
      setPushing(false)
    }
  }

  async function handleDryRun() {
    setPushing(true)
    setError(null)
    setPushResult(null)
    try {
      setPlan(await api.dryRunDay(date))
    } catch (e) {
      setError(`Dry run failed: ${(e as Error).message}`)
    } finally {
      setPushing(false)
    }
  }

  const entries = day?.entries ?? []
  const config = toValidationConfig(settings)
  const allIssues = validateDay(entries, config)
  const issuesByEntry = new Map<string, ValidationIssue[]>()
  const dayIssues: ValidationIssue[] = []
  for (const iss of allIssues) {
    if (iss.entryId) {
      const arr = issuesByEntry.get(iss.entryId) ?? []
      arr.push(iss)
      issuesByEntry.set(iss.entryId, arr)
    } else {
      dayIssues.push(iss)
    }
  }
  const totalMinutes = entries.reduce((sum, e) => {
    const d = entryDurationMinutes(e)
    return sum + (d && d > 0 ? d : 0)
  }, 0)
  const errorCount = allIssues.filter((i) => i.level === 'error').length
  const warningCount = allIssues.filter((i) => i.level === 'warning').length
  const unsyncedCount = entries.filter((e) => !e.tempoWorklogId).length
  const syncedCount = entries.length - unsyncedCount
  const pushDisabled = pushing || errorCount > 0 || unsyncedCount === 0
  const pushLabel = pushing
    ? 'Pushing…'
    : errorCount > 0
      ? `Fix ${errorCount} error${errorCount > 1 ? 's' : ''} to push`
      : unsyncedCount === 0
        ? entries.length
          ? 'All synced ✓'
          : 'Push day to Tempo'
        : `Push ${unsyncedCount} to Tempo`
  const minDayMinutes = Math.round(config.minDayHours * 60)
  const maxDayMinutes = Math.round(config.maxDayHours * 60)
  const belowTarget = totalMinutes < minDayMinutes
  const aboveTarget = totalMinutes > maxDayMinutes
  const remainingToMinMinutes = Math.max(0, minDayMinutes - totalMinutes)
  const overMaxMinutes = Math.max(0, totalMinutes - maxDayMinutes)
  const targetLabel = belowTarget
    ? `${formatHours(remainingToMinMinutes)} short of target`
    : aboveTarget
      ? `${formatHours(overMaxMinutes)} over target`
      : `Within target range ${formatHours(minDayMinutes)}-${formatHours(maxDayMinutes)}`
  const summaryTone = errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : syncedCount === entries.length && entries.length > 0 ? 'success' : 'info'
  const statusLabel = errorCount > 0
    ? 'Needs fixes'
    : pushing
      ? 'Pushing…'
      : unsyncedCount === 0
        ? entries.length
          ? 'All synced'
          : 'No entries yet'
        : warningCount > 0
          ? 'Ready with warnings'
          : 'Ready to push'

  function gapBefore(i: number): number | null {
    if (i === 0) return null
    const prevEnd = parseTime(entries[i - 1].end)
    const curStart = parseTime(entries[i].start)
    if (prevEnd === null || curStart === null) return null
    return curStart - prevEnd > 0 ? curStart - prevEnd : null
  }

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
        <Container maxWidth="lg" sx={{ py: 3, pb: 8 }}>
          <Box
            component="header"
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 2,
              flexWrap: 'wrap',
              mb: 2,
            }}
          >
            <Box>
              <Typography variant="h5" component="h1">
                Timesheet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {profile ? `${profile.displayName} · ${profile.timeZone}` : 'not connected to Jira'}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <IconButton
                size="small"
                onClick={() => setDate(addDays(date, -1))}
                title="Previous day"
                aria-label="Previous day"
              >
                <ChevronLeftIcon />
              </IconButton>
              <DatePicker
                value={dayjs(date)}
                onChange={(newValue) => setDate(newValue?.format('YYYY-MM-DD') || date)}
              />
              <IconButton
                size="small"
                onClick={() => setDate(addDays(date, 1))}
                title="Next day"
                aria-label="Next day"
              >
                <ChevronRightIcon />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => setDate(todayISO())}
                title="Today"
                aria-label="Today"
              >
                <TodayIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => setShowSettings(true)}
                title="Settings"
                aria-label="Settings"
              >
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Box>

          {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

          <Box
            component="main"
            sx={{
              display: 'flex',
              gap: 2.5,
              alignItems: 'flex-start',
              flexDirection: { xs: 'column', md: 'row' },
            }}
          >
            <Box component="section" sx={{ flex: { xs: '1 1 auto', md: '2.35 1 0' }, minWidth: 0, width: '100%' }}>
              <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 1.25 }}>
                <Typography variant="h6" component="h2">
                  {prettyDate(date)}
                </Typography>
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                    color: dayIssues.length ? 'warning.main' : 'text.secondary',
                  }}
                >
                  {formatHours(totalMinutes)}
                </Typography>
              </Stack>

              <Paper
                variant="outlined"
                sx={{
                  mb: 1.5,
                  p: 1.25,
                  borderColor:
                    summaryTone === 'error'
                      ? 'error.main'
                      : summaryTone === 'warning'
                        ? 'warning.main'
                        : summaryTone === 'success'
                          ? 'success.main'
                          : 'divider',
                }}
              >
                <Stack spacing={1}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}
                  >
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        Day health
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {targetLabel}
                      </Typography>
                    </Box>
                    <Chip
                      label={statusLabel}
                      color={summaryTone === 'info' ? 'default' : summaryTone}
                      variant={summaryTone === 'success' ? 'filled' : 'outlined'}
                      size="small"
                    />
                  </Stack>

                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <Chip label={`${formatHours(totalMinutes)} logged`} size="small" variant="outlined" />
                    <Chip
                      label={`${syncedCount}/${entries.length} synced`}
                      size="small"
                      color={syncedCount > 0 ? 'success' : 'default'}
                      variant="outlined"
                    />
                    <Chip
                      label={`${unsyncedCount} unsynced`}
                      size="small"
                      color={unsyncedCount > 0 ? 'primary' : 'default'}
                      variant="outlined"
                    />
                    <Chip
                      label={`${errorCount} error${errorCount === 1 ? '' : 's'}`}
                      size="small"
                      color={errorCount > 0 ? 'error' : 'default'}
                      variant="outlined"
                    />
                    <Chip
                      label={`${warningCount} warning${warningCount === 1 ? '' : 's'}`}
                      size="small"
                      color={warningCount > 0 ? 'warning' : 'default'}
                      variant="outlined"
                    />
                  </Stack>
                </Stack>
              </Paper>

              {loading ? (
                <Typography variant="body2" color="text.secondary">Loading…</Typography>
              ) : (
                <>
                  {entries.map((entry, i) => (
                    <div key={entry.id}>
                      {gapBefore(i) !== null && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          align="center"
                          sx={{ display: 'block', py: 0.25 }}
                        >
                          gap · {formatHours(gapBefore(i) as number)}
                        </Typography>
                      )}
                      <EntryRow
                        entry={entry}
                        issues={issuesByEntry.get(entry.id) ?? []}
                        adminTicket={config.adminTicket}
                        onPatch={(patch) => patchEntry(entry.id, patch)}
                        onDelete={() => deleteEntry(entry.id)}
                      />
                    </div>
                  ))}

                  {entries.length === 0 && <Typography variant="body2" color="text.secondary">No entries yet.</Typography>}

                  <Button variant="outlined" onClick={addEntry} sx={{ mt: 0.5, width: '100%' }}>
                    + Add entry
                  </Button>

                  {dayIssues.length > 0 && (
                    <Stack spacing={1} sx={{ mt: 1.5 }}>
                      {dayIssues.map((i, idx) => (
                        <Alert key={idx} severity={i.level === 'error' ? 'error' : 'warning'}>
                          {i.message}
                        </Alert>
                      ))}
                    </Stack>
                  )}
                </>
              )}
            </Box>

            <Box
              component="aside"
              sx={{
                flex: '1 1 0',
                minWidth: { xs: '100%', md: 220 },
                maxWidth: { xs: '100%', md: 320 },
                width: '100%',
                position: { xs: 'static', md: 'sticky' },
                top: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                Notes · not sent to Tempo
              </Typography>
              <TextField
                multiline
                minRows={14}
                value={day?.notes ?? ''}
                placeholder="Freeform notes, questions, links…"
                onChange={(e) => onNotesChange(e.target.value)}
                sx={{ width: '100%' }}
              />
              <Stack spacing={1} sx={{ mt: 0.5 }}>
                <Button
                  variant="outlined"
                  fullWidth
                  disabled={pushing || unsyncedCount === 0}
                  onClick={handleDryRun}
                  title="Preview the exact requests without sending anything (also printed to the server console)"
                >
                  Dry run — preview payload
                </Button>
                <Button
                  variant="contained"
                  fullWidth
                  disabled={pushDisabled}
                  onClick={handlePush}
                  title="Push this day's unsynced entries to Tempo"
                >
                  {pushLabel}
                </Button>
              </Stack>

              {plan &&
                (plan.blocked.length > 0 ? (
                  <Alert severity="error" sx={{ mt: 1.5 }}>Blocked — fix first: {plan.blocked.join('; ')}</Alert>
                ) : (
                  <Paper variant="outlined" sx={{ mt: 1.5, p: 1.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Dry run — {plan.planned.length} request{plan.planned.length === 1 ? '' : 's'} would
                      be sent
                      {plan.skipped ? `, ${plan.skipped} already synced` : ''}. Nothing was sent; auth
                      token redacted.
                    </Typography>
                    {plan.planned.map((p) => (
                      <Box
                        key={p.entryId}
                        component="pre"
                        sx={{
                          m: 0,
                          mb: 1,
                          p: 1,
                          borderRadius: 1,
                          border: 1,
                          borderColor: 'divider',
                          backgroundColor: 'background.default',
                          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                          fontSize: '0.75rem',
                          lineHeight: 1.45,
                          overflowX: 'auto',
                          whiteSpace: 'pre',
                        }}
                      >
                        {`${p.request.method} ${p.request.url}\nheaders: ${JSON.stringify(
                          p.request.headers,
                          null,
                          2,
                        )}\nbody: ${JSON.stringify(p.request.body, null, 2)}`}
                      </Box>
                    ))}
                    {plan.planned.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        Nothing to push (all synced, or no entries).
                      </Typography>
                    )}
                  </Paper>
                ))}

              {pushResult && (
                <Alert
                  severity={pushResult.failed || pushResult.blocked.length ? 'error' : 'success'}
                  sx={{ mt: 1.5 }}
                >
                  {pushResult.blocked.length > 0 ? (
                    <div>Blocked — fix first: {pushResult.blocked.join('; ')}</div>
                  ) : (
                    <div>
                      Synced {pushResult.synced}
                      {pushResult.skipped ? `, skipped ${pushResult.skipped} already logged` : ''}
                      {pushResult.failed ? `, ${pushResult.failed} failed` : ''}.
                    </div>
                  )}
                  {pushResult.results.some((r) => !r.ok) && (
                    <Stack spacing={0.5} sx={{ mt: 1 }}>
                      {pushResult.results
                        .filter((r) => !r.ok)
                        .map((r) => (
                          <Typography key={r.entryId} variant="body2" color="error">
                            {r.ticketKey}: {r.error}
                          </Typography>
                        ))}
                    </Stack>
                  )}
                </Alert>
              )}
            </Box>
          </Box>
        </Container>
      </LocalizationProvider>
    </ThemeProvider>
  )
}
