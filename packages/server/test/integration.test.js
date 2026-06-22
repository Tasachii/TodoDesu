import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../src/db/index.js'
import { buildApp } from '../src/app.js'

// Coverage for the route/engine paths the original api.test.js leaves open:
// the injectable clock (recurrence + focus-stop), focus edge cases, q-search,
// and the no-op PATCH path.

let app
let clock

beforeEach(() => {
  clock = { at: new Date('2026-06-11T08:00:00.000Z') }
  app = buildApp({ db: openDb(':memory:'), now: () => clock.at })
})

const createTask = async (body) =>
  (await app.inject({ method: 'POST', url: '/api/tasks', body })).json().task

describe('focus stop — backward clock clamp (B2)', () => {
  it('clamps duration_sec to 0 when the clock moves backwards', async () => {
    const start = await app.inject({
      method: 'POST',
      url: '/api/focus/start',
      body: { duration_sec: 1500 },
    })
    const session = start.json().session
    // wind the server clock back an hour before stopping
    clock.at = new Date('2026-06-11T07:00:00.000Z')
    const stop = await app.inject({
      method: 'POST',
      url: `/api/focus/${session.id}/stop`,
      body: { completed: false },
    })
    expect(stop.json().session.duration_sec).toBe(0) // never negative
  })

  it('caps duration_sec at planned_sec when more time elapsed than planned', async () => {
    const start = await app.inject({
      method: 'POST',
      url: '/api/focus/start',
      body: { duration_sec: 60 },
    })
    const session = start.json().session
    clock.at = new Date('2026-06-11T09:00:00.000Z') // an hour later
    const stop = await app.inject({
      method: 'POST',
      url: `/api/focus/${session.id}/stop`,
      body: { completed: true },
    })
    expect(stop.json().session.duration_sec).toBe(60) // capped at planned
  })
})

describe('focus stop — idempotency (server)', () => {
  it('a second stop returns the existing session unchanged', async () => {
    const start = await app.inject({
      method: 'POST',
      url: '/api/focus/start',
      body: { duration_sec: 60 },
    })
    const id = start.json().session.id
    clock.at = new Date('2026-06-11T08:00:30.000Z')
    const first = await app.inject({
      method: 'POST',
      url: `/api/focus/${id}/stop`,
      body: { completed: true },
    })
    expect(first.json().session.completed).toBe(1)
    expect(first.json().session.duration_sec).toBe(30)

    // move the clock again and stop a second time — must not re-clamp or flip
    clock.at = new Date('2026-06-11T08:05:00.000Z')
    const second = await app.inject({
      method: 'POST',
      url: `/api/focus/${id}/stop`,
      body: { completed: false },
    })
    expect(second.json().session.completed).toBe(1) // unchanged
    expect(second.json().session.duration_sec).toBe(30) // unchanged
  })

  it('404s when stopping a session that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/focus/999/stop',
      body: { completed: true },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('focus start — task status handling', () => {
  it('promotes only a todo task to in_progress', async () => {
    const task = await createTask({ title: 'a' })
    await app.inject({ method: 'POST', url: '/api/focus/start', body: { task_id: task.id, duration_sec: 60 } })
    const after = await app.inject({ method: 'GET', url: `/api/tasks/${task.id}` })
    expect(after.json().task.status).toBe('in_progress')
  })

  it('leaves a done task untouched when focused', async () => {
    const task = await createTask({ title: 'a', status: 'done' })
    await app.inject({ method: 'POST', url: '/api/focus/start', body: { task_id: task.id, duration_sec: 60 } })
    const after = await app.inject({ method: 'GET', url: `/api/tasks/${task.id}` })
    expect(after.json().task.status).toBe('done') // unchanged
  })

  it('leaves an in_progress task untouched when focused', async () => {
    const task = await createTask({ title: 'a' })
    await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, body: { status: 'in_progress' } })
    await app.inject({ method: 'POST', url: '/api/focus/start', body: { task_id: task.id, duration_sec: 60 } })
    const after = await app.inject({ method: 'GET', url: `/api/tasks/${task.id}` })
    expect(after.json().task.status).toBe('in_progress')
  })

  it('404s when starting focus on a deleted task', async () => {
    const task = await createTask({ title: 'gone' })
    await app.inject({ method: 'DELETE', url: `/api/tasks/${task.id}` })
    const res = await app.inject({
      method: 'POST',
      url: '/api/focus/start',
      body: { task_id: task.id, duration_sec: 60 },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/tasks — q search', () => {
  it('matches the query against both title and notes (LIKE)', async () => {
    await createTask({ title: 'buy milk' })
    await createTask({ title: 'call mum', notes: 'about the milk run' })
    await createTask({ title: 'unrelated' })

    const res = await app.inject({ method: 'GET', url: '/api/tasks?q=milk' })
    const titles = res.json().tasks.map((t) => t.title).sort()
    expect(titles).toEqual(['buy milk', 'call mum'])
  })

  it('combines status, due range, and q in one query', async () => {
    await createTask({ title: 'report draft', status: 'todo', due_at: '2026-06-15T05:00:00.000Z' })
    await createTask({ title: 'report final', status: 'done', due_at: '2026-06-15T05:00:00.000Z' })
    await createTask({ title: 'report later', status: 'todo', due_at: '2026-07-01T05:00:00.000Z' })

    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks?status=todo&due_after=2026-06-14T00:00:00.000Z&due_before=2026-06-16T00:00:00.000Z&q=report',
    })
    expect(res.json().tasks.map((t) => t.title)).toEqual(['report draft'])
  })
})

describe('PATCH /api/tasks/:id — minimal updates', () => {
  it('updates sort_order alone without touching status/completed_at', async () => {
    const task = await createTask({ title: 'a' })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      body: { sort_order: 3.5 },
    })
    const t = res.json().task
    expect(t.sort_order).toBe(3.5)
    expect(t.status).toBe('todo')
    expect(t.completed_at).toBeNull()
  })

  it('returns the unchanged task when the body has no effective updates', async () => {
    const task = await createTask({ title: 'a' })
    // status equals the current status → no updates collected → early return
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      body: { status: 'todo' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().task).toMatchObject({ id: task.id, status: 'todo' })
  })
})

describe('recurrence via the PATCH route with a controlled clock (B1)', () => {
  const dueAndComplete = async (repeat, dueIso) => {
    const task = await createTask({ title: `r-${repeat}`, due_at: dueIso, repeat })
    await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, body: { status: 'done' } })
    const open = (await app.inject({ method: 'GET', url: '/api/tasks?status=todo' })).json().tasks
    return open.find((t) => t.title === `r-${repeat}`)
  }

  it('daily spawns the occurrence one day out, deterministically', async () => {
    clock.at = new Date('2026-06-11T08:00:00.000Z')
    const due = '2026-06-11T09:00:00.000Z'
    const next = await dueAndComplete('daily', due)
    expect(new Date(next.due_at) - new Date(due)).toBe(24 * 3600_000)
  })

  it('weekly spawns the occurrence one week out', async () => {
    clock.at = new Date('2026-06-11T08:00:00.000Z')
    const due = '2026-06-11T09:00:00.000Z'
    const next = await dueAndComplete('weekly', due)
    expect(new Date(next.due_at) - new Date(due)).toBe(7 * 24 * 3600_000)
  })

  it('monthly clamps a 31st into a short next month', async () => {
    // complete on Jan 31; next is Feb, which clamps to the 28th
    clock.at = new Date(2027, 0, 31, 10)
    const due = new Date(2027, 0, 31, 9).toISOString()
    const next = await dueAndComplete('monthly', due)
    const d = new Date(next.due_at)
    expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([1, 28, 9])
  })
})

describe('stats — range edges', () => {
  it('excludes a session started outside the [from,to) window', async () => {
    // session at 08:00; query a window that ends before then
    const start = await app.inject({ method: 'POST', url: '/api/focus/start', body: { duration_sec: 60 } })
    clock.at = new Date('2026-06-11T08:00:30.000Z')
    await app.inject({ method: 'POST', url: `/api/focus/${start.json().session.id}/stop`, body: { completed: true } })

    const before = await app.inject({
      method: 'GET',
      url: '/api/stats?from=2026-06-11T06:00:00.000Z&to=2026-06-11T07:00:00.000Z',
    })
    expect(before.json().focus_sessions).toBe(0)
    expect(before.json().focus_sec).toBe(0)

    const within = await app.inject({
      method: 'GET',
      url: '/api/stats?from=2026-06-11T07:30:00.000Z&to=2026-06-11T09:00:00.000Z',
    })
    expect(within.json().focus_sessions).toBe(1)
    expect(within.json().focus_sec).toBe(30)
  })
})

describe('backup — export ordering and round-trip details', () => {
  it('exports tasks ordered by id', async () => {
    await createTask({ title: 'one' })
    await createTask({ title: 'two' })
    await createTask({ title: 'three' })
    const dump = (await app.inject({ method: 'GET', url: '/api/export' })).json()
    expect(dump.tasks.map((t) => t.id)).toEqual([1, 2, 3])
  })

  it('preserves focus_session ids across an import', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/focus/start', body: { duration_sec: 60 } })
    clock.at = new Date('2026-06-11T08:00:10.000Z')
    await app.inject({ method: 'POST', url: `/api/focus/${start.json().session.id}/stop`, body: { completed: true } })
    const dump = (await app.inject({ method: 'GET', url: '/api/export' })).json()
    const sessionId = dump.focus_sessions[0].id

    const fresh = buildApp({ db: openDb(':memory:') })
    await fresh.inject({ method: 'POST', url: '/api/import', body: dump })
    const active = await fresh.inject({ method: 'GET', url: '/api/focus/active' })
    expect(active.json().session).toBeNull() // it was a finished session
    const reExport = (await fresh.inject({ method: 'GET', url: '/api/export' })).json()
    expect(reExport.focus_sessions[0].id).toBe(sessionId)
  })

  it('import accepts a payload with extra unknown top-level keys', async () => {
    await createTask({ title: 'seed' })
    const dump = (await app.inject({ method: 'GET', url: '/api/export' })).json()
    const fresh = buildApp({ db: openDb(':memory:') })
    const res = await fresh.inject({
      method: 'POST',
      url: '/api/import',
      body: { ...dump, somethingNew: { ignored: true }, futureField: 42 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().imported.tasks).toBe(1)
  })
})
