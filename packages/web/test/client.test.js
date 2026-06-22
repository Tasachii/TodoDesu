import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { api, isStandalone } from '../src/api/client.js'

// In jsdom with no Capacitor and VITE_STANDALONE unset, the client resolves to
// the HTTP wrapper. Mock fetch to drive its request/response/error paths and
// the querystring builder.

const ok = (data) => ({
  ok: true,
  status: 200,
  json: async () => data,
})
const fail = (status, body) => ({
  ok: false,
  status,
  json: async () => body,
})

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client resolves to the HTTP api outside standalone', () => {
  it('is not standalone in the test environment', () => {
    expect(isStandalone).toBe(false)
  })
})

describe('GET helpers and querystring', () => {
  it('tasks() unwraps the tasks array', async () => {
    fetchMock.mockResolvedValue(ok({ tasks: [{ id: 1 }] }))
    const tasks = await api.tasks()
    expect(tasks).toEqual([{ id: 1 }])
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ method: 'GET' }))
  })

  it('tasks(params) drops empty values and serialises the rest', async () => {
    fetchMock.mockResolvedValue(ok({ tasks: [] }))
    await api.tasks({ status: 'todo', q: '', due_after: null, deleted: 'true' })
    const url = fetchMock.mock.calls[0][0]
    expect(url).toMatch(/^\/api\/tasks\?/)
    expect(url).toContain('status=todo')
    expect(url).toContain('deleted=true')
    expect(url).not.toContain('q=')
    expect(url).not.toContain('due_after')
  })

  it('stats() passes from/to through the querystring', async () => {
    fetchMock.mockResolvedValue(ok({ focus_sec: 0 }))
    await api.stats('A', 'B')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/stats?from=A&to=B')
  })
})

describe('mutating helpers send a JSON body', () => {
  it('createTask posts the body with a content-type header', async () => {
    fetchMock.mockResolvedValue(ok({ task: { id: 9 } }))
    const task = await api.createTask({ title: 'x' })
    expect(task).toEqual({ id: 9 })
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(opts.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(opts.body)).toEqual({ title: 'x' })
  })

  it('patchTask targets the id and unwraps task', async () => {
    fetchMock.mockResolvedValue(ok({ task: { id: 1, status: 'done' } }))
    const t = await api.patchTask(1, { status: 'done' })
    expect(t.status).toBe('done')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tasks/1')
  })

  it('deleteTask sends no body', async () => {
    fetchMock.mockResolvedValue(ok({ task: { id: 1, deleted_at: 'now' } }))
    await api.deleteTask(1)
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.method).toBe('DELETE')
    expect(opts.headers).toBeUndefined()
    expect(opts.body).toBeUndefined()
  })

  it('focusStop posts the completed flag', async () => {
    fetchMock.mockResolvedValue(ok({ session: { id: 1 } }))
    await api.focusStop(1, true)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/focus/1/stop')
    expect(JSON.parse(opts.body)).toEqual({ completed: true })
  })

  it('saveSettings unwraps settings', async () => {
    fetchMock.mockResolvedValue(ok({ settings: { theme: 'dark' } }))
    const s = await api.saveSettings({ theme: 'dark' })
    expect(s.theme).toBe('dark')
  })
})

describe('error handling', () => {
  it('throws an Error carrying the server error code and message', async () => {
    fetchMock.mockResolvedValue(fail(404, { error: { code: 'NOT_FOUND', message: 'Not found' } }))
    await expect(api.patchTask(99, {})).rejects.toMatchObject({
      message: 'Not found',
      code: 'NOT_FOUND',
    })
  })

  it('falls back to a generic message when the body has no error field', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => null })
    await expect(api.tasks()).rejects.toThrow(/Request failed \(500\)/)
  })
})
