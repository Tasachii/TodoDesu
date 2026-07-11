// Standalone data engine: the same business rules as @todoo/server, backed by
// a JSON snapshot in localStorage instead of SQLite behind a REST API.
// Used when the app runs inside Capacitor (iOS/Android) or is built with
// VITE_STANDALONE=1 — environments where no local server exists.
//
// It implements exactly the surface the web app uses (see client.js), with
// the same shapes and the same error codes, so the views cannot tell the
// difference. Shared business rules (e.g. nextDueAt) live in @todoo/core so
// this engine and the server can never drift; keep the rest of the surface in
// sync with packages/server/src/routes/.

import { nextDueAt } from '@todoo/core'

const STORAGE_KEY = 'todoo-data-v1'
const PURGE_AFTER_DAYS = 30

const DEFAULT_SETTINGS = {
  theme: 'auto',
  focus_style: 'timer',
  focus_duration_sec: '1500',
  break_duration_sec: '300',
  pomodoro_work_sec: '1500',
  pomodoro_break_sec: '300',
  pomodoro_long_break_sec: '900',
  pomodoro_rounds: '4',
}

function apiError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

// Mirrors the server's JSON-schema bounds for the fields the engine accepts.
function validateFields(body) {
  if ('status' in body && !['todo', 'in_progress', 'done'].includes(body.status)) {
    throw apiError('VALIDATION', `invalid status: ${body.status}`)
  }
  if ('repeat' in body && body.repeat != null && !['daily', 'weekly', 'monthly'].includes(body.repeat)) {
    throw apiError('VALIDATION', `invalid repeat: ${body.repeat}`)
  }
  if (
    'priority' in body &&
    (!Number.isInteger(body.priority) || body.priority < 0 || body.priority > 3)
  ) {
    throw apiError('VALIDATION', 'priority must be an integer between 0 and 3')
  }
  if ('title' in body && typeof body.title === 'string') {
    if (body.title.trim().length === 0) {
      throw apiError('VALIDATION', 'title must not be blank')
    }
    if (body.title.trim().length > 500) {
      throw apiError('VALIDATION', 'title too long (max 500 chars)')
    }
  }
}

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
  }
}

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* sandboxed webview without storage access */
  }
  return memoryStorage()
}

const emptyData = () => ({ taskSeq: 0, sessionSeq: 0, tasks: [], sessions: [], settings: {} })

export function createLocalApi(storage = defaultStorage(), now = () => new Date()) {
  let data = emptyData()
  const raw = storage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      data = { ...emptyData(), ...JSON.parse(raw) }
    } catch {
      // Corrupt snapshot — keep a copy for recovery, then start fresh
      // rather than brick the app.
      try {
        storage.setItem(`${STORAGE_KEY}.corrupt`, raw)
      } catch {
        /* nothing more we can do */
      }
    }
  }
  // Reconcile sequence counters with the actual data so a partial snapshot
  // can never hand out colliding ids.
  data.taskSeq = Math.max(data.taskSeq, ...data.tasks.map((t) => t.id), 0)
  data.sessionSeq = Math.max(data.sessionSeq, ...data.sessions.map((s) => s.id), 0)

  const persist = (snapshot = data) => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch {
      // A full quota (or a locked-down private-mode store) must surface as a
      // clean error the UI can show — not a raw DOMException — otherwise the
      // optimistic mutation just rolls back and the new task vanishes silently.
      throw apiError('STORAGE_FULL', 'Storage is full — export a backup and remove old tasks to free space.')
    }
  }
  const iso = () => now().toISOString()

  // startup purge, same policy as the server
  const cutoff = new Date(now().getTime() - PURGE_AFTER_DAYS * 24 * 3600 * 1000).toISOString()
  const retainedTasks = data.tasks.filter((t) => !t.deleted_at || t.deleted_at >= cutoff)
  if (retainedTasks.length !== data.tasks.length) {
    const purged = { ...data, tasks: retainedTasks }
    persist(purged)
    data = purged
  }

  const commit = (mutate) => {
    const draft = JSON.parse(JSON.stringify(data))
    const result = mutate(draft)
    persist(draft)
    data = draft
    return result
  }

  const live = (snapshot = data) => snapshot.tasks.filter((t) => !t.deleted_at)
  const taskById = (id, snapshot = data) =>
    snapshot.tasks.find((t) => t.id === Number(id)) ?? null
  const nextSortOrder = (status, snapshot = data) =>
    Math.max(0, ...live(snapshot).filter((t) => t.status === status).map((t) => t.sort_order)) + 1

  const requireTask = (id, snapshot = data) => {
    const task = taskById(id, snapshot)
    if (!task || task.deleted_at) throw apiError('NOT_FOUND', 'Not found')
    return task
  }

  return {
    async tasks() {
      return live()
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
    },

    async createTask({
      title,
      notes = '',
      due_at = null,
      priority = 0,
      status = 'todo',
      repeat = null,
    } = {}) {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 500) {
        throw apiError('VALIDATION', 'title is required (max 500 chars)')
      }
      validateFields({ status, priority, repeat })
      if (repeat && !due_at) throw apiError('VALIDATION', 'repeat requires a due date')
      return commit((draft) => {
        const t = iso()
        const task = {
          id: ++draft.taskSeq,
          title: title.trim(),
          notes,
          status,
          due_at,
          priority,
          sort_order: nextSortOrder(status, draft),
          created_at: t,
          completed_at: status === 'done' ? t : null,
          deleted_at: null,
          repeat,
        }
        draft.tasks.push(task)
        return task
      })
    },

    async patchTask(id, body = {}) {
      const currentTask = requireTask(id)
      validateFields(body)
      const resultingRepeat = 'repeat' in body ? body.repeat : currentTask.repeat
      const resultingDue = 'due_at' in body ? body.due_at : currentTask.due_at
      if (resultingRepeat && !resultingDue) {
        throw apiError('VALIDATION', 'repeat requires a due date')
      }
      return commit((draft) => {
        const task = requireTask(id, draft)
        const wasDone = task.status === 'done'
        for (const key of ['title', 'notes', 'due_at', 'priority', 'sort_order', 'repeat']) {
          if (key in body) task[key] = body[key]
        }
        if ('title' in body) task.title = task.title.trim()
        if ('status' in body && body.status !== task.status) {
          task.status = body.status
          task.completed_at = body.status === 'done' ? iso() : null
          if (!('sort_order' in body)) task.sort_order = nextSortOrder(body.status, draft)
        }
        if (!wasDone && task.status === 'done' && task.repeat && task.due_at) {
          draft.tasks.push({
            id: ++draft.taskSeq,
            title: task.title,
            notes: task.notes,
            status: 'todo',
            due_at: nextDueAt(task.due_at, task.repeat, now()),
            priority: task.priority,
            sort_order: nextSortOrder('todo', draft),
            created_at: iso(),
            completed_at: null,
            deleted_at: null,
            repeat: task.repeat,
          })
        }
        return task
      })
    },

    async deleteTask(id) {
      requireTask(id)
      return commit((draft) => {
        const task = requireTask(id, draft)
        task.deleted_at = iso()
        return task
      })
    },

    async restoreTask(id) {
      const task = taskById(id)
      if (!task || !task.deleted_at) throw apiError('NOT_FOUND', 'No deleted task with that id')
      return commit((draft) => {
        const restored = taskById(id, draft)
        restored.deleted_at = null
        return restored
      })
    },

    async focusStart({ task_id = null, duration_sec } = {}) {
      if (!Number.isInteger(duration_sec) || duration_sec < 60 || duration_sec > 14400) {
        throw apiError('VALIDATION', 'duration_sec must be between 60 and 14400')
      }
      if (data.sessions.some((s) => !s.ended_at)) {
        throw apiError('CONFLICT', 'A focus session is already active')
      }
      if (task_id != null) requireTask(task_id)
      return commit((draft) => {
        if (task_id != null) {
          const task = requireTask(task_id, draft)
          if (task.status === 'todo') {
            task.status = 'in_progress'
            task.sort_order = nextSortOrder('in_progress', draft)
          }
        }
        const session = {
          id: ++draft.sessionSeq,
          task_id,
          planned_sec: duration_sec,
          started_at: iso(),
          ended_at: null,
          duration_sec: null,
          completed: 0,
        }
        draft.sessions.push(session)
        return session
      })
    },

    async focusStop(id, completed) {
      const session = data.sessions.find((s) => s.id === Number(id))
      if (!session) throw apiError('NOT_FOUND', 'Not found')
      if (session.ended_at) return session // idempotent
      return commit((draft) => {
        const stopped = draft.sessions.find((s) => s.id === Number(id))
        const t = now()
        stopped.ended_at = t.toISOString()
        stopped.duration_sec = Math.max(
          0,
          Math.min(Math.round((t - new Date(stopped.started_at)) / 1000), stopped.planned_sec)
        )
        stopped.completed = completed ? 1 : 0
        return stopped
      })
    },

    async focusActive() {
      const session = data.sessions.find((s) => !s.ended_at) ?? null
      if (!session) return null
      const task = session.task_id != null ? taskById(session.task_id) : null
      return { ...session, task_title: task?.title ?? null }
    },

    async stats(from, to) {
      const finished = data.sessions.filter(
        (s) => s.ended_at && s.started_at >= from && s.started_at < to
      )
      return {
        focus_sec: finished.reduce((sum, s) => sum + (s.duration_sec ?? 0), 0),
        focus_sessions: finished.length,
        tasks_completed: live().filter((t) => t.completed_at && t.completed_at >= from && t.completed_at < to)
          .length,
      }
    },

    async settings() {
      return { ...DEFAULT_SETTINGS, ...data.settings }
    },

    // Same payload shape as the server's /api/export — a backup taken in one
    // mode restores in the other.
    async exportData() {
      return {
        app: 'todoo',
        version: 1,
        exported_at: iso(),
        tasks: data.tasks.slice().sort((a, b) => a.id - b.id),
        focus_sessions: data.sessions.slice().sort((a, b) => a.id - b.id),
        settings: { ...data.settings },
      }
    },

    async importData(payload) {
      if (
        !payload ||
        payload.app !== 'todoo' ||
        payload.version !== 1 ||
        !Array.isArray(payload.tasks)
      ) {
        throw apiError('VALIDATION', 'Not a Todoo backup file')
      }
      // Shape-check rows like the server's DB constraints would: a malformed
      // row must reject the whole import, never poison the store (e.g. a
      // non-numeric id would make taskSeq NaN and brick createTask forever).
      const sessions = payload.focus_sessions ?? []
      const sane =
        payload.tasks.every(
          (t) =>
            t &&
            Number.isFinite(t.id) &&
            typeof t.title === 'string' &&
            ['todo', 'in_progress', 'done'].includes(t.status) &&
            Number.isFinite(t.sort_order)
        ) &&
        sessions.every((s) => s && Number.isFinite(s.id)) &&
        new Set(payload.tasks.map((t) => t.id)).size === payload.tasks.length &&
        new Set(sessions.map((s) => s.id)).size === sessions.length
      if (!sane) {
        throw apiError('VALIDATION', 'Backup file is invalid or corrupted')
      }
      const importedData = {
        taskSeq: Math.max(0, ...payload.tasks.map((t) => t.id)),
        sessionSeq: Math.max(0, ...sessions.map((s) => s.id)),
        // normalize fields older backups may lack, matching the server's import
        tasks: payload.tasks.map((t) => ({
          ...t,
          notes: t.notes ?? '',
          completed_at: t.completed_at ?? null,
          deleted_at: t.deleted_at ?? null,
          repeat: t.repeat ?? null,
        })),
        sessions,
        settings: Object.fromEntries(
          Object.entries(payload.settings ?? {}).map(([k, v]) => [k, String(v)])
        ),
      }
      persist(importedData)
      data = importedData
      return {
        imported: {
          tasks: data.tasks.length,
          focus_sessions: data.sessions.length,
          settings: Object.keys(data.settings).length,
        },
      }
    },

    async saveSettings(body = {}) {
      return commit((draft) => {
        for (const [key, value] of Object.entries(body)) {
          draft.settings[key] = String(value)
        }
        return { ...DEFAULT_SETTINGS, ...draft.settings }
      })
    },
  }
}
