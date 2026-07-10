import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assertConfigured } from './config'
import type { JiraClient } from './jira/client'
import type { TempoClient } from './tempo/client'
import * as repo from './db/repo'
import { pushDay } from './push'

export interface RouteDeps {
  jira: JiraClient
  tempo: TempoClient
}

const dateParam = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
const notesBody = z.object({ notes: z.string() })
const entryBody = z.object({
  id: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string(),
  end: z.string(),
  ticketKey: z.string(),
  summary: z.string(),
  sortOrder: z.number().optional(),
})

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/health', async () => ({ ok: true }))

  // Verifies Jira credentials and returns the signed-in user.
  app.get('/api/profile', async (_req, reply) => {
    try {
      assertConfigured()
      return await deps.jira.myself()
    } catch (err) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  app.get('/api/day/:date', async (req) => {
    const { date } = dateParam.parse(req.params)
    return repo.getDay(date)
  })

  app.put('/api/day/:date/notes', async (req) => {
    const { date } = dateParam.parse(req.params)
    const { notes } = notesBody.parse(req.body)
    repo.saveNotes(date, notes)
    return { ok: true }
  })

  app.post('/api/entry', async (req) => {
    const input = entryBody.parse(req.body)
    return repo.upsertEntry(input)
  })

  app.delete('/api/entry/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    repo.deleteEntry(id)
    return { ok: true }
  })

  app.get('/api/dates', async () => repo.listDates())

  // Push a whole day to Tempo. Idempotent — already-synced entries are skipped.
  // ?dryRun=true builds and returns the requests without sending anything.
  app.post('/api/day/:date/push', async (req, reply) => {
    const { date } = dateParam.parse(req.params)
    const { dryRun } = z.object({ dryRun: z.string().optional() }).parse(req.query)
    try {
      assertConfigured()
      return dryRun === 'true'
        ? await pushDay(date, deps.jira, deps.tempo, undefined, { dryRun: true })
        : await pushDay(date, deps.jira, deps.tempo)
    } catch (err) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  // Ticket autocomplete. Empty query returns recent issues.
  app.get('/api/tickets', async (req, reply) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query)
    try {
      assertConfigured()
      return await deps.jira.pickIssues(q ?? '')
    } catch (err) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })
}
