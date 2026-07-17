import { describe, it, expect } from 'vitest'
import {
  isRemindable,
  reminderPlan,
  reminderNotification,
  loadEnabled,
  saveEnabled,
  loadNotified,
  saveNotified,
  REMINDERS_KEY,
  NOTIFIED_KEY,
  REMINDER_HORIZON_MS,
} from '../src/lib/reminders.js'

// A minimal in-memory storage stub, like the one the CLI/engine tests use, so
// the persistence helpers can be driven without touching the real localStorage.
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  }
}

const at = (isoDay, h = 0, m = 0) => new Date(`${isoDay}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`).toISOString()
const task = (over = {}) => ({
  id: 1,
  title: 'Pay rent',
  status: 'todo',
  due_at: at('2026-07-18', 9),
  deleted_at: null,
  ...over,
})

describe('isRemindable', () => {
  it('is true for an open task with a due date', () => {
    expect(isRemindable(task())).toBe(true)
  })
  it('is false without a due date', () => {
    expect(isRemindable(task({ due_at: null }))).toBe(false)
  })
  it('is false for a completed task', () => {
    expect(isRemindable(task({ status: 'done' }))).toBe(false)
  })
  it('is false for a deleted task', () => {
    expect(isRemindable(task({ deleted_at: at('2026-07-18', 8) }))).toBe(false)
  })
  it('is false for a nullish task', () => {
    expect(isRemindable(null)).toBe(false)
    expect(isRemindable(undefined)).toBe(false)
  })
})

describe('reminderPlan', () => {
  const now = new Date('2026-07-18T12:00:00Z')

  it('puts a past-due open task in `due` (the catch-up sweep)', () => {
    const t = task({ due_at: at('2026-07-18', 9) }) // 3h ago
    const { due, upcoming } = reminderPlan([t], { now })
    expect(due).toEqual([t])
    expect(upcoming).toEqual([])
  })

  it('treats a task due exactly now as due', () => {
    const t = task({ due_at: now.toISOString() })
    expect(reminderPlan([t], { now }).due).toEqual([t])
  })

  it('puts a task due later today in `upcoming` with the delay to its due time', () => {
    const t = task({ due_at: at('2026-07-18', 14) }) // in 2h
    const { due, upcoming } = reminderPlan([t], { now })
    expect(due).toEqual([])
    expect(upcoming).toHaveLength(1)
    expect(upcoming[0].task).toBe(t)
    expect(upcoming[0].delay).toBe(2 * 60 * 60 * 1000)
  })

  it('ignores tasks beyond the scheduling horizon', () => {
    const t = task({ due_at: new Date(now.getTime() + REMINDER_HORIZON_MS + 1000).toISOString() })
    const { due, upcoming } = reminderPlan([t], { now })
    expect(due).toEqual([])
    expect(upcoming).toEqual([])
  })

  it('skips tasks already in the notified set', () => {
    const t = task({ id: 7, due_at: at('2026-07-18', 9) })
    expect(reminderPlan([t], { now, notified: new Set([7]) }).due).toEqual([])
  })

  it('accepts the notified set as a plain array too', () => {
    const t = task({ id: 7, due_at: at('2026-07-18', 9) })
    expect(reminderPlan([t], { now, notified: [7] }).due).toEqual([])
  })

  it('excludes done, deleted, and dateless tasks', () => {
    const tasks = [
      task({ id: 1, status: 'done', due_at: at('2026-07-18', 9) }),
      task({ id: 2, deleted_at: at('2026-07-18', 8), due_at: at('2026-07-18', 9) }),
      task({ id: 3, due_at: null }),
    ]
    const { due, upcoming } = reminderPlan(tasks, { now })
    expect(due).toEqual([])
    expect(upcoming).toEqual([])
  })

  it('ignores an unparseable due date instead of throwing', () => {
    const t = task({ due_at: 'not-a-date' })
    const { due, upcoming } = reminderPlan([t], { now })
    expect(due).toEqual([])
    expect(upcoming).toEqual([])
  })

  it('accepts a millisecond timestamp for `now`', () => {
    const t = task({ due_at: at('2026-07-18', 9) })
    expect(reminderPlan([t], { now: now.getTime() }).due).toEqual([t])
  })

  it('defaults to an empty plan for no tasks', () => {
    expect(reminderPlan()).toEqual({ due: [], upcoming: [] })
  })
})

describe('reminderNotification', () => {
  it('uses the title, a Due-time body, and a per-task tag', () => {
    const t = task({ id: 42, title: 'Ship it', due_at: at('2026-07-18', 9) })
    const note = reminderNotification(t)
    expect(note.title).toBe('Ship it')
    expect(note.body).toMatch(/^Due /)
    expect(note.tag).toBe('todoo-task-42')
  })
})

describe('preference + notified persistence', () => {
  it('defaults to disabled and round-trips the on/off flag', () => {
    const storage = memoryStorage()
    expect(loadEnabled(storage)).toBe(false)
    saveEnabled(true, storage)
    expect(storage.getItem(REMINDERS_KEY)).toBe('on')
    expect(loadEnabled(storage)).toBe(true)
    saveEnabled(false, storage)
    expect(storage.getItem(REMINDERS_KEY)).toBe('off')
    expect(loadEnabled(storage)).toBe(false)
  })

  it('returns an empty set when nothing is stored', () => {
    expect(loadNotified(memoryStorage()).size).toBe(0)
  })

  it('round-trips the notified id set as a JSON array', () => {
    const storage = memoryStorage()
    saveNotified(new Set([3, 9]), storage)
    expect(JSON.parse(storage.getItem(NOTIFIED_KEY))).toEqual([3, 9])
    expect([...loadNotified(storage)].sort()).toEqual([3, 9])
  })

  it('recovers from a corrupt notified snapshot with an empty set', () => {
    const storage = memoryStorage({ [NOTIFIED_KEY]: '{not json' })
    expect(loadNotified(storage).size).toBe(0)
  })

  it('ignores a non-array notified snapshot', () => {
    const storage = memoryStorage({ [NOTIFIED_KEY]: '{"a":1}' })
    expect(loadNotified(storage).size).toBe(0)
  })
})
