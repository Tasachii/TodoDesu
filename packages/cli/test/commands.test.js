import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
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
} from '../src/index.js'

// A sentinel thrown by the fake `exit` so a handler stops just like it would
// after the real process.exit, and tests can assert the exit code.
class ExitError extends Error {
  constructor(code) {
    super(`exit ${code}`)
    this.code = code
  }
}

function makeDeps(overrides = {}) {
  const logs = []
  const errors = []
  const writes = []
  const actions = { lastList: null, lastAction: null, serverPid: null, cleared: false }
  const deps = {
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      put: vi.fn(),
    },
    log: (...a) => logs.push(a.join(' ')),
    error: (...a) => errors.push(a.join(' ')),
    write: (s) => writes.push(s),
    exit: vi.fn((code) => {
      throw new ExitError(code)
    }),
    state: {
      readLastList: vi.fn(() => actions.lastList),
      writeLastList: vi.fn((m) => {
        actions.lastList = m
      }),
      readLastAction: vi.fn(() => actions.lastAction),
      writeLastAction: vi.fn((a) => {
        actions.lastAction = a
      }),
      clearLastAction: vi.fn(() => {
        actions.cleared = true
      }),
      readServerPid: vi.fn(() => actions.serverPid),
    },
    exec: vi.fn(() => Buffer.from('')),
    kill: vi.fn(),
    onSignal: vi.fn(),
    offSignal: vi.fn(),
    setTimer: vi.fn(() => 1),
    clearTimer: vi.fn(),
    now: vi.fn(() => 0),
    _logs: logs,
    _errors: errors,
    _writes: writes,
    _actions: actions,
    ...overrides,
  }
  return deps
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('priorityToInt', () => {
  it('maps named levels and defaults unknowns to 0', () => {
    expect(priorityToInt('low')).toBe(1)
    expect(priorityToInt('med')).toBe(2)
    expect(priorityToInt('medium')).toBe(2)
    expect(priorityToInt('high')).toBe(3)
    expect(priorityToInt('???')).toBe(0)
    expect(priorityToInt(undefined)).toBe(0)
  })
})

describe('todayBounds', () => {
  it('returns local-midnight start and end as ISO strings bracketing now', () => {
    const { start, end } = todayBounds()
    const now = Date.now()
    expect(Date.parse(start)).toBeLessThanOrEqual(now)
    expect(Date.parse(end)).toBeGreaterThanOrEqual(now)
    // end is later the same day than start
    expect(Date.parse(end)).toBeGreaterThan(Date.parse(start))
  })
})

describe('resolveIndex', () => {
  it('returns the mapped id for a valid index', () => {
    const deps = makeDeps()
    deps._actions.lastList = { 1: 42, 2: 43 }
    expect(resolveIndex('2', deps)).toBe(43)
  })

  it('exits 1 with a yellow message when there is no saved list', () => {
    const deps = makeDeps()
    deps._actions.lastList = null
    expect(() => resolveIndex('1', deps)).toThrow(ExitError)
    expect(deps.exit).toHaveBeenCalledWith(1)
    expect(deps._errors.join('\n')).toMatch(/No task list/)
  })

  it('exits 1 when the index is not in the mapping', () => {
    const deps = makeDeps()
    deps._actions.lastList = { 1: 42 }
    expect(() => resolveIndex('9', deps)).toThrow(ExitError)
    expect(deps.exit).toHaveBeenCalledWith(1)
    expect(deps._errors.join('\n')).toMatch(/not found/)
  })
})

describe('cmdDone', () => {
  it('PATCHes status done, records the undo action, and prints the title', async () => {
    const deps = makeDeps()
    deps._actions.lastList = { 1: 7 }
    deps.api.patch.mockResolvedValue({ task: { id: 7, title: 'ship it' } })

    await cmdDone('1', deps)

    expect(deps.api.patch).toHaveBeenCalledWith('/api/tasks/7', { status: 'done' })
    expect(deps.state.writeLastAction).toHaveBeenCalledWith({ type: 'done', task_id: 7 })
    expect(deps._logs.join('\n')).toMatch(/Done: "ship it"/)
  })

  it('routes API failures through handleError (exit 1)', async () => {
    const deps = makeDeps()
    deps._actions.lastList = { 1: 7 }
    deps.api.patch.mockRejectedValue(new Error('network down'))

    await expect(cmdDone('1', deps)).rejects.toThrow(ExitError)
    expect(deps._errors.join('\n')).toMatch(/network down/)
  })
})

describe('cmdStart', () => {
  it('PATCHes in_progress and prints the title', async () => {
    const deps = makeDeps()
    deps._actions.lastList = { 1: 7 }
    deps.api.patch.mockResolvedValue({ task: { id: 7, title: 'go' } })
    await cmdStart('1', deps)
    expect(deps.api.patch).toHaveBeenCalledWith('/api/tasks/7', { status: 'in_progress' })
    expect(deps._logs.join('\n')).toMatch(/Started: "go"/)
  })
})

describe('cmdRm', () => {
  it('soft-deletes, records a delete action, and hints at undo', async () => {
    const deps = makeDeps()
    deps._actions.lastList = { 1: 7 }
    deps.api.delete.mockResolvedValue({ task: { id: 7, title: 'gone' } })

    await cmdRm('1', deps)

    expect(deps.api.delete).toHaveBeenCalledWith('/api/tasks/7')
    expect(deps.state.writeLastAction).toHaveBeenCalledWith({ type: 'delete', task_id: 7 })
    expect(deps._logs.join('\n')).toMatch(/Deleted: "gone"/)
    expect(deps._logs.join('\n')).toMatch(/undo/)
  })
})

describe('cmdUndo', () => {
  it('restores a deleted task and clears the action', async () => {
    const deps = makeDeps()
    deps._actions.lastAction = { type: 'delete', task_id: 7 }
    deps.api.post.mockResolvedValue({ task: { id: 7, title: 'back' } })

    await cmdUndo(deps)

    expect(deps.api.post).toHaveBeenCalledWith('/api/tasks/7/restore')
    expect(deps.state.clearLastAction).toHaveBeenCalled()
    expect(deps._logs.join('\n')).toMatch(/Restored: "back"/)
  })

  it('re-opens a done task (status → todo) and clears the action', async () => {
    const deps = makeDeps()
    deps._actions.lastAction = { type: 'done', task_id: 7 }
    deps.api.patch.mockResolvedValue({ task: { id: 7, title: 'redo' } })

    await cmdUndo(deps)

    expect(deps.api.patch).toHaveBeenCalledWith('/api/tasks/7', { status: 'todo' })
    expect(deps.state.clearLastAction).toHaveBeenCalled()
    expect(deps._logs.join('\n')).toMatch(/Marked todo again/)
  })

  it('prints "Nothing to undo" when there is no action', async () => {
    const deps = makeDeps()
    deps._actions.lastAction = null
    await cmdUndo(deps)
    expect(deps._logs.join('\n')).toMatch(/Nothing to undo/)
    expect(deps.api.post).not.toHaveBeenCalled()
  })

  it('prints "Nothing to undo" for an unknown action type', async () => {
    const deps = makeDeps()
    deps._actions.lastAction = { type: 'weird' }
    await cmdUndo(deps)
    expect(deps._logs.join('\n')).toMatch(/Nothing to undo/)
  })
})

describe('cmdAdd', () => {
  it('posts a plain task and prints the id', async () => {
    const deps = makeDeps()
    deps.api.post.mockResolvedValue({ task: { id: 3, title: 'plain', due_at: null } })
    await cmdAdd('plain', {}, deps)
    expect(deps.api.post).toHaveBeenCalledWith('/api/tasks', { title: 'plain' })
    expect(deps._logs.join('\n')).toMatch(/Added: "plain".*id 3/)
  })

  it('rejects an unparseable due date with exit 1', async () => {
    const deps = makeDeps()
    await expect(cmdAdd('x', { due: 'asdfghjkl' }, deps)).rejects.toThrow(ExitError)
    expect(deps._errors.join('\n')).toMatch(/Could not parse date/)
  })

  it('maps priority and threads notes + a valid repeat with a due date', async () => {
    const deps = makeDeps()
    deps.api.post.mockResolvedValue({ task: { id: 5, title: 'r', due_at: null } })
    await cmdAdd('r', { priority: 'high', notes: 'hi', due: 'tomorrow 9am', repeat: 'daily' }, deps)
    const body = deps.api.post.mock.calls[0][1]
    expect(body.priority).toBe(3)
    expect(body.notes).toBe('hi')
    expect(body.repeat).toBe('daily')
    expect(typeof body.due_at).toBe('string')
  })

  it('rejects an invalid repeat rule', async () => {
    const deps = makeDeps()
    await expect(
      cmdAdd('r', { due: 'tomorrow 9am', repeat: 'fortnightly' }, deps)
    ).rejects.toThrow(ExitError)
    expect(deps._errors.join('\n')).toMatch(/Invalid repeat/)
  })

  it('rejects repeat without a due date', async () => {
    const deps = makeDeps()
    await expect(cmdAdd('r', { repeat: 'daily' }, deps)).rejects.toThrow(ExitError)
    expect(deps._errors.join('\n')).toMatch(/needs a due date/)
  })
})

describe('cmdDefault / cmdList', () => {
  const tasks = (over = []) => ({ tasks: over })

  it('prints "All clear" and resets the list when there are no pending tasks', async () => {
    const deps = makeDeps()
    deps.api.get.mockResolvedValue(tasks([]))
    await cmdDefault(deps)
    expect(deps._logs.join('\n')).toMatch(/All clear/)
    expect(deps.state.writeLastList).toHaveBeenCalledWith({})
  })

  it('cmdList without --all falls through to the default view', async () => {
    const deps = makeDeps()
    deps.api.get.mockResolvedValue(tasks([]))
    await cmdList({}, deps)
    expect(deps.api.get).toHaveBeenCalledWith('/api/tasks?status=todo,in_progress')
  })

  it('cmdList --all fetches every task', async () => {
    const deps = makeDeps()
    deps.api.get.mockResolvedValue(
      tasks([
        { id: 1, status: 'todo', title: 'a' },
        { id: 2, status: 'in_progress', title: 'b' },
        { id: 3, status: 'done', title: 'c' },
      ])
    )
    await cmdList({ all: true }, deps)
    expect(deps.api.get).toHaveBeenCalledWith('/api/tasks')
  })

  it('surfaces API errors via handleError', async () => {
    const deps = makeDeps()
    deps.api.get.mockRejectedValue(new Error('boom'))
    await expect(cmdDefault(deps)).rejects.toThrow(ExitError)
  })
})

describe('cmdFocus', () => {
  it('does nothing when resolveIndex has no list (already exited)', async () => {
    const deps = makeDeps()
    deps._actions.lastList = null
    // resolveIndex throws ExitError inside cmdFocus's try, which is swallowed
    await cmdFocus('1', {}, deps)
    expect(deps.api.post).not.toHaveBeenCalled()
  })

  it('starts a session, registers SIGINT, and renders the initial bar', async () => {
    const deps = makeDeps()
    deps._actions.lastList = { 1: 7 }
    deps.api.post.mockResolvedValue({
      session: { id: 11, started_at: new Date(0).toISOString(), planned_sec: 1500 },
    })
    await cmdFocus('1', { time: '25' }, deps)

    expect(deps.api.post).toHaveBeenCalledWith('/api/focus/start', {
      task_id: 7,
      duration_sec: 1500,
    })
    expect(deps.onSignal).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    expect(deps.setTimer).toHaveBeenCalled()
    // initial renderBar wrote a progress bar with mm:ss remaining
    expect(deps._writes.join('')).toMatch(/remaining/)
  })

  it('exits 1 when the server reports a session already active (409)', async () => {
    const deps = makeDeps()
    deps._actions.lastList = { 1: 7 }
    const err = new Error('conflict')
    err.status = 409
    deps.api.post.mockRejectedValue(err)

    await expect(cmdFocus('1', {}, deps)).rejects.toThrow(ExitError)
    expect(deps._errors.join('\n')).toMatch(/already active/)
  })

  it('stop is idempotent — the API stop fires once across two calls', async () => {
    const deps = makeDeps()
    deps._actions.lastList = { 1: 7 }
    deps.api.post.mockResolvedValueOnce({
      session: { id: 11, started_at: new Date(0).toISOString(), planned_sec: 1500 },
    })
    // subsequent api.post calls (the stop) resolve to nothing meaningful
    deps.api.post.mockResolvedValue({})
    const handle = await cmdFocus('1', { time: '25' }, deps)

    await handle.stop(false)
    await handle.stop(true) // second call must be a no-op (stopped flag)

    const stopCalls = deps.api.post.mock.calls.filter((c) => String(c[0]).includes('/stop'))
    expect(stopCalls).toHaveLength(1)
    expect(deps.clearTimer).toHaveBeenCalled()
    expect(deps.offSignal).toHaveBeenCalledWith('SIGINT', expect.any(Function))
  })

  it('renderBar math: at completion it writes 00:00 and a full bar', async () => {
    const deps = makeDeps()
    deps._actions.lastList = { 1: 7 }
    // planned 60s, started at t=0; advance now() to 60_000ms → remaining 0
    deps.api.post.mockResolvedValue({
      session: { id: 11, started_at: new Date(0).toISOString(), planned_sec: 60 },
    })
    deps.now.mockReturnValue(60_000)
    await cmdFocus('1', { time: '1' }, deps)
    const out = deps._writes.join('')
    expect(out).toMatch(/00:00/)
    // full bar = 30 filled blocks
    expect(out).toMatch(/█{30}/)
  })
})

describe('cmdOpen', () => {
  it('checks health then opens the browser via execFile (no shell)', async () => {
    const deps = makeDeps()
    deps.api.get.mockResolvedValue({ ok: true })
    await cmdOpen(deps)
    expect(deps.api.get).toHaveBeenCalledWith('/api/health')
    expect(deps.exec).toHaveBeenCalledWith('open', [expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/)])
  })

  it('errors out (exit 1) when the server is unreachable', async () => {
    const deps = makeDeps()
    deps.api.get.mockRejectedValue(new Error('refused'))
    await expect(cmdOpen(deps)).rejects.toThrow(ExitError)
  })
})

describe('cmdServer', () => {
  it('status: prints the running version when health responds', async () => {
    const deps = makeDeps()
    deps.api.get.mockResolvedValue({ ok: true, version: '0.1.0' })
    await cmdServer('status', deps)
    expect(deps._logs.join('\n')).toMatch(/version 0\.1\.0/)
  })

  it('status: reports not running when health throws', async () => {
    const deps = makeDeps()
    deps.api.get.mockRejectedValue(new Error('down'))
    await cmdServer('status', deps)
    expect(deps._logs.join('\n')).toMatch(/not running/)
  })

  it('stop: kills the recorded PID', async () => {
    const deps = makeDeps()
    deps._actions.serverPid = 4242
    await cmdServer('stop', deps)
    expect(deps.kill).toHaveBeenCalledWith(4242, 'SIGTERM')
    expect(deps._logs.join('\n')).toMatch(/Stopped server \(pid 4242\)/)
  })

  it('stop: falls back to lsof when there is no PID file', async () => {
    const deps = makeDeps()
    deps._actions.serverPid = null
    deps.exec.mockReturnValue(Buffer.from('111\n222\n'))
    await cmdServer('stop', deps)
    expect(deps.exec).toHaveBeenCalledWith('lsof', ['-ti', expect.stringMatching(/^:\d+$/)])
    expect(deps.kill).toHaveBeenCalledWith(111, 'SIGTERM')
    expect(deps.kill).toHaveBeenCalledWith(222, 'SIGTERM')
  })

  it('stop: reports none found when lsof returns nothing', async () => {
    const deps = makeDeps()
    deps._actions.serverPid = null
    deps.exec.mockReturnValue(Buffer.from(''))
    await cmdServer('stop', deps)
    expect(deps._logs.join('\n')).toMatch(/No server process found/)
  })

  it('unknown action exits 1', async () => {
    const deps = makeDeps()
    await expect(cmdServer('frobnicate', deps)).rejects.toThrow(ExitError)
    expect(deps._errors.join('\n')).toMatch(/Unknown server action/)
  })
})
