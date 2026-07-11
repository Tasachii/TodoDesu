import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../src/db/index.js'
import { buildApp } from '../src/app.js'
import { nextDueAt } from '../src/routes/tasks.js'

let app

beforeEach(() => {
  app = buildApp({ db: openDb(':memory:') })
})

async function createTask(body) {
  const res = await app.inject({ method: 'POST', url: '/api/tasks', body })
  return res.json().task
}

describe('health', () => {
  it('responds ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })
})

describe('tasks CRUD', () => {
  it('creates a task with defaults', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tasks', body: { title: '  read ch4  ' } })
    expect(res.statusCode).toBe(201)
    const { task } = res.json()
    expect(task.title).toBe('read ch4')
    expect(task.status).toBe('todo')
    expect(task.priority).toBe(0)
    expect(task.sort_order).toBe(1)
    expect(task.completed_at).toBeNull()
  })

  it('rejects empty titles and unknown fields', async () => {
    const empty = await app.inject({ method: 'POST', url: '/api/tasks', body: { title: '' } })
    expect(empty.statusCode).toBe(400)
    expect(empty.json().error.code).toBe('VALIDATION')

    const whitespace = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      body: { title: ' \t\n ' },
    })
    expect(whitespace.statusCode).toBe(400)
    expect(whitespace.json().error.code).toBe('VALIDATION')

    const unknown = await app.inject({ method: 'POST', url: '/api/tasks', body: { title: 'x', nope: 1 } })
    expect(unknown.statusCode).toBe(400)
    expect(unknown.json().error.code).toBe('VALIDATION')
  })

  it('rejects a whitespace-only PATCH title without changing the task', async () => {
    const task = await createTask({ title: 'keep me' })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      body: { title: '   ' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION')

    const stored = await app.inject({ method: 'GET', url: `/api/tasks/${task.id}` })
    expect(stored.json().task.title).toBe('keep me')
  })

  it('lists with status and due range filters', async () => {
    await createTask({ title: 'a', due_at: '2026-06-10T05:00:00.000Z' })
    await createTask({ title: 'b', due_at: '2026-06-11T05:00:00.000Z' })
    await createTask({ title: 'c', status: 'done' })

    const todo = await app.inject({ method: 'GET', url: '/api/tasks?status=todo' })
    expect(todo.json().tasks.map((t) => t.title)).toEqual(['a', 'b'])

    const ranged = await app.inject({
      method: 'GET',
      url: '/api/tasks?due_after=2026-06-10T00:00:00.000Z&due_before=2026-06-11T00:00:00.000Z',
    })
    expect(ranged.json().tasks.map((t) => t.title)).toEqual(['a'])
  })

  it('marks done via PATCH and sets completed_at, appends to done column', async () => {
    const task = await createTask({ title: 'a' })
    await createTask({ title: 'old done', status: 'done' })
    const res = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, body: { status: 'done' } })
    const updated = res.json().task
    expect(updated.completed_at).toBeTruthy()
    const done = await app.inject({ method: 'GET', url: '/api/tasks?status=done' })
    expect(done.json().tasks.at(-1).id).toBe(task.id)

    const back = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, body: { status: 'todo' } })
    expect(back.json().task.completed_at).toBeNull()
  })

  it('respects explicit sort_order on drag', async () => {
    const a = await createTask({ title: 'a' })
    await createTask({ title: 'b' })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${a.id}`,
      body: { status: 'in_progress', sort_order: 0.5 },
    })
    expect(res.json().task.sort_order).toBe(0.5)
  })

  it('soft deletes, hides from lists, restores', async () => {
    const task = await createTask({ title: 'a' })
    const del = await app.inject({ method: 'DELETE', url: `/api/tasks/${task.id}` })
    expect(del.json().task.deleted_at).toBeTruthy()

    const list = await app.inject({ method: 'GET', url: '/api/tasks' })
    expect(list.json().tasks).toHaveLength(0)
    const trash = await app.inject({ method: 'GET', url: '/api/tasks?deleted=true' })
    expect(trash.json().tasks).toHaveLength(1)

    const restored = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/restore` })
    expect(restored.json().task.deleted_at).toBeNull()
  })

  it('404s on missing ids', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/999' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('reports malformed bodies as VALIDATION, not INTERNAL', async () => {
    const task = await createTask({ title: 'a' })
    // A bodyless request claiming application/json is a client error
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${task.id}`,
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION')
  })
})

describe('recurring tasks', () => {
  const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString()

  it('completing a repeating task spawns the next occurrence', async () => {
    const due = hours(26)
    const task = await createTask({ title: 'water plants', due_at: due, repeat: 'daily' })
    await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, body: { status: 'done' } })

    const open = (await app.inject({ method: 'GET', url: '/api/tasks?status=todo' })).json().tasks
    const next = open.find((t) => t.title === 'water plants')
    expect(next).toBeTruthy()
    expect(next.id).not.toBe(task.id)
    expect(next.repeat).toBe('daily')
    expect(new Date(next.due_at) - new Date(due)).toBe(24 * 3600_000)
  })

  it('done → todo → done on the same occurrence never spawns a duplicate', async () => {
    const task = await createTask({ title: 'water plants', due_at: hours(26), repeat: 'daily' })
    await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, body: { status: 'done' } })

    const firstList = (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks
    const child = firstList.find((candidate) => candidate.recurrence_parent_id === task.id)
    expect(child).toBeTruthy()

    await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, body: { status: 'todo' } })
    await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, body: { status: 'done' } })

    const finalList = (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks
    expect(finalList.filter((candidate) => candidate.recurrence_parent_id === task.id)).toEqual([
      expect.objectContaining({ id: child.id }),
    ])
  })

  it('weekly repeats jump a week; overdue dailies land in the future', async () => {
    const weekly = await createTask({ title: 'review', due_at: hours(2), repeat: 'weekly' })
    await app.inject({ method: 'PATCH', url: `/api/tasks/${weekly.id}`, body: { status: 'done' } })
    const overdue = await createTask({ title: 'stretch', due_at: hours(-30), repeat: 'daily' })
    await app.inject({ method: 'PATCH', url: `/api/tasks/${overdue.id}`, body: { status: 'done' } })

    const open = (await app.inject({ method: 'GET', url: '/api/tasks?status=todo' })).json().tasks
    const nextWeekly = open.find((t) => t.title === 'review')
    expect(new Date(nextWeekly.due_at) - new Date(weekly.due_at)).toBe(7 * 24 * 3600_000)
    const nextDaily = open.find((t) => t.title === 'stretch')
    expect(new Date(nextDaily.due_at) > new Date()).toBe(true)
    expect(new Date(nextDaily.due_at).getUTCHours()).toBe(new Date(overdue.due_at).getUTCHours())
  })

  it('monthly recurrence clamps short months and recovers the anchor day', () => {
    // due on the 31st, 9:00 local — Feb clamps to 28, March returns to 31
    const jan31 = new Date(2027, 0, 31, 9)
    const ref = new Date(2027, 0, 31, 10)
    const feb = new Date(nextDueAt(jan31.toISOString(), 'monthly', ref))
    expect([feb.getMonth(), feb.getDate(), feb.getHours()]).toEqual([1, 28, 9])
    const mar = new Date(nextDueAt(feb.toISOString(), 'monthly', ref))
    expect([mar.getMonth(), mar.getDate()]).toEqual([2, 28]) // anchored to the 28th from here on
    // a 31st advancing into a 31-day month stays on the 31st — no overflow to Feb 3
    const dec31 = new Date(2026, 11, 31, 9)
    const jan = new Date(nextDueAt(dec31.toISOString(), 'monthly', new Date(2026, 11, 31, 10)))
    expect([jan.getMonth(), jan.getDate()]).toEqual([0, 31])
  })

  it('rejects repeat without a due date, on create and when clearing the date', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      body: { title: 'x', repeat: 'daily' },
    })
    expect(create.statusCode).toBe(400)

    const task = await createTask({ title: 'y', due_at: hours(2), repeat: 'daily' })
    const clear = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      body: { due_at: null },
    })
    expect(clear.statusCode).toBe(400)
    const both = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      body: { due_at: null, repeat: null },
    })
    expect(both.statusCode).toBe(200) // clearing both together is fine
  })
})

describe('focus sessions', () => {
  it('starts, blocks a second session, stops with elapsed time', async () => {
    const task = await createTask({ title: 'a' })
    const start = await app.inject({
      method: 'POST',
      url: '/api/focus/start',
      body: { task_id: task.id, duration_sec: 1500 },
    })
    expect(start.statusCode).toBe(201)
    const session = start.json().session

    const taskAfter = await app.inject({ method: 'GET', url: `/api/tasks/${task.id}` })
    expect(taskAfter.json().task.status).toBe('in_progress')

    const second = await app.inject({ method: 'POST', url: '/api/focus/start', body: { duration_sec: 1500 } })
    expect(second.statusCode).toBe(409)

    const active = await app.inject({ method: 'GET', url: '/api/focus/active' })
    expect(active.json().session.id).toBe(session.id)
    expect(active.json().session.task_title).toBe('a')

    const stop = await app.inject({
      method: 'POST',
      url: `/api/focus/${session.id}/stop`,
      body: { completed: false },
    })
    expect(stop.json().session.ended_at).toBeTruthy()
    expect(stop.json().session.duration_sec).toBeGreaterThanOrEqual(0)

    const none = await app.inject({ method: 'GET', url: '/api/focus/active' })
    expect(none.json().session).toBeNull()
  })

  it('rejects out-of-range durations', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/focus/start', body: { duration_sec: 5 } })
    expect(res.statusCode).toBe(400)
  })
})

describe('stats', () => {
  it('counts completed tasks and finished focus time in range', async () => {
    const task = await createTask({ title: 'a' })
    await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, body: { status: 'done' } })
    const start = await app.inject({ method: 'POST', url: '/api/focus/start', body: { duration_sec: 60 } })
    await app.inject({ method: 'POST', url: `/api/focus/${start.json().session.id}/stop`, body: { completed: true } })

    const from = new Date(Date.now() - 3600_000).toISOString()
    const to = new Date(Date.now() + 3600_000).toISOString()
    const res = await app.inject({ method: 'GET', url: `/api/stats?from=${from}&to=${to}` })
    expect(res.json().tasks_completed).toBe(1)
    expect(res.json().focus_sessions).toBe(1)
  })
})

describe('backup', () => {
  it('export → import round-trips everything, including deleted tasks and ids', async () => {
    const keep = await createTask({ title: 'keep', priority: 2 })
    const gone = await createTask({ title: 'gone' })
    await app.inject({ method: 'DELETE', url: `/api/tasks/${gone.id}` })
    const fs = await app.inject({ method: 'POST', url: '/api/focus/start', body: { duration_sec: 60 } })
    await app.inject({ method: 'POST', url: `/api/focus/${fs.json().session.id}/stop`, body: { completed: true } })
    await app.inject({ method: 'PUT', url: '/api/settings', body: { theme: 'dark' } })

    const dump = (await app.inject({ method: 'GET', url: '/api/export' })).json()
    expect(dump.app).toBe('todoo')
    expect(dump.tasks).toHaveLength(2)

    const fresh = buildApp({ db: openDb(':memory:') })
    const res = await fresh.inject({ method: 'POST', url: '/api/import', body: dump })
    expect(res.statusCode).toBe(200)
    expect(res.json().imported.tasks).toBe(2)

    const tasks = (await fresh.inject({ method: 'GET', url: '/api/tasks' })).json().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ id: keep.id, title: 'keep', priority: 2 })
    const trash = (await fresh.inject({ method: 'GET', url: '/api/tasks?deleted=true' })).json().tasks
    expect(trash[0].title).toBe('gone')
    const settings = (await fresh.inject({ method: 'GET', url: '/api/settings' })).json().settings
    expect(settings.theme).toBe('dark')

    // id sequence continues past imported ids — no collisions
    const next = await fresh.inject({ method: 'POST', url: '/api/tasks', body: { title: 'new' } })
    expect(next.json().task.id).toBeGreaterThan(gone.id)
  })

  it('rejects payloads that are not a todoo backup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      body: { app: 'other', version: 1, tasks: [] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION')
  })

  it('rolls back atomically on malformed rows with a friendly message', async () => {
    await createTask({ title: 'precious' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      body: {
        app: 'todoo',
        version: 1,
        tasks: [
          { id: 1, title: 'ok', status: 'todo', sort_order: 1, created_at: 'x' },
          { id: 2, title: 'bad', status: 'NONSENSE', sort_order: 2, created_at: 'x' },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe('Backup file is invalid or corrupted')
    // old data survives the failed import
    const tasks = (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('precious')
  })

  it('accepts a backup larger than Fastify’s 1 MB default body limit', async () => {
    // ~1.5 MB of notes on one task — without the raised bodyLimit Fastify would
    // 413 this, silently breaking restore for anyone with a large history.
    const big = 'x'.repeat(1_500_000)
    const dump = {
      app: 'todoo',
      version: 1,
      tasks: [
        {
          id: 1,
          title: 'huge',
          notes: big,
          status: 'todo',
          sort_order: 1,
          created_at: new Date().toISOString(),
        },
      ],
      focus_sessions: [],
      settings: {},
    }
    const fresh = buildApp({ db: openDb(':memory:') })
    const res = await fresh.inject({ method: 'POST', url: '/api/import', body: dump })
    expect(res.statusCode).toBe(200)
    expect(res.json().imported.tasks).toBe(1)
    const imported = (await fresh.inject({ method: 'GET', url: '/api/tasks/1' })).json().task
    expect(imported.recurrence_parent_id).toBeNull()
  })
})

describe('settings', () => {
  it('returns defaults and merges updates', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(before.json().settings.theme).toBe('auto')
    expect(before.json().settings.focus_style).toBe('timer')
    expect(before.json().settings.pomodoro_work_sec).toBe('1500')
    expect(before.json().settings.pomodoro_rounds).toBe('4')

    await app.inject({ method: 'PUT', url: '/api/settings', body: { theme: 'dark' } })
    const after = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(after.json().settings.theme).toBe('dark')
    expect(after.json().settings.focus_duration_sec).toBe('1500')
  })
})
