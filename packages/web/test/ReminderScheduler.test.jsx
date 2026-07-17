import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, cleanup, act } from '@testing-library/react'
import { REMINDERS_CHANGED } from '../src/components/ReminderScheduler.jsx'

// Drive the scheduler off a plain task list rather than the real query/network.
let mockTasks = []
vi.mock('../src/hooks/useTasks.js', () => ({
  useTasks: () => ({ data: mockTasks }),
}))

import ReminderScheduler from '../src/components/ReminderScheduler.jsx'

const openTask = (over = {}) => ({
  id: 1,
  title: 'Pay rent',
  status: 'todo',
  due_at: new Date(Date.now() - 3_600_000).toISOString(), // 1h ago
  deleted_at: null,
  ...over,
})

function stubNotification(permission = 'granted') {
  const Mock = vi.fn()
  Mock.permission = permission
  Mock.requestPermission = vi.fn().mockResolvedValue(permission)
  vi.stubGlobal('Notification', Mock)
  return Mock
}

beforeEach(() => {
  window.localStorage.clear()
  mockTasks = []
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ReminderScheduler', () => {
  it('fires immediately for a task already past due (the catch-up sweep)', async () => {
    const Notif = stubNotification('granted')
    window.localStorage.setItem('todoo-reminders', 'on')
    mockTasks = [openTask({ title: 'Pay rent' })]

    render(<ReminderScheduler />)

    await waitFor(() => expect(Notif).toHaveBeenCalledTimes(1))
    expect(Notif.mock.calls[0][0]).toBe('Pay rent')
    // The fired task is remembered so a later sweep won't double-notify.
    expect(JSON.parse(window.localStorage.getItem('todoo-reminders-notified'))).toEqual([1])
  })

  it('arms a timer and fires at the due time for an upcoming task', async () => {
    vi.useFakeTimers()
    try {
      const Notif = stubNotification('granted')
      window.localStorage.setItem('todoo-reminders', 'on')
      mockTasks = [openTask({ id: 2, title: 'Standup', due_at: new Date(Date.now() + 5000).toISOString() })]

      render(<ReminderScheduler />)
      expect(Notif).not.toHaveBeenCalled() // not due yet

      await vi.advanceTimersByTimeAsync(5001)
      expect(Notif).toHaveBeenCalledTimes(1)
      expect(Notif.mock.calls[0][0]).toBe('Standup')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does nothing while reminders are disabled', async () => {
    const Notif = stubNotification('granted')
    // no 'todoo-reminders' key → disabled
    mockTasks = [openTask()]

    render(<ReminderScheduler />)
    await new Promise((r) => setTimeout(r, 20))
    expect(Notif).not.toHaveBeenCalled()
  })

  it('honors a seed written after mount when reminders are enabled later', async () => {
    // Reproduces the enable flow: the scheduler mounts while reminders are off
    // (empty in-memory de-dup set), then the settings toggle seeds the due id
    // into storage and flips the flag on. The seed must be honored — no burst.
    const Notif = stubNotification('granted')
    mockTasks = [openTask({ id: 1 })]

    render(<ReminderScheduler />)
    await new Promise((r) => setTimeout(r, 10))
    expect(Notif).not.toHaveBeenCalled()

    window.localStorage.setItem('todoo-reminders-notified', JSON.stringify([1]))
    window.localStorage.setItem('todoo-reminders', 'on')
    act(() => window.dispatchEvent(new Event(REMINDERS_CHANGED)))

    await new Promise((r) => setTimeout(r, 10))
    expect(Notif).not.toHaveBeenCalled()
  })

  it('does nothing when notification permission is not granted', async () => {
    const Notif = stubNotification('default')
    window.localStorage.setItem('todoo-reminders', 'on')
    mockTasks = [openTask()]

    render(<ReminderScheduler />)
    await new Promise((r) => setTimeout(r, 20))
    expect(Notif).not.toHaveBeenCalled()
  })
})
