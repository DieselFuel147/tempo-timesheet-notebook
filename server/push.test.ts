import { describe, it, expect } from 'vitest'
import type { Day, Entry, WorklogInput, DryRunSummary, PlannedRequest } from '../shared/types'
import { pushDay, type PushRepo } from './push'
import { defaultSettings } from '../shared/settings'

function entry(o: Partial<Entry>): Entry {
  return {
    id: o.id ?? 'e1',
    date: '2025-05-09',
    start: '09:00',
    end: '09:45',
    ticketKey: 'PEA-777',
    summary: 'Work',
    tempoWorklogId: null,
    syncedAt: null,
    ...o,
  }
}

function fakeRepo(entries: Entry[]) {
  const day: Day = { date: '2025-05-09', notes: '', entries }
  const cache = new Map<string, string>()
  const state = { getSettingsCalls: 0 }
  const repo: PushRepo = {
    getDay: () => day,
    markSynced: (id, wid) => {
      const e = day.entries.find((x) => x.id === id)
      if (e) e.tempoWorklogId = wid
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
  it('pushes unsynced entries and marks them synced', async () => {
    const { repo } = fakeRepo([
      entry({ id: 'a', start: '09:00', end: '09:30' }),
      entry({ id: 'b', ticketKey: 'REACT-1', start: '09:30', end: '10:00' }),
    ])
    const { jira, tempo, state } = fakeClients()
    const res = await pushDay('2025-05-09', jira, tempo, repo)
    expect(res.synced).toBe(2)
    expect(res.failed).toBe(0)
    expect(state.created).toHaveLength(2)
    expect(state.created[0]).toMatchObject({ issueId: 111, authorAccountId: 'acc-1' })
  })

  it('skips already-synced entries (idempotent re-push)', async () => {
    const { repo } = fakeRepo([
      entry({ id: 'a', tempoWorklogId: 555, start: '09:00', end: '09:30' }),
      entry({ id: 'b', ticketKey: 'REACT-1', start: '09:30', end: '10:00' }),
    ])
    const { jira, tempo, state } = fakeClients()
    const res = await pushDay('2025-05-09', jira, tempo, repo)
    expect(res.synced).toBe(1)
    expect(res.skipped).toBe(1)
    expect(state.created).toHaveLength(1)
    expect(state.created[0].issueId).toBe(222) // only entry b
  })

  it('blocks the whole push when any entry is invalid', async () => {
    const { repo } = fakeRepo([entry({ id: 'a', ticketKey: 'not a ticket' })])
    const { jira, tempo, state } = fakeClients()
    const res = await pushDay('2025-05-09', jira, tempo, repo)
    expect(res.blocked.length).toBeGreaterThan(0)
    expect(res.synced).toBe(0)
    expect(state.created).toHaveLength(0) // nothing sent
  })

  it('resolves each distinct ticket only once (caching)', async () => {
    const { repo } = fakeRepo([
      entry({ id: 'a', start: '09:00', end: '09:30' }),
      entry({ id: 'b', start: '09:30', end: '10:00' }),
    ]) // both PEA-777
    const { jira, tempo, state } = fakeClients()
    await pushDay('2025-05-09', jira, tempo, repo)
    expect(state.resolveCalls).toBe(1)
  })

  it('dry run builds requests, sends nothing, and redacts the auth token', async () => {
    const { repo } = fakeRepo([entry({ id: 'a', start: '09:00', end: '09:30' })])
    const { jira, tempo, state } = fakeClients()
    const res = await pushDay('2025-05-09', jira, tempo, repo, { dryRun: true })
    expect('dryRun' in res && res.dryRun).toBe(true)
    const dry = res as DryRunSummary
    expect(dry.planned).toHaveLength(1)
    expect(dry.planned[0].request.body).toMatchObject({ issueId: 111, authorAccountId: 'acc-1' })
    expect(dry.planned[0].request.headers.Authorization).toBe('Bearer <redacted>')
    expect(state.created).toHaveLength(0) // nothing was sent
  })

  it('dry run still blocks (sends nothing) when an entry is invalid', async () => {
    const { repo } = fakeRepo([entry({ id: 'a', ticketKey: 'nope' })])
    const { jira, tempo, state } = fakeClients()
    const res = (await pushDay('2025-05-09', jira, tempo, repo, { dryRun: true })) as DryRunSummary
    expect(res.blocked.length).toBeGreaterThan(0)
    expect(res.planned).toHaveLength(0)
    expect(state.created).toHaveLength(0)
  })

  it('validates against the stored settings (single source of validation config)', async () => {
    const { repo, state } = fakeRepo([entry({ id: 'a', start: '09:00', end: '09:30' })])
    const { jira, tempo } = fakeClients()
    await pushDay('2025-05-09', jira, tempo, repo)
    expect(state.getSettingsCalls).toBeGreaterThan(0)
  })

  it('records a per-entry error without aborting the rest', async () => {
    const { repo } = fakeRepo([
      entry({ id: 'a', start: '09:00', end: '09:30' }),
      entry({ id: 'b', start: '09:30', end: '10:00', ticketKey: 'REACT-1' }),
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
})
