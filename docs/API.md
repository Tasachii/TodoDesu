# Todoo API Contract (v1)

Base URL: `http://127.0.0.1:4521`
All bodies are JSON. All timestamps are ISO 8601 UTC strings (e.g. `2026-06-10T11:00:00.000Z`).
The server never computes "today" — clients always pass explicit time ranges in their local timezone, converted to UTC.

## Quick examples

```bash
# add a task due tonight
curl -X POST http://127.0.0.1:4521/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Read chapter 4", "due_at": "2026-06-11T11:00:00.000Z", "priority": 2}'

# everything still open
curl 'http://127.0.0.1:4521/api/tasks?status=todo,in_progress'

# complete task 1 (drag & drop would also send sort_order)
curl -X PATCH http://127.0.0.1:4521/api/tasks/1 \
  -H 'Content-Type: application/json' -d '{"status": "done"}'

# today's stats — note the client supplies its own day boundaries in UTC
curl 'http://127.0.0.1:4521/api/stats?from=2026-06-10T17:00:00.000Z&to=2026-06-11T17:00:00.000Z'
```

## Objects

### Task
```json
{
  "id": 1,
  "title": "Read chapter 4",
  "notes": "",
  "status": "todo",            // "todo" | "in_progress" | "done"
  "due_at": "2026-06-10T11:00:00.000Z",  // or null
  "priority": 0,                // 0 none, 1 low, 2 medium, 3 high
  "repeat": null,               // null | "daily" | "weekly" | "monthly" (requires due_at)
  "recurrence_parent_id": null, // occurrence that generated this row, or null
  "sort_order": 3.5,            // position inside its status column (ascending)
  "created_at": "2026-06-09T08:00:00.000Z",
  "completed_at": null,         // set when status becomes "done"
  "deleted_at": null            // soft delete marker
}
```

### FocusSession
```json
{
  "id": 1,
  "task_id": 4,                 // or null (free focus)
  "planned_sec": 1500,
  "started_at": "2026-06-10T08:00:00.000Z",
  "ended_at": null,             // null while running
  "duration_sec": null,         // actual elapsed seconds, set on stop
  "completed": 0                // 1 if the full planned duration elapsed
}
```

## Endpoints

### Health
- `GET /api/health` → `200 {"ok": true, "version": "0.1.0"}`

### Tasks
- `GET /api/tasks` → `200 {"tasks": [Task]}` ordered by `sort_order` ASC.
  Query params (all optional):
  - `status` — comma separated, e.g. `todo,in_progress`
  - `due_after`, `due_before` — ISO strings, filter on `due_at`
  - `q` — case-insensitive substring match on title/notes
  - `deleted=true` — return ONLY soft-deleted tasks (default: excluded)
- `POST /api/tasks` body `{title, notes?, due_at?, priority?, status?}` → `201 {"task": Task}`.
  `title` required, non-empty. New task goes to the bottom of its status column.
- `GET /api/tasks/:id` → `200 {"task": Task}` | `404`
- `PATCH /api/tasks/:id` body: any subset of `{title, notes, due_at, priority, status, sort_order}` → `200 {"task": Task}`.
  Rules:
  - `status` → `"done"` sets `completed_at` (now). Leaving `"done"` clears it.
  - `status` change WITHOUT `sort_order` appends to bottom of the target column.
  - Drag & drop sends both `status` and `sort_order` (fractional indexing; client computes midpoint).
  - A `repeat` rule requires a due date (`400 VALIDATION` otherwise — clear both together).
  - `status` → `"done"` on a task with `repeat` + `due_at` ALSO inserts the next
    occurrence: same title/notes/priority/repeat, status `todo`, due advanced by the
    rule (day/week/month, keeping the time of day) until it lands in the future. Each
    occurrence generates at most one child, so undoing and completing it again is idempotent.
- `DELETE /api/tasks/:id` → `200 {"task": Task}` (soft delete, sets `deleted_at`)
- `POST /api/tasks/:id/restore` → `200 {"task": Task}` (clears `deleted_at`)

### Focus
- `POST /api/focus/start` body `{task_id?, duration_sec}` → `201 {"session": FocusSession}`.
  `409` if a session is already active. If `task_id` given, that task's status is set to `in_progress` (unless already `done`).
- `POST /api/focus/:id/stop` body `{completed: boolean}` → `200 {"session": FocusSession}`.
  Server computes `duration_sec = now - started_at` (capped at `planned_sec`).
- `GET /api/focus/active` → `200 {"session": FocusSession | null}` (includes `task_title` when task_id is set)

### Stats
- `GET /api/stats?from=ISO&to=ISO` → `200 {"focus_sec": 4500, "focus_sessions": 3, "tasks_completed": 5}`
  Counts focus sessions whose `started_at` and completed tasks whose `completed_at` fall in `[from, to)`.

### Settings
- `GET /api/settings` → `200 {"settings": {...}}` — stored values merged over defaults:
  `theme: "auto"`, `focus_style: "timer"` (`"timer" | "pomodoro"`), `focus_duration_sec: "1500"`,
  `break_duration_sec: "300"`, `pomodoro_work_sec: "1500"`, `pomodoro_break_sec: "300"`,
  `pomodoro_long_break_sec: "900"`, `pomodoro_rounds: "4"`. All values are strings.
- `PUT /api/settings` body `{key: value, ...}` (merge) → `200 {"settings": {...}}`

### Backup
- `GET /api/export` → `200 {"app": "todoo", "version": 1, "exported_at": ISO, "tasks": [Task] (including soft-deleted), "focus_sessions": [FocusSession], "settings": {key: value}}`
- `POST /api/import` body = an export payload (validated: `app` must be `"todoo"`, `version` must be `1`) → `200 {"imported": {"tasks": n, "focus_sessions": n, "settings": n}}`.
  Replaces ALL existing data atomically; ids are preserved. The same payload shape is
  produced and accepted by the standalone engine, so backups move between modes.

## Errors
Non-2xx responses: `{"error": {"code": "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "INTERNAL", "message": "..."}}`

Bodies are validated strictly: unknown fields, malformed JSON, and empty bodies that
claim `application/json` are all rejected with `400 VALIDATION`.

## Server behavior
- Binds `127.0.0.1` by default. Set `TODOO_HOST=0.0.0.0` to allow same-Wi-Fi devices (trusted networks only — there is no auth in v1).
- DB file: `~/.todoo/data.db` (override with `TODOO_DB`, use `:memory:` in tests).
- On startup, purges soft-deleted tasks older than 30 days.
- Serves the built web app (`packages/web/dist`) at `/` when present.
