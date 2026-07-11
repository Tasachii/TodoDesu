import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db/index.js'

let tempDir

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('database migrations', () => {
  it('upgrades a v2 database without changing existing recurring tasks', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'todoo-migration-'))
    const path = join(tempDir, 'legacy.db')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE _migrations (id INTEGER PRIMARY KEY);
      INSERT INTO _migrations (id) VALUES (1), (2);
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
        due_at TEXT,
        priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
        sort_order REAL NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        deleted_at TEXT,
        repeat TEXT CHECK (repeat IS NULL OR repeat IN ('daily','weekly','monthly'))
      );
      CREATE INDEX idx_tasks_status ON tasks (status) WHERE deleted_at IS NULL;
      CREATE INDEX idx_tasks_due ON tasks (due_at) WHERE deleted_at IS NULL;
      CREATE TABLE focus_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        planned_sec INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_sec INTEGER,
        completed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO tasks
        (id, title, status, due_at, priority, sort_order, created_at, repeat)
      VALUES
        (7, 'legacy daily', 'todo', '2026-07-12T08:00:00.000Z', 0, 1, '2026-07-11T08:00:00.000Z', 'daily');
    `)
    legacy.close()

    const upgraded = openDb(path)
    const task = upgraded.prepare('SELECT * FROM tasks WHERE id = 7').get()
    expect(task).toMatchObject({
      id: 7,
      title: 'legacy daily',
      repeat: 'daily',
      recurrence_parent_id: null,
    })
    expect(upgraded.prepare('SELECT id FROM _migrations ORDER BY id').all()).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ])
    upgraded.close()
  })
})
