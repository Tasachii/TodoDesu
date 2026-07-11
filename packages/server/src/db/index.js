import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const MIGRATIONS = [
  `
  CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    notes        TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
    due_at       TEXT,
    priority     INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
    sort_order   REAL NOT NULL,
    created_at   TEXT NOT NULL,
    completed_at TEXT,
    deleted_at   TEXT
  );
  CREATE INDEX idx_tasks_status ON tasks (status) WHERE deleted_at IS NULL;
  CREATE INDEX idx_tasks_due ON tasks (due_at) WHERE deleted_at IS NULL;

  CREATE TABLE focus_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id      INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    planned_sec  INTEGER NOT NULL,
    started_at   TEXT NOT NULL,
    ended_at     TEXT,
    duration_sec INTEGER,
    completed    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2 — recurring tasks: completing a task with a repeat rule spawns the next occurrence
  `
  ALTER TABLE tasks ADD COLUMN repeat TEXT
    CHECK (repeat IS NULL OR repeat IN ('daily','weekly','monthly'));
  `,
  // v3 — link each generated occurrence to its parent. The unique index makes
  // recurrence spawning idempotent while NULL keeps every pre-v3 row valid.
  `
  ALTER TABLE tasks ADD COLUMN recurrence_parent_id INTEGER
    REFERENCES tasks(id) ON DELETE SET NULL;
  CREATE UNIQUE INDEX idx_tasks_recurrence_parent
    ON tasks (recurrence_parent_id)
    WHERE recurrence_parent_id IS NOT NULL;
  `,
]

export function defaultDbPath() {
  return process.env.TODOO_DB || join(homedir(), '.todoo', 'data.db')
}

export function openDb(path = defaultDbPath()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  purgeOldDeleted(db)
  return db
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)')
  const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map((r) => r.id))
  MIGRATIONS.forEach((sql, i) => {
    const id = i + 1
    if (applied.has(id)) return
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(id)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
}

const PURGE_AFTER_DAYS = 30

function purgeOldDeleted(db) {
  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 3600 * 1000).toISOString()
  db.prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff)
}
