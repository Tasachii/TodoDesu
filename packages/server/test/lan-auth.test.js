import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db/index.js'
import { buildApp } from '../src/app.js'

// Optional LAN auth (B3/D6): when bound to a non-loopback host with a
// TODOO_TOKEN, mutating routes require a matching bearer token. Loopback (the
// default everywhere else, including e2e) is intentionally never gated.

const lanApp = (token = 'secret') =>
  buildApp({ db: openDb(':memory:'), host: '0.0.0.0', token })

describe('LAN auth — non-loopback host with a token', () => {
  it('rejects a write with no Authorization header (401)', async () => {
    const app = lanApp()
    const res = await app.inject({ method: 'POST', url: '/api/tasks', body: { title: 'x' } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('rejects a write with the wrong token', async () => {
    const app = lanApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: 'Bearer nope' },
      body: { title: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('accepts a write with the correct bearer token', async () => {
    const app = lanApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: 'Bearer secret' },
      body: { title: 'authorized' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().task.title).toBe('authorized')
  })

  it('leaves GET reads open (no token required)', async () => {
    const app = lanApp()
    const res = await app.inject({ method: 'GET', url: '/api/tasks' })
    expect(res.statusCode).toBe(200)
  })

  it('leaves the health check open', async () => {
    const app = lanApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
  })

  it('guards every mutating verb (DELETE)', async () => {
    const app = lanApp()
    // seed via an authorized request, then try an unauthorized delete
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: 'Bearer secret' },
      body: { title: 'g' },
    })
    const id = created.json().task.id
    const res = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}` })
    expect(res.statusCode).toBe(401)
  })
})

describe('LAN auth — not engaged by default', () => {
  it('does not gate writes on loopback even when a token is set', async () => {
    const app = buildApp({ db: openDb(':memory:'), host: '127.0.0.1', token: 'secret' })
    const res = await app.inject({ method: 'POST', url: '/api/tasks', body: { title: 'open' } })
    expect(res.statusCode).toBe(201)
  })

  it('does not gate writes on a non-loopback host when no token is configured', async () => {
    const app = buildApp({ db: openDb(':memory:'), host: '0.0.0.0', token: null })
    const res = await app.inject({ method: 'POST', url: '/api/tasks', body: { title: 'open' } })
    expect(res.statusCode).toBe(201)
  })
})
