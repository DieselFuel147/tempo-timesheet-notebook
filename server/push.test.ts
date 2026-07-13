import { describe, it, expect } from 'vitest'
import type { NotebookBlock, NotebookDay, WorklogInput, DryRunSummary, PlannedRequest } from '../shared/types'
import { pushDay, type PushRepo } from './push'
import { defaultSettings } from '../shared/settings'

function block(o: Partial<NotebookBlock>): NotebookBlock {
  return {
    id: o.id ?? 'b1',
    date: '2025-05-09',
    startMinute: 9 * 60,
    endMinute: 9 * 60 + 45,
    text: 'Work',
    closed: true,
    ticketId: 'PEA-777',
    summaryOverride: null,
    tempoWorklogId: null,
    syncedAt: null,
    ...o,
  }
}

function fakeRepo(blocks: NotebookBlock[]) {
  const day: NotebookDay = { date: '2025-05-09', blocks }
  const cache = new Map<string, string>()
  const state = { getSettingsCalls: 0 }
  const repo: PushRepo = {
    getDay: () => day,
    markSynced: (id, wid) => {
      const current = day.blocks.find((x) => x.id === id)
      if (current) current.tempoWorklogId = wid
    },
    getCachedIssueId: (k) => cache.get(k) ?? null,
    cacheIssue: (k, id) => cache.set(k, id),
    getSettings: () => {
      state.getSettingsCalls++
      return defaultSettings
    },
  }
  return { repo, day, state }
}

function fakeClients() {
  const state = { resolveCalls: 0, created: [] as WorklogInput[] }
  const jira = {
    myself: async () => ({ accountId: 'acc-1', displayName: 'Me', timeZone: 'UTC' }),
    resolveIssue: async (key: string) => {
      state.resolveCalls++
      return { id: key === 'PEA-777' ? '111' : '222', key, summary: 'S' }
    },
  }
  const tempo = {
    createWorklog: async (input: WorklogInput) => {
      state.created.push(input)
      return { tempoWorklogId: 900 + state.created.length }
    },
    previewCreateWorklog: async (input: WorklogInput): Promise<PlannedRequest> => ({
      method: 'POST',
      url: 'https://api.tempo.io/4/worklogs',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer SECRET-TOKEN',
      },
      body: input,
    }),
  }
  return { jira, tempo, state }
}

describe('pushDay', () => {
  it('pushes unsynced blocks and marks them synced', async () => {
    const { repo } = fakeRepo([
      block({ id: 'a', startMinute: 9 * 60, endMinute: 9 * 60 + 30 }),
      block({ id: 'b', ticketId: 'REACT-1', startMinute: 9 * 60 + 30, endMinute: 10 * 60 }),
    ])
    const { jira, tempo, state } = fakeClients()
    const res = await pushDay('2025-05-09', jira, tempo, repo)
    expect(res.synced).toBe(2)
    expect(res.failed).toBe(0)
    expect(state.created).toHaveLength(2)
    expect(state.created[0]).toMatchObject({ issueId: 111, authorAccountId: 'acc-1' })
  })

  it('skips already-synced blocks (idempotent re-push)', async () => {
    const { repo } = fakeRepo([
      block({ id: 'a', tempoWorklogId: 555, startMinute: 9 * 60, endMinute: 9 * 60 + 30 }),
      block({ id: 'b', ticketId: 'REACT-1', startMinute: 9 * 60 + 30, endMinute: 10 * 60 }),
    ])
    const { jira, tempo, state } = fakeClients()
    const res = await pushDay('2025-05-09', jira, tempo, repo)
    expect(res.synced).toBe(1)
    expect(res.skipped).toBe(1)
    expect(state.created).toHaveLength(1)
    expect(state.created[0].issueId).toBe(222) // only entry b
  })

  it('blocks the whole push when any block is invalid', async () => {
    const { repo } = fakeRepo([block({ id: 'a', ticketId: 'not a ticket' })])
    const { jira, tempo, state } = fakeClients()
    const res = await pushDay('2025-05-09', jira, tempo, repo)
    expect(res.blocked.length).toBeGreaterThan(0)
    expect(res.synced).toBe(0)
    expect(state.created).toHaveLength(0) // nothing sent
  })

  it('resolves each distinct ticket only once (caching)', async () => {
    const { repo } = fakeRepo([
      block({ id: 'a', startMinute: 9 * 60, endMinute: 9 * 60 + 30 }),
      block({ id: 'b', startMinute: 9 * 60 + 30, endMinute: 10 * 60 }),
    ]) // both PEA-777
    const { jira, tempo, state } = fakeClients()
    await pushDay('2025-05-09', jira, tempo, repo)
    expect(state.resolveCalls).toBe(1)
  })

  it('dry run builds requests, sends nothing, and redacts the auth token', async () => {
    const { repo } = fakeRepo([block({ id: 'a', startMinute: 9 * 60, endMinute: 9 * 60 + 30 })])
    const { jira, tempo, state } = fakeClients()
    const res = await pushDay('2025-05-09', jira, tempo, repo, { dryRun: true })
    expect('dryRun' in res && res.dryRun).toBe(true)
    const dry = res as DryRunSummary
    expect(dry.planned).toHaveLength(1)
    expect(dry.planned[0].request.body).toMatchObject({ issueId: 111, authorAccountId: 'acc-1' })
    expect(dry.planned[0].request.headers.Authorization).toBe('Bearer <redacted>')
    expect(state.created).toHaveLength(0) // nothing was sent
  })

  it('dry run still blocks (sends nothing) when a block is invalid', async () => {
    const { repo } = fakeRepo([block({ id: 'a', ticketId: 'nope' })])
    const { jira, tempo, state } = fakeClients()
    const res = (await pushDay('2025-05-09', jira, tempo, repo, { dryRun: true })) as DryRunSummary
    expect(res.blocked.length).toBeGreaterThan(0)
    expect(res.planned).toHaveLength(0)
    expect(state.created).toHaveLength(0)
  })

  it('validates against the stored settings (single source of validation config)', async () => {
    const { repo, state } = fakeRepo([block({ id: 'a', startMinute: 9 * 60, endMinute: 9 * 60 + 30 })])
    const { jira, tempo } = fakeClients()
    await pushDay('2025-05-09', jira, tempo, repo)
    expect(state.getSettingsCalls).toBeGreaterThan(0)
  })

  it('records a per-block error without aborting the rest', async () => {
    const { repo } = fakeRepo([
      block({ id: 'a', startMinute: 9 * 60, endMinute: 9 * 60 + 30 }),
      block({ id: 'b', startMinute: 9 * 60 + 30, endMinute: 10 * 60, ticketId: 'REACT-1' }),
    ])
    const { jira } = fakeClients()
    let n = 0
    const tempo = {
      createWorklog: async (_input: WorklogInput) => {
        n++
        if (n === 1) throw new Error('Tempo 400: account attribute required')
        return { tempoWorklogId: 42 }
      },
      previewCreateWorklog: async (): Promise<PlannedRequest> => ({
        method: 'POST',
        url: '',
        headers: {},
        body: {},
      }),
    }
    const res = await pushDay('2025-05-09', jira, tempo, repo)
    expect(res.synced).toBe(1)
    expect(res.failed).toBe(1)
    expect(res.results.find((r) => !r.ok)?.error).toMatch(/account attribute/i)
  })

  it('ignores open draft blocks when counting pushable work', async () => {
    const { repo } = fakeRepo([
      block({ id: 'a', ticketId: 'PEA-777', text: 'Completed notebook block' }),
      block({
        id: 'draft',
        startMinute: null,
        endMinute: null,
        closed: false,
        text: 'Draft note',
        ticketId: '',
      }),
    ])
    const { jira, tempo } = fakeClients()
    const res = (await pushDay('2025-05-09', jira, tempo, repo, { dryRun: true })) as DryRunSummary
    expect(res.planned).toHaveLength(1)
    expect(res.skipped).toBe(0)
  })
})
