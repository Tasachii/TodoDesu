import { program } from 'commander'
import pc from 'picocolors'
import { api as defaultApi } from './api.js'
import { parseDue } from './dates.js'
import { printList, formatDue } from './format.js'
import {
  readLastList,
  writeLastList,
  readLastAction,
  writeLastAction,
  clearLastAction,
  readServerPid,
} from './state.js'
import { execFileSync } from 'node:child_process'

// ── dependency injection ───────────────────────────────────────────────────────
// Command handlers take a `deps` bag so the test suite can drive them with a
// fake api/io/process. Production wiring (below) passes nothing, so the real
// implementations are used and runtime behavior is unchanged.

function defaultDeps() {
  return {
    api: defaultApi,
    log: (...a) => console.log(...a),
    error: (...a) => console.error(...a),
    write: (s) => process.stdout.write(s),
    exit: (code) => process.exit(code),
    state: {
      readLastList,
      writeLastList,
      readLastAction,
      writeLastAction,
      clearLastAction,
      readServerPid,
    },
    exec: execFileSync,
    kill: (pid, sig) => process.kill(pid, sig),
    onSignal: (sig, fn) => process.once(sig, fn),
    offSignal: (sig, fn) => process.removeListener(sig, fn),
    setTimer: (fn, ms) => setInterval(fn, ms),
    clearTimer: (id) => clearInterval(id),
    now: () => Date.now(),
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function handleError(err, deps) {
  deps.error(pc.red(`Error: ${err.message}`))
  deps.exit(1)
}

function resolveIndex(n, deps = defaultDeps()) {
  const idx = parseInt(n, 10)
  const mapping = deps.state.readLastList()
  if (!mapping) {
    deps.error(pc.yellow('No task list found. Run `todo` first to see your tasks.'))
    deps.exit(1)
    return
  }
  const id = mapping[idx]
  if (!id) {
    deps.error(pc.yellow(`Index ${idx} not found. Run \`todo\` first to see your tasks.`))
    deps.exit(1)
    return
  }
  return id
}

function priorityToInt(p) {
  const map = { low: 1, med: 2, medium: 2, high: 3 }
  return map[p] ?? 0
}

// Coerce TODOO_PORT to a safe integer before it reaches a shell-spawning call.
// A crafted value (e.g. "4521; rm -rf ~") must never reach execFileSync as an
// arg, and a non-numeric one falls back to the default.
function serverPort() {
  const p = Number(process.env.TODOO_PORT)
  return Number.isInteger(p) && p > 0 ? p : 4521
}

/** Get local day boundaries as UTC ISO strings */
function todayBounds() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

// ── default command: todo (no args) ──────────────────────────────────────────

async function cmdDefault(deps = defaultDeps()) {
  const { api } = deps
  try {
    const { tasks } = await api.get('/api/tasks?status=todo,in_progress')
    const now = new Date()
    const { end: todayEnd } = todayBounds()

    const overdue = tasks.filter(t => t.due_at && new Date(t.due_at) < now)
    const today = tasks.filter(t => {
      if (!t.due_at) return false
      const d = new Date(t.due_at)
      return d >= now && new Date(t.due_at) <= new Date(todayEnd)
    })
    const inbox = tasks.filter(t => !t.due_at)

    const sections = [
      { label: 'Overdue', tasks: overdue },
      { label: 'Today', tasks: today },
      { label: 'Inbox', tasks: inbox },
    ]

    const anyTask = overdue.length + today.length + inbox.length > 0
    if (!anyTask) {
      deps.log(pc.green('\nAll clear! No pending tasks.'))
      deps.state.writeLastList({})
      return
    }

    printList(sections)
  } catch (err) {
    handleError(err, deps)
  }
}

// ── add ───────────────────────────────────────────────────────────────────────

async function cmdAdd(title, opts, deps = defaultDeps()) {
  const { api } = deps
  try {
    const body = { title }
    if (opts.due) {
      const iso = parseDue(opts.due)
      if (!iso) {
        deps.error(pc.red(`Could not parse date: "${opts.due}"`))
        deps.exit(1)
        return
      }
      body.due_at = iso
    }
    if (opts.priority) body.priority = priorityToInt(opts.priority)
    if (opts.notes) body.notes = opts.notes
    if (opts.repeat) {
      if (!['daily', 'weekly', 'monthly'].includes(opts.repeat)) {
        deps.error(pc.red(`Invalid repeat: "${opts.repeat}". Use daily | weekly | monthly.`))
        deps.exit(1)
        return
      }
      if (!body.due_at) {
        deps.error(pc.red('A repeating task needs a due date — add -d "tomorrow 9am".'))
        deps.exit(1)
        return
      }
      body.repeat = opts.repeat
    }

    const { task } = await api.post('/api/tasks', body)
    const dueStr = task.due_at ? ` due ${formatDue(task.due_at)}` : ''
    deps.log(pc.green(`Added: "${task.title}"${dueStr} (id ${task.id})`))
  } catch (err) {
    handleError(err, deps)
  }
}

// ── list --all ────────────────────────────────────────────────────────────────

async function cmdList(opts, deps = defaultDeps()) {
  const { api } = deps
  try {
    if (opts.all) {
      const { tasks: all } = await api.get('/api/tasks')
      const todo = all.filter(t => t.status === 'todo')
      const inProg = all.filter(t => t.status === 'in_progress')
      const done = all.filter(t => t.status === 'done').slice(-20)

      printList([
        { label: 'Todo', tasks: todo },
        { label: 'In Progress', tasks: inProg },
        { label: 'Done (last 20)', tasks: done },
      ])
    } else {
      await cmdDefault(deps)
    }
  } catch (err) {
    handleError(err, deps)
  }
}

// ── done ──────────────────────────────────────────────────────────────────────

async function cmdDone(n, deps = defaultDeps()) {
  const { api } = deps
  try {
    const id = resolveIndex(n, deps)
    const { task } = await api.patch(`/api/tasks/${id}`, { status: 'done' })
    deps.state.writeLastAction({ type: 'done', task_id: id })
    deps.log(pc.green(`Done: "${task.title}"`))
  } catch (err) {
    handleError(err, deps)
  }
}

// ── start ─────────────────────────────────────────────────────────────────────

async function cmdStart(n, deps = defaultDeps()) {
  const { api } = deps
  try {
    const id = resolveIndex(n, deps)
    const { task } = await api.patch(`/api/tasks/${id}`, { status: 'in_progress' })
    deps.log(pc.cyan(`Started: "${task.title}"`))
  } catch (err) {
    handleError(err, deps)
  }
}

// ── rm ────────────────────────────────────────────────────────────────────────

async function cmdRm(n, deps = defaultDeps()) {
  const { api } = deps
  try {
    const id = resolveIndex(n, deps)
    const { task } = await api.delete(`/api/tasks/${id}`)
    deps.state.writeLastAction({ type: 'delete', task_id: id })
    deps.log(pc.dim(`Deleted: "${task.title}"`))
    deps.log(pc.dim('Run `todo undo` to restore.'))
  } catch (err) {
    handleError(err, deps)
  }
}

// ── undo ──────────────────────────────────────────────────────────────────────

async function cmdUndo(deps = defaultDeps()) {
  const { api } = deps
  try {
    const action = deps.state.readLastAction()
    if (!action || !action.type) {
      deps.log(pc.yellow('Nothing to undo.'))
      return
    }
    if (action.type === 'delete') {
      const { task } = await api.post(`/api/tasks/${action.task_id}/restore`)
      deps.state.clearLastAction()
      deps.log(pc.green(`Restored: "${task.title}"`))
    } else if (action.type === 'done') {
      const { task } = await api.patch(`/api/tasks/${action.task_id}`, { status: 'todo' })
      deps.state.clearLastAction()
      deps.log(pc.green(`Marked todo again: "${task.title}"`))
    } else {
      deps.log(pc.yellow('Nothing to undo.'))
    }
  } catch (err) {
    handleError(err, deps)
  }
}

// ── focus ─────────────────────────────────────────────────────────────────────

async function cmdFocus(n, opts, deps = defaultDeps()) {
  const { api } = deps
  const minutes = parseInt(opts.time ?? 25, 10)
  const duration_sec = minutes * 60

  let task_id
  try {
    task_id = resolveIndex(n, deps)
  } catch {
    // resolveIndex already exits on error
    return
  }
  // resolveIndex returns undefined (and has called exit) when there is no list
  if (task_id === undefined) return

  let session
  try {
    const result = await api.post('/api/focus/start', { task_id, duration_sec })
    session = result.session
  } catch (err) {
    if (err.status === 409) {
      deps.error(pc.yellow('A focus session is already active. Run `todo server status` or check the web app.'))
      deps.exit(1)
      return
    }
    handleError(err, deps)
    return
  }

  const started = new Date(session.started_at).getTime()
  const planned = session.planned_sec * 1000
  const BAR_WIDTH = 30

  function renderBar() {
    const now = deps.now()
    const elapsed = now - started
    const remaining = Math.max(0, planned - elapsed)
    const remainSec = Math.ceil(remaining / 1000)
    const progress = Math.min(1, elapsed / planned)
    const filled = Math.round(progress * BAR_WIDTH)
    const empty = BAR_WIDTH - filled
    const bar = pc.green('█'.repeat(filled)) + pc.dim('░'.repeat(empty))
    const mins = String(Math.floor(remainSec / 60)).padStart(2, '0')
    const secs = String(remainSec % 60).padStart(2, '0')
    deps.write(`\r[${bar}] ${mins}:${secs} remaining `)
    return remaining <= 0
  }

  deps.log(pc.cyan(`\nFocus: ${minutes}m on task #${n}. Press Ctrl-C to stop.\n`))

  let interval
  let stopped = false

  const onSigint = async () => {
    await stop(false)
    deps.exit(0)
  }

  async function stop(completed) {
    if (stopped) return
    stopped = true
    deps.clearTimer(interval)
    deps.offSignal('SIGINT', onSigint)
    deps.write('\n')
    try {
      await api.post(`/api/focus/${session.id}/stop`, { completed })
    } catch (err) {
      // Best-effort cleanup, but a failed stop leaves a phantom active
      // session — warn so the user knows to clear it from the web app.
      deps.error(pc.dim(`(could not record stop: ${err.message})`))
    }
    if (completed) {
      deps.write('\x07') // bell
      deps.log(pc.green('\nFocus session complete!'))
      deps.log(pc.dim(`Run \`todo done ${n}\` to mark the task done.`))
    } else {
      deps.log(pc.yellow('\nFocus session stopped.'))
    }
  }

  deps.onSignal('SIGINT', onSigint)

  interval = deps.setTimer(async () => {
    const done = renderBar()
    if (done) {
      await stop(true)
      deps.exit(0)
    }
  }, 1000)

  // Initial render
  renderBar()

  // Exposed for tests so the interval tick / stop can be driven directly.
  return { renderBar, stop }
}

// ── open ──────────────────────────────────────────────────────────────────────

async function cmdOpen(deps = defaultDeps()) {
  const { api } = deps
  try {
    await api.get('/api/health')
    deps.exec('open', [`http://127.0.0.1:${serverPort()}`])
  } catch (err) {
    handleError(err, deps)
  }
}

// ── server ────────────────────────────────────────────────────────────────────

async function cmdServer(action, deps = defaultDeps()) {
  const { api } = deps

  if (action === 'start') {
    const { serverIsUp, ensureServer } = await import('./api.js')
    if (await serverIsUp()) {
      deps.log(pc.green('Server is already running.'))
    } else {
      await ensureServer() // exits with an error message if it cannot start
      deps.log(pc.green('Server started.'))
    }
  } else if (action === 'stop') {
    let killed = false
    const pid = deps.state.readServerPid()
    if (pid) {
      try {
        deps.kill(pid, 'SIGTERM')
        killed = true
        deps.log(pc.dim(`Stopped server (pid ${pid}).`))
      } catch (err) {
        // Stale PID (process already gone) — fall through to the lsof scan.
        deps.error(pc.dim(`(pid ${pid} not running: ${err.message})`))
      }
    }
    if (!killed) {
      try {
        const pids = deps.exec('lsof', ['-ti', `:${serverPort()}`]).toString().trim()
        if (pids) {
          pids.split('\n').forEach(p => {
            try { deps.kill(parseInt(p, 10), 'SIGTERM') } catch (err) {
              deps.error(pc.dim(`(could not kill pid ${p}: ${err.message})`))
            }
          })
          deps.log(pc.dim('Stopped server.'))
        } else {
          deps.log(pc.yellow('No server process found.'))
        }
      } catch {
        deps.log(pc.yellow('No server process found.'))
      }
    }
  } else if (action === 'status') {
    try {
      const { version } = await api.get('/api/health')
      deps.log(pc.green(`Server running — version ${version}`))
    } catch {
      deps.log(pc.yellow('Server is not running.'))
    }
  } else {
    deps.error(pc.red(`Unknown server action: ${action}. Use start|stop|status.`))
    deps.exit(1)
  }
}

// ── wire up commander ─────────────────────────────────────────────────────────
// Commander passes (…args, command); the handlers default `deps`, so the extra
// command object is harmless — none of them read it.

program
  .name('todo')
  .description('TodoDesu CLI')
  .version('0.1.0')
  .action(() => cmdDefault())

program
  .command('add <title>')
  .description('Add a new task')
  .option('-d, --due <text>', 'Due date (natural language)')
  .option('-p, --priority <level>', 'Priority: low | med | high')
  .option('-n, --notes <text>', 'Notes')
  .option('-r, --repeat <rule>', 'Repeat: daily | weekly | monthly (requires --due)')
  .action((title, opts) => cmdAdd(title, opts))

program
  .command('list')
  .description('List tasks (use --all for all statuses)')
  .option('--all', 'Show all tasks grouped by status')
  .action((opts) => cmdList(opts))

program
  .command('done <n>')
  .description('Mark task <n> (from last list) as done')
  .action((n) => cmdDone(n))

program
  .command('start <n>')
  .description('Mark task <n> as in_progress')
  .action((n) => cmdStart(n))

program
  .command('rm <n>')
  .description('Soft-delete task <n>')
  .action((n) => cmdRm(n))

program
  .command('undo')
  .description('Undo the last done or rm action')
  .action(() => cmdUndo())

program
  .command('focus <n>')
  .description('Start a focus session on task <n>')
  .option('-t, --time <minutes>', 'Duration in minutes (default 25)')
  .action((n, opts) => cmdFocus(n, opts))

program
  .command('open')
  .description('Open the web UI in the browser')
  .action(() => cmdOpen())

program
  .command('server <action>')
  .description('Manage the server: start|stop|status')
  .action((action) => cmdServer(action))

export {
  program,
  resolveIndex,
  priorityToInt,
  todayBounds,
  cmdDefault,
  cmdAdd,
  cmdList,
  cmdDone,
  cmdStart,
  cmdRm,
  cmdUndo,
  cmdFocus,
  cmdOpen,
  cmdServer,
}
