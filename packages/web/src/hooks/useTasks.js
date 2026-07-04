import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'

const KEY = ['tasks']

export function useTasks() {
  return useQuery({ queryKey: KEY, queryFn: () => api.tasks() })
}

export function useTaskMutations() {
  const qc = useQueryClient()

  const snapshot = () => {
    const prev = qc.getQueryData(KEY)
    return { prev }
  }
  const common = {
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev)
      // A full localStorage quota can't be retried away — tell the user rather
      // than let the optimistic row silently disappear on rollback.
      if (err?.code === 'STORAGE_FULL' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tododesu:toast', { detail: err.message }))
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  }
  const setCache = (fn) => qc.setQueryData(KEY, (old = []) => fn(old))

  const create = useMutation({ mutationFn: (body) => api.createTask(body), ...common })

  const patch = useMutation({
    mutationFn: ({ id, ...body }) => api.patchTask(id, body),
    onMutate: ({ id, ...body }) => {
      const ctx = snapshot()
      setCache((tasks) =>
        tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                ...body,
                completed_at:
                  body.status === 'done'
                    ? new Date().toISOString()
                    : body.status
                      ? null
                      : t.completed_at,
              }
            : t
        )
      )
      return ctx
    },
    ...common,
  })

  const remove = useMutation({
    mutationFn: (id) => api.deleteTask(id),
    onMutate: (id) => {
      const ctx = snapshot()
      setCache((tasks) => tasks.filter((t) => t.id !== id))
      return ctx
    },
    ...common,
  })

  const restore = useMutation({ mutationFn: (id) => api.restoreTask(id), ...common })

  return { create, patch, remove, restore }
}
