// Whole-database export/import. The payload is shared with the standalone
// engine (packages/web/src/api/local.js), so a backup taken on one can be
// restored on the other.

export const BACKUP_VERSION = 1

export default async function backupRoutes(app) {
  const { db } = app

  app.get('/api/export', async () => ({
    app: 'todoo',
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    tasks: db.prepare('SELECT * FROM tasks ORDER BY id').all(),
    focus_sessions: db.prepare('SELECT * FROM focus_sessions ORDER BY id').all(),
    settings: Object.fromEntries(
      db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])
    ),
  }))

  app.post(
    '/api/import',
    {
      schema: {
        body: {
          type: 'object',
          required: ['app', 'version', 'tasks'],
          properties: {
            app: { const: 'todoo' },
            version: { const: BACKUP_VERSION },
            exported_at: { type: 'string' },
            tasks: { type: 'array' },
            focus_sessions: { type: 'array' },
            settings: { type: 'object' },
          },
        },
      },
    },
    async (req) => {
      const { tasks = [], focus_sessions = [], settings = {} } = req.body

      const insertTask = db.prepare(
        `INSERT INTO tasks
           (id, title, notes, status, due_at, priority, sort_order, created_at, completed_at,
            deleted_at, repeat, recurrence_parent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertSession = db.prepare(
        `INSERT INTO focus_sessions (id, task_id, planned_sec, started_at, ended_at, duration_sec, completed)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')

      // Replace everything atomically — a failed import leaves the old data intact.
      db.exec('BEGIN')
      try {
        // Backups are normally id-ordered, but defer the new self-reference so
        // a valid externally reordered payload also imports atomically.
        db.exec('PRAGMA defer_foreign_keys = ON')
        db.exec('DELETE FROM focus_sessions; DELETE FROM tasks; DELETE FROM settings;')
        for (const t of tasks) {
          insertTask.run(
            t.id,
            String(t.title ?? ''),
            String(t.notes ?? ''),
            t.status,
            t.due_at ?? null,
            t.priority ?? 0,
            t.sort_order ?? 0,
            t.created_at ?? new Date().toISOString(),
            t.completed_at ?? null,
            t.deleted_at ?? null,
            t.repeat ?? null,
            t.recurrence_parent_id ?? null
          )
        }
        for (const s of focus_sessions) {
          insertSession.run(
            s.id,
            s.task_id ?? null,
            s.planned_sec,
            s.started_at,
            s.ended_at ?? null,
            s.duration_sec ?? null,
            s.completed ?? 0
          )
        }
        for (const [key, value] of Object.entries(settings)) {
          insertSetting.run(key, String(value))
        }
        db.exec('COMMIT')
      } catch {
        db.exec('ROLLBACK')
        // Don't leak raw SQLite constraint text — the payload is simply bad.
        const friendly = new Error('Backup file is invalid or corrupted')
        friendly.statusCode = 400
        throw friendly
      }

      return {
        imported: {
          tasks: tasks.length,
          focus_sessions: focus_sessions.length,
          settings: Object.keys(settings).length,
        },
      }
    }
  )
}
