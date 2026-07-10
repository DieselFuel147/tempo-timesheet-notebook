import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { config, assertConfigured } from './config'
import { buildClients } from './factory'

const here = dirname(fileURLToPath(import.meta.url))

const app = Fastify({ logger: false })

app.get('/api/health', async () => ({ ok: true }))

// Verifies Jira credentials and returns the signed-in user.
app.get('/api/profile', async (_req, reply) => {
  try {
    assertConfigured()
    const { jira } = buildClients()
    return await jira.myself()
  } catch (err) {
    reply.code(500)
    return { error: (err as Error).message }
  }
})

// Serve the built React app when it exists (after `npm run build`).
const dist = join(here, '..', 'dist')
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      reply.code(404).send({ error: 'Not found' })
      return
    }
    reply.sendFile('index.html')
  })
}

app
  .listen({ port: config.port, host: '127.0.0.1' })
  .then(() => console.log(`API listening on http://127.0.0.1:${config.port}`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
