import { spawn } from 'node:child_process'
import { writeServerPid } from './state.js'

const PORT = process.env.TODOO_PORT || 4521
const BASE = `http://127.0.0.1:${PORT}`

/**
 * Poll /api/health every 150ms up to 5s.
 * Returns true if server comes up, false otherwise.
 */
async function waitForServer() {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return true
    } catch {
      /* server not up yet — keep polling until the deadline */
    }
    await new Promise(r => setTimeout(r, 150))
  }
  return false
}

/**
 * Auto-start the server if /api/health fails.
 * Spawns detached, writes PID to ~/.todoo/server.pid.
 */
export async function serverIsUp() {
  try {
    const res = await fetch(`${BASE}/api/health`)
    return res.ok
  } catch {
    return false
  }
}

export async function ensureServer() {
  try {
    const res = await fetch(`${BASE}/api/health`)
    if (res.ok) return
  } catch {
    /* not running — fall through to spawn it */
  }

  // Resolve server path relative to this file
  const serverPath = new URL('../../server/src/index.js', import.meta.url).pathname

  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', serverPath],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env }
    }
  )
  child.unref()
  writeServerPid(child.pid)

  const up = await waitForServer()
  if (!up) {
    console.error('\x1b[31mError: Could not start todoo server. Please check your installation.\x1b[0m')
    process.exit(1)
  }
}

/**
 * Make an API request, auto-starting the server if needed.
 * Returns the parsed JSON body.
 * Throws on non-2xx with {code, message} extracted.
 */
export async function request(method, path, body) {
  await ensureServer()

  const opts = { method }
  if (body !== undefined) {
    // Only send a content-type when there is a body: Fastify rejects
    // bodyless requests (e.g. DELETE) that claim application/json.
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }

  const res = await fetch(`${BASE}${path}`, opts)
  const json = await res.json()

  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`
    const err = new Error(msg)
    err.code = json?.error?.code
    err.status = res.status
    throw err
  }

  return json
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
  put: (path, body) => request('PUT', path, body),
}
