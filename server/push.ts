import type {
  Day,
  JiraProfile,
  JiraIssueRef,
  WorklogInput,
  EntryPushResult,
  PushSummary,
  PlannedRequest,
  PlannedWorklog,
  DryRunSummary,
} from '../shared/types'
import { validateDay } from '../shared/validation'
import { toWorklogInput } from '../shared/worklog'
import * as realRepo from './db/repo'

// Minimal interfaces so this orchestration can be unit-tested with fakes,
// without touching real Jira/Tempo or the database.
interface JiraLike {
  myself(): Promise<JiraProfile>
  resolveIssue(key: string): Promise<JiraIssueRef>
}
interface TempoLike {
  createWorklog(input: WorklogInput): Promise<{ tempoWorklogId: number }>
  previewCreateWorklog(input: WorklogInput): Promise<PlannedRequest>
}
export interface PushRepo {
  getDay(date: string): Day
  markSynced(id: string, tempoWorklogId: number): void
  getCachedIssueId(key: string): string | null
  cacheIssue(key: string, issueId: string, summary: string): void
}

/**
 * Push a day to Tempo. Idempotent: entries that already carry a
 * tempoWorklogId are skipped, so re-running never double-logs. The whole push
 * is blocked (nothing sent) if any entry has a validation error.
 */
export function pushDay(
  date: string,
  jira: JiraLike,
  tempo: TempoLike,
  repo?: PushRepo,
  opts?: { dryRun?: false },
): Promise<PushSummary>
export function pushDay(
  date: string,
  jira: JiraLike,
  tempo: TempoLike,
  repo: PushRepo | undefined,
  opts: { dryRun: true },
): Promise<DryRunSummary>
export async function pushDay(
  date: string,
  jira: JiraLike,
  tempo: TempoLike,
  repo: PushRepo = realRepo,
  opts: { dryRun?: boolean } = {},
): Promise<PushSummary | DryRunSummary> {
  const dryRun = opts.dryRun ?? false
  const day = repo.getDay(date)

  const errors = validateDay(day.entries).filter((i) => i.level === 'error')
  if (errors.length > 0) {
    const blocked = errors.map((e) => e.message)
    return dryRun
      ? { dryRun: true, planned: [], skipped: 0, blocked }
      : { results: [], synced: 0, failed: 0, skipped: 0, blocked }
  }

  const unsynced = day.entries.filter((e) => !e.tempoWorklogId)
  const skipped = day.entries.length - unsynced.length

  // Dry run: build the exact requests, print them, send nothing.
  if (dryRun) {
    const me = await jira.myself()
    const planned: PlannedWorklog[] = []
    for (const entry of unsynced) {
      const issueId = await resolveIssueId(entry.ticketKey, jira, repo)
      const input = toWorklogInput(entry, Number(issueId), me.accountId)
      const request = await tempo.previewCreateWorklog(input)
      request.headers = redactAuth(request.headers)
      planned.push({ entryId: entry.id, ticketKey: entry.ticketKey, issueId: Number(issueId), request })
    }
    logPlanned(date, planned, skipped)
    return { dryRun: true, planned, skipped, blocked: [] }
  }

  if (unsynced.length === 0) {
    return { results: [], synced: 0, failed: 0, skipped, blocked: [] }
  }

  const me = await jira.myself()
  const results: EntryPushResult[] = []

  for (const entry of unsynced) {
    try {
      const issueId = await resolveIssueId(entry.ticketKey, jira, repo)
      const input = toWorklogInput(entry, Number(issueId), me.accountId)
      const created = await tempo.createWorklog(input)
      repo.markSynced(entry.id, created.tempoWorklogId)
      results.push({
        entryId: entry.id,
        ticketKey: entry.ticketKey,
        ok: true,
        tempoWorklogId: created.tempoWorklogId,
      })
    } catch (err) {
      results.push({
        entryId: entry.id,
        ticketKey: entry.ticketKey,
        ok: false,
        error: (err as Error).message,
      })
    }
  }

  return {
    results,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped,
    blocked: [],
  }
}

async function resolveIssueId(key: string, jira: JiraLike, repo: PushRepo): Promise<string> {
  const cached = repo.getCachedIssueId(key)
  if (cached) return cached
  const issue = await jira.resolveIssue(key)
  repo.cacheIssue(issue.key, issue.id, issue.summary)
  return issue.id
}

/** Replace the auth token value with a placeholder so it never leaks to console/UI. */
function redactAuth(headers: Record<string, string>): Record<string, string> {
  const out = { ...headers }
  if (out.Authorization) {
    const scheme = out.Authorization.split(' ')[0]
    out.Authorization = `${scheme} <redacted>`
  }
  return out
}

function logPlanned(date: string, planned: PlannedWorklog[], skipped: number): void {
  console.log(
    `\n=== DRY RUN: ${date} — ${planned.length} worklog(s) would be sent, ${skipped} already synced (nothing sent) ===`,
  )
  for (const p of planned) {
    console.log(`\n• ${p.ticketKey} (issueId ${p.issueId})  [entry ${p.entryId}]`)
    console.log(`  ${p.request.method} ${p.request.url}`)
    console.log(`  headers: ${JSON.stringify(p.request.headers)}`)
    console.log(`  body:    ${JSON.stringify(p.request.body)}`)
  }
  console.log('\n=== end dry run ===\n')
}
