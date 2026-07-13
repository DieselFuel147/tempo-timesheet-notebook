import type {
  NotebookBlock,
  NotebookDay,
  JiraProfile,
  JiraIssueRef,
  WorklogInput,
  BlockPushResult,
  PushSummary,
  PlannedRequest,
  PlannedWorklog,
  DryRunSummary,
} from '../shared/types'
import { notebookBlockSummary, notebookBlockToWorklogInput } from '../shared/notebook'
import { validateNotebookDay } from '../shared/validation'
import { defaultSettings, toValidationConfig, type Settings } from '../shared/settings'
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
  getDay(date: string): NotebookDay
  markSynced(id: string, tempoWorklogId: number): void
  getCachedIssueId(key: string): string | null
  cacheIssue(key: string, issueId: string, summary: string): void
  /** Stored validation config; optional so lightweight fakes can omit it. */
  getSettings?(): Settings
}

const defaultPushRepo: PushRepo = {
  getDay: realRepo.getNotebookDay,
  markSynced: realRepo.markSynced,
  getCachedIssueId: realRepo.getCachedIssueId,
  cacheIssue: realRepo.cacheIssue,
  getSettings: realRepo.getSettings,
}

/**
 * Push a notebook day to Tempo. Idempotent: blocks that already carry a
 * tempoWorklogId are skipped, so re-running never double-logs. The whole push
 * is blocked (nothing sent) if any block has a validation error.
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
  repo: PushRepo = defaultPushRepo,
  opts: { dryRun?: boolean } = {},
): Promise<PushSummary | DryRunSummary> {
  const dryRun = opts.dryRun ?? false
  const day = repo.getDay(date)
  const pushable = day.blocks.filter(isPushableBlock)

  // Gate against the user's stored config, so the server validates with exactly
  // the same rules the UI shows. (Falls back to defaults for bare fakes.)
  const config = toValidationConfig(repo.getSettings?.() ?? defaultSettings)
  const errors = validateNotebookDay(pushable, config).filter((i) => i.level === 'error')
  if (errors.length > 0) {
    const blocked = errors.map((e) => e.message)
    return dryRun
      ? { dryRun: true, planned: [], skipped: 0, blocked }
      : { results: [], synced: 0, failed: 0, skipped: 0, blocked }
  }

  const unsynced = pushable.filter((block) => !block.tempoWorklogId)
  const skipped = pushable.length - unsynced.length

  // Dry run: build the exact requests, print them, send nothing.
  if (dryRun) {
    const me = await jira.myself()
    const planned: PlannedWorklog[] = []
    for (const block of unsynced) {
      const issueId = await resolveIssueId(block.ticketId, jira, repo)
      const input = notebookBlockToWorklogInput(block, Number(issueId), me.accountId)
      const request = await tempo.previewCreateWorklog(input)
      request.headers = redactAuth(request.headers)
      planned.push({ blockId: block.id, ticketId: block.ticketId, issueId: Number(issueId), request })
    }
    logPlanned(date, planned, skipped)
    return { dryRun: true, planned, skipped, blocked: [] }
  }

  if (unsynced.length === 0) {
    return { results: [], synced: 0, failed: 0, skipped, blocked: [] }
  }

  const me = await jira.myself()
  const results: BlockPushResult[] = []

  for (const block of unsynced) {
    try {
      const issueId = await resolveIssueId(block.ticketId, jira, repo)
      const input = notebookBlockToWorklogInput(block, Number(issueId), me.accountId)
      const created = await tempo.createWorklog(input)
      repo.markSynced(block.id, created.tempoWorklogId)
      results.push({
        blockId: block.id,
        ticketId: block.ticketId,
        ok: true,
        tempoWorklogId: created.tempoWorklogId,
      })
    } catch (err) {
      results.push({
        blockId: block.id,
        ticketId: block.ticketId,
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

function isPushableBlock(block: NotebookBlock): boolean {
  return block.closed && block.startMinute !== null && block.endMinute !== null && notebookBlockSummary(block).trim().length > 0
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
    console.log(`\n• ${p.ticketId} (issueId ${p.issueId})  [block ${p.blockId}]`)
    console.log(`  ${p.request.method} ${p.request.url}`)
    console.log(`  headers: ${JSON.stringify(p.request.headers)}`)
    console.log(`  body:    ${JSON.stringify(p.request.body)}`)
  }
  console.log('\n=== end dry run ===\n')
}
