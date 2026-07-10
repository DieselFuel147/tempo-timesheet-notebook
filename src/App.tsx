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
    api.getSettings().then(setSettings).catch(() => setSettings(defaultSettings))
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
  const unsyncedCount = entries.filter((e) => !e.tempoWorklogId).length
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

  function gapBefore(i: number): number | null {
    if (i === 0) return null
    const prevEnd = parseTime(entries[i - 1].end)
    const curStart = parseTime(entries[i].start)
    if (prevEnd === null || curStart === null) return null
    return curStart - prevEnd > 0 ? curStart - prevEnd : null
  }

  if (showSettings) {
    return (
      <div className="page">
        <Settings settings={settings} onSaved={setSettings} onClose={() => setShowSettings(false)} />
      </div>
    )
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <h1>Timesheet</h1>
          <span className="whoami">
            {profile ? `${profile.displayName} · ${profile.timeZone}` : 'not connected to Jira'}
          </span>
        </div>
        <div className="datenav">
          <button type="button" onClick={() => setDate(addDays(date, -1))} title="Previous day">
            ◀
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="button" onClick={() => setDate(addDays(date, 1))} title="Next day">
            ▶
          </button>
          <button type="button" className="today-btn" onClick={() => setDate(todayISO())}>
            Today
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon fontSize="small" />
          </button>
        </div>
      </header>

      {error && <div className="banner error-banner">{error}</div>}

      <main className="layout">
        <section className="entries-pane">
          <div className="day-heading">
            <h2>{prettyDate(date)}</h2>
            <span className={dayIssues.length ? 'total warn' : 'total'}>{formatHours(totalMinutes)}</span>
          </div>

          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              {entries.map((entry, i) => (
                <div key={entry.id}>
                  {gapBefore(i) !== null && (
                    <div className="gap">gap · {formatHours(gapBefore(i) as number)}</div>
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

              {entries.length === 0 && <p className="muted">No entries yet.</p>}

              <button type="button" className="add-btn" onClick={addEntry}>
                + Add entry
              </button>

              {dayIssues.length > 0 && (
                <ul className="day-issues">
                  {dayIssues.map((i, idx) => (
                    <li key={idx} className={i.level}>
                      ⚠️ {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <aside className="notes-pane">
          <label className="notes-label">Notes · not sent to Tempo</label>
          <textarea
            className="notes"
            value={day?.notes ?? ''}
            placeholder="Freeform notes, questions, links…"
            onChange={(e) => onNotesChange(e.target.value)}
          />
          <button
            type="button"
            className="dryrun-btn"
            disabled={pushing || unsyncedCount === 0}
            onClick={handleDryRun}
            title="Preview the exact requests without sending anything (also printed to the server console)"
          >
            Dry run — preview payload
          </button>
          <button
            type="button"
            className="push-btn"
            disabled={pushDisabled}
            onClick={handlePush}
            title="Push this day's unsynced entries to Tempo"
          >
            {pushLabel}
          </button>

          {plan &&
            (plan.blocked.length > 0 ? (
              <div className="banner error-banner">Blocked — fix first: {plan.blocked.join('; ')}</div>
            ) : (
              <div className="plan">
                <div className="plan-head">
                  Dry run — {plan.planned.length} request{plan.planned.length === 1 ? '' : 's'} would
                  be sent
                  {plan.skipped ? `, ${plan.skipped} already synced` : ''}. Nothing was sent; auth
                  token redacted.
                </div>
                {plan.planned.map((p) => (
                  <pre key={p.entryId} className="plan-req">
                    {`${p.request.method} ${p.request.url}\nheaders: ${JSON.stringify(
                      p.request.headers,
                      null,
                      2,
                    )}\nbody: ${JSON.stringify(p.request.body, null, 2)}`}
                  </pre>
                ))}
                {plan.planned.length === 0 && (
                  <div className="muted">Nothing to push (all synced, or no entries).</div>
                )}
              </div>
            ))}

          {pushResult && (
            <div
              className={
                pushResult.failed || pushResult.blocked.length
                  ? 'banner error-banner'
                  : 'banner ok-banner'
              }
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
              {pushResult.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <div key={r.entryId} className="push-fail">
                    {r.ticketKey}: {r.error}
                  </div>
                ))}
            </div>
          )}
        </aside>
      </main>
    </div>
  )
}
