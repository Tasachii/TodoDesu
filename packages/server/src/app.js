import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tasksRoutes from './routes/tasks.js'
import focusRoutes from './routes/focus.js'
import statsRoutes from './routes/stats.js'
import settingsRoutes from './routes/settings.js'
import backupRoutes from './routes/backup.js'

export const VERSION = '0.1.0'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export function buildApp({
  db,
  logger = false,
  now = () => new Date(),
  host = '127.0.0.1',
  token = process.env.TODOO_TOKEN || null,
} = {}) {
  const app = Fastify({
    logger,
    // Fastify's default Ajv strips unknown body fields silently
    // (removeAdditional). Reject them instead so client typos surface
    // as 400 VALIDATION rather than data quietly not being saved.
    // customOptions is merged over Fastify's defaults, so only override this key.
    ajv: { customOptions: { removeAdditional: false } },
  })
  app.decorate('db', db)
  // Injectable clock so recurrence/focus-stop logic can be driven with a fixed
  // time in tests; defaults to the real wall clock in production.
  app.decorate('now', now)

  // Optional LAN auth: when bound to a non-loopback host AND TODOO_TOKEN is set,
  // require a matching bearer token on mutating API routes. Loopback (the
  // default, and what the tests/e2e use) is never gated, so behavior there is
  // unchanged. GET stays open so the SPA and read-only views keep working.
  const guardLan = token && !LOOPBACK_HOSTS.has(host)
  if (guardLan) {
    const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api/') || !MUTATING.has(req.method)) return
      const auth = req.headers.authorization || ''
      const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null
      if (provided !== token) {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } })
      }
    })
  }

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: { code: 'VALIDATION', message: err.message } })
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    if (status >= 500) req.log.error(err)
    // Malformed requests (bad/empty JSON bodies, unsupported content types)
    // are client errors, not server faults.
    const code = status >= 500 ? 'INTERNAL' : 'VALIDATION'
    reply.code(status).send({ error: { code, message: err.message } })
  })

  app.get('/api/health', async () => ({ ok: true, version: VERSION }))

  app.register(tasksRoutes)
  app.register(focusRoutes)
  app.register(statsRoutes)
  app.register(settingsRoutes)
  app.register(backupRoutes)

  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url))
  const hasWebBuild = existsSync(webDist)
  if (hasWebBuild) {
    app.register(fastifyStatic, { root: webDist })
  }
  app.setNotFoundHandler((req, reply) => {
    if (!req.url.startsWith('/api/') && hasWebBuild) {
      return reply.sendFile('index.html') // SPA fallback for client-side routes
    }
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } })
  })

  return app
}
