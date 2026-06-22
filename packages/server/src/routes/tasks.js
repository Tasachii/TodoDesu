import { taskById, nextSortOrder, notFound } from '../db/queries.js'
import { nextDueAt } from '@todoo/core'

// Re-exported for tests that import it from this route module.
export { nextDueAt }

const taskBodyProps = {
  title: { type: 'string', minLength: 1, maxLength: 500 },
  notes: { type: 'string', maxLength: 10000 },
  due_at: { type: ['string', 'null'] },
  priority: { type: 'integer', minimum: 0, maximum: 3 },
  status: { enum: ['todo', 'in_progress', 'done'] },
  repeat: { enum: ['daily', 'weekly', 'monthly', null] },
}

export default async function tasksRoutes(app) {
  const { db } = app
  const now = app.now ?? (() => new Date())

  app.get('/api/tasks', async (req) => {
    const { status, due_after, due_before, q, deleted } = req.query
    const clauses = [deleted === 'true' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
    const params = []
    if (status) {
      const list = String(status).split(',')
      clauses.push(`status IN (${list.map(() => '?').join(',')})`)
      params.push(...list)
    }
    if (due_after) {
      clauses.push('due_at >= ?')
      params.push(due_after)
    }
    if (due_before) {
      clauses.push('due_at < ?')
      params.push(due_before)
    }
    if (q) {
      clauses.push('(title LIKE ? OR notes LIKE ?)')
      params.push(`%${q}%`, `%${q}%`)
    }
    const tasks = db
      .prepare(`SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY sort_order ASC`)
      .all(...params)
    return { tasks }
  })

  app.post(
    '/api/tasks',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: taskBodyProps,
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { title, notes = '', due_at = null, priority = 0, status = 'todo', repeat = null } =
        req.body
      if (repeat && !due_at) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION', message: 'repeat requires a due date' } })
      }
      const now = new Date().toISOString()
      const info = db
        .prepare(
          `INSERT INTO tasks (title, notes, status, due_at, priority, sort_order, created_at, completed_at, repeat)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          title.trim(),
          notes,
          status,
          due_at,
          priority,
          nextSortOrder(db, status),
          now,
          status === 'done' ? now : null,
          repeat
        )
      reply.code(201)
      return { task: taskById(db, info.lastInsertRowid) }
    }
  )

  app.get('/api/tasks/:id', async (req, reply) => {
    const task = taskById(db, req.params.id)
    if (!task) return notFound(reply)
    return { task }
  })

  app.patch(
    '/api/tasks/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: { ...taskBodyProps, sort_order: { type: 'number' } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const task = taskById(db, req.params.id)
      if (!task || task.deleted_at) return notFound(reply)

      const updates = {}
      for (const key of ['title', 'notes', 'due_at', 'priority', 'sort_order', 'repeat']) {
        if (key in req.body) updates[key] = req.body[key]
      }
      if (typeof updates.title === 'string') updates.title = updates.title.trim()
      if ('status' in req.body && req.body.status !== task.status) {
        updates.status = req.body.status
        updates.completed_at = req.body.status === 'done' ? new Date().toISOString() : null
        if (!('sort_order' in req.body)) updates.sort_order = nextSortOrder(db, req.body.status)
      }
      const resultingRepeat = 'repeat' in updates ? updates.repeat : task.repeat
      const resultingDue = 'due_at' in updates ? updates.due_at : task.due_at
      if (resultingRepeat && !resultingDue) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION', message: 'repeat requires a due date' } })
      }
      if (Object.keys(updates).length === 0) return { task }

      const sets = Object.keys(updates).map((k) => `${k} = ?`).join(', ')
      db.prepare(`UPDATE tasks SET ${sets} WHERE id = ?`).run(...Object.values(updates), task.id)
      const fresh = taskById(db, task.id)

      // recurring: completing a repeating task spawns its next occurrence
      if (updates.status === 'done' && fresh.repeat && fresh.due_at) {
        db.prepare(
          `INSERT INTO tasks (title, notes, status, due_at, priority, sort_order, created_at, repeat)
           VALUES (?, ?, 'todo', ?, ?, ?, ?, ?)`
        ).run(
          fresh.title,
          fresh.notes,
          nextDueAt(fresh.due_at, fresh.repeat, now()),
          fresh.priority,
          nextSortOrder(db, 'todo'),
          now().toISOString(),
          fresh.repeat
        )
      }
      return { task: fresh }
    }
  )

  app.delete('/api/tasks/:id', async (req, reply) => {
    const task = taskById(db, req.params.id)
    if (!task || task.deleted_at) return notFound(reply)
    db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), task.id)
    return { task: taskById(db, task.id) }
  })

  app.post('/api/tasks/:id/restore', async (req, reply) => {
    const task = taskById(db, req.params.id)
    if (!task || !task.deleted_at) return notFound(reply, 'No deleted task with that id')
    db.prepare('UPDATE tasks SET deleted_at = NULL WHERE id = ?').run(task.id)
    return { task: taskById(db, task.id) }
  })
}
