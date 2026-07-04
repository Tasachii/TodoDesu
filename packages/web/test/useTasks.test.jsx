import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the api module the hook imports — every method is a spy we can resolve
// or reject per test.
vi.mock('../src/api/client.js', () => ({
  api: {
    tasks: vi.fn(),
    createTask: vi.fn(),
    patchTask: vi.fn(),
    deleteTask: vi.fn(),
    restoreTask: vi.fn(),
  },
}))

import { api } from '../src/api/client.js'
import { useTaskMutations } from '../src/hooks/useTasks.js'

const KEY = ['tasks']

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

const seed = (qc, tasks) => qc.setQueryData(KEY, tasks)
// mutateAsync that swallows the rejection so the test can assert post-error
// state (the rollback/invalidate side effects still run).
const settle = (p) => p.catch(() => {})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useTaskMutations.patch — optimistic update', () => {
  it('sets completed_at to an ISO string when status becomes done', () => {
    const { qc, wrapper } = makeWrapper()
    seed(qc, [{ id: 1, status: 'todo', completed_at: null }])
    api.patchTask.mockResolvedValue({ id: 1, status: 'done' })
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    // onMutate runs synchronously when mutate is dispatched, before the
    // awaited mutationFn settles — assert the optimistic cache immediately.
    act(() => result.current.patch.mutate({ id: 1, status: 'done' }))

    const optimistic = qc.getQueryData(KEY)[0]
    expect(optimistic.status).toBe('done')
    expect(typeof optimistic.completed_at).toBe('string')
    expect(Number.isNaN(Date.parse(optimistic.completed_at))).toBe(false)
  })

  it('clears completed_at to null when status changes to a non-done value', () => {
    const { qc, wrapper } = makeWrapper()
    seed(qc, [{ id: 1, status: 'done', completed_at: '2026-01-01T00:00:00.000Z' }])
    api.patchTask.mockResolvedValue({ id: 1, status: 'todo' })
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    act(() => result.current.patch.mutate({ id: 1, status: 'todo' }))
    expect(qc.getQueryData(KEY)[0].completed_at).toBeNull()
  })

  it('preserves completed_at when the patch has no status (e.g. sort_order only)', () => {
    const { qc, wrapper } = makeWrapper()
    seed(qc, [{ id: 1, status: 'done', completed_at: 'KEEP', sort_order: 1 }])
    api.patchTask.mockResolvedValue({ id: 1 })
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    act(() => result.current.patch.mutate({ id: 1, sort_order: 2.5 }))
    const t = qc.getQueryData(KEY)[0]
    expect(t.completed_at).toBe('KEEP')
    expect(t.sort_order).toBe(2.5)
  })

  it('rolls back to the snapshot when the mutation rejects', async () => {
    const { qc, wrapper } = makeWrapper()
    const original = [{ id: 1, status: 'todo', completed_at: null }]
    seed(qc, original)
    api.patchTask.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    await act(async () => {
      await settle(result.current.patch.mutateAsync({ id: 1, status: 'done' }))
    })
    // cache restored to the pre-mutation snapshot
    expect(qc.getQueryData(KEY)).toEqual(original)
  })
})

describe('useTaskMutations.remove — optimistic filter + rollback', () => {
  it('optimistically removes the task from the cache', () => {
    const { qc, wrapper } = makeWrapper()
    seed(qc, [{ id: 1 }, { id: 2 }])
    api.deleteTask.mockResolvedValue({ id: 1 })
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    act(() => result.current.remove.mutate(1))
    expect(qc.getQueryData(KEY).map((t) => t.id)).toEqual([2])
  })

  it('rolls back when delete rejects', async () => {
    const { qc, wrapper } = makeWrapper()
    const original = [{ id: 1 }, { id: 2 }]
    seed(qc, original)
    api.deleteTask.mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    await act(async () => {
      await settle(result.current.remove.mutateAsync(1))
    })
    expect(qc.getQueryData(KEY)).toEqual(original)
  })
})

describe('useTaskMutations — onSettled invalidation', () => {
  it('invalidates the tasks query on success', async () => {
    const { qc, wrapper } = makeWrapper()
    seed(qc, [{ id: 1, status: 'todo' }])
    const spy = vi.spyOn(qc, 'invalidateQueries')
    api.patchTask.mockResolvedValue({ id: 1, status: 'done' })
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    await act(async () => {
      await result.current.patch.mutateAsync({ id: 1, status: 'done' })
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: KEY })
  })

  it('invalidates the tasks query on error too', async () => {
    const { qc, wrapper } = makeWrapper()
    seed(qc, [{ id: 1, status: 'todo' }])
    const spy = vi.spyOn(qc, 'invalidateQueries')
    api.patchTask.mockRejectedValue(new Error('x'))
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    await act(async () => {
      await settle(result.current.patch.mutateAsync({ id: 1, status: 'done' }))
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: KEY })
  })
})

describe('useTaskMutations.create / restore', () => {
  it('create calls api.createTask on the happy path', async () => {
    const { qc, wrapper } = makeWrapper()
    seed(qc, [])
    api.createTask.mockResolvedValue({ id: 9, title: 'new' })
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    await act(async () => {
      await result.current.create.mutateAsync({ title: 'new' })
    })
    expect(api.createTask).toHaveBeenCalledWith({ title: 'new' })
  })

  it('create error runs common.onError without a snapshot (no rollback, no throw)', async () => {
    const { qc, wrapper } = makeWrapper()
    seed(qc, [{ id: 1 }])
    api.createTask.mockRejectedValue(new Error('fail'))
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    await act(async () => {
      await settle(result.current.create.mutateAsync({ title: 'x' }))
    })
    // create has no onMutate snapshot, so the cache is untouched (no rollback)
    expect(qc.getQueryData(KEY)).toEqual([{ id: 1 }])
  })

  it('broadcasts a toast event when a mutation fails with STORAGE_FULL', async () => {
    const { qc, wrapper } = makeWrapper()
    seed(qc, [])
    const err = Object.assign(new Error('Storage is full'), { code: 'STORAGE_FULL' })
    api.createTask.mockRejectedValue(err)
    const spy = vi.spyOn(window, 'dispatchEvent')
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    await act(async () => {
      await settle(result.current.create.mutateAsync({ title: 'x' }))
    })

    const evt = spy.mock.calls.map(([e]) => e).find((e) => e.type === 'tododesu:toast')
    expect(evt).toBeTruthy()
    expect(evt.detail).toBe('Storage is full')
    spy.mockRestore()
  })

  it('restore calls api.restoreTask', async () => {
    const { qc, wrapper } = makeWrapper()
    seed(qc, [])
    api.restoreTask.mockResolvedValue({ id: 1, deleted_at: null })
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    await act(async () => {
      await result.current.restore.mutateAsync(1)
    })
    expect(api.restoreTask).toHaveBeenCalledWith(1)
  })
})

describe('useTaskMutations — empty cache edge', () => {
  it('patch onMutate tolerates an undefined cache (old = [] default)', () => {
    const { qc, wrapper } = makeWrapper()
    // no seed — cache for KEY is undefined
    api.patchTask.mockResolvedValue({ id: 1 })
    const { result } = renderHook(() => useTaskMutations(), { wrapper })

    expect(() => act(() => result.current.patch.mutate({ id: 1, status: 'done' }))).not.toThrow()
    expect(qc.getQueryData(KEY)).toEqual([]) // mapped over the empty default
  })
})
