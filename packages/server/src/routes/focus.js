import { nextSortOrder, notFound } from '../db/queries.js'

function sessionById(db, id) {
  return db.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(id) ?? null
}

export default async function focusRoutes(app) {
  const { db } = app
  const clock = app.now ?? (() => new Date())

  app.post(
    '/api/focus/start',
    {
      schema: {
        body: {
          type: 'object',
          required: ['duration_sec'],
          properties: {
            task_id: { type: ['integer', 'null'] },
            duration_sec: { type: 'integer', minimum: 60, maximum: 14400 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const active = db.prepare('SELECT id FROM focus_sessions WHERE ended_at IS NULL').get()
      if (active) {
        return reply
          .code(409)
          .send({ error: { code: 'CONFLICT', message: 'A focus session is already active' } })
      }
      const { task_id = null, duration_sec } = req.body
      if (task_id != null) {
        const task = db
          .prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL')
          .get(task_id)
        if (!task) return notFound(reply, 'Task not found')
        if (task.status === 'todo') {
          db.prepare('UPDATE tasks SET status = ?, sort_order = ? WHERE id = ?').run(
            'in_progress',
            nextSortOrder(db, 'in_progress'),
            task.id
          )
        }
      }
      const info = db
        .prepare(
          'INSERT INTO focus_sessions (task_id, planned_sec, started_at) VALUES (?, ?, ?)'
        )
        .run(task_id, duration_sec, clock().toISOString())
      reply.code(201)
      return { session: sessionById(db, info.lastInsertRowid) }
    }
  )

  app.post(
    '/api/focus/:id/stop',
    {
      schema: {
        body: {
          type: 'object',
          properties: { completed: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const session = sessionById(db, req.params.id)
      if (!session) return notFound(reply)
      if (session.ended_at) return { session } // idempotent

      const now = clock()
      // Clamp at 0 as well as planned_sec: a backwards server clock would
      // otherwise write a negative duration_sec and corrupt stats.focus_sec
      // sums. Mirrors the standalone engine (web/src/api/local.js).
      const elapsed = Math.max(
        0,
        Math.min(Math.round((now - new Date(session.started_at)) / 1000), session.planned_sec)
      )
      db.prepare(
        'UPDATE focus_sessions SET ended_at = ?, duration_sec = ?, completed = ? WHERE id = ?'
      ).run(now.toISOString(), elapsed, req.body?.completed ? 1 : 0, session.id)
      return { session: sessionById(db, session.id) }
    }
  )

  app.get('/api/focus/active', async () => {
    const session =
      db
        .prepare(
          `SELECT fs.*, t.title AS task_title
           FROM focus_sessions fs
           LEFT JOIN tasks t ON t.id = fs.task_id
           WHERE fs.ended_at IS NULL`
        )
        .get() ?? null
    return { session }
  })
}
