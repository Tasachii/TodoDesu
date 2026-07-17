import { useEffect, useRef, useState } from 'react'
import { useTasks } from '../hooks/useTasks.js'
import {
  loadEnabled,
  loadNotified,
  saveNotified,
  reminderPlan,
  reminderNotification,
} from '../lib/reminders.js'

// Broadcast by SettingsSheet when the toggle flips, so this always-mounted
// scheduler picks up the change without shared React state (same window-event
// idiom the app already uses for toasts and quick-add focus).
export const REMINDERS_CHANGED = 'tododesu:reminders-changed'

// Re-check even while the tab stays open and visible, as a safety net for the
// far-future / suspended-timer cases the per-task timers can miss.
const SWEEP_INTERVAL_MS = 60 * 1000

// Show one reminder. Prefers the service worker registration (required for
// notifications inside an installed PWA on mobile, where the `Notification`
// constructor throws) and falls back to the constructor on desktop/dev where
// no worker controls the page. Fire-and-forget; failures are non-fatal.
function showReminder(task) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const { title, body, tag } = reminderNotification(task)
  const options = { body, tag, icon: `${import.meta.env.BASE_URL}icons/icon-192.png` }
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
  if (sw?.controller) {
    sw.ready.then((reg) => reg.showNotification(title, options)).catch(() => fallback(title, options))
  } else {
    fallback(title, options)
  }
}

function fallback(title, options) {
  try {
    new Notification(title, options)
  } catch {
    // No SW and no constructor support (e.g. some mobile webviews) — nothing
    // more we can do locally without a push server, which is out of scope.
  }
}

// Renders nothing. Watches the task list and, while reminders are enabled and
// permission is granted, fires a local notification at each task's due time
// (plus a catch-up sweep on load / focus for anything that came due while the
// app was away). All the pure "which tasks are due" logic lives in
// lib/reminders.js; this component is only the timers + Notification glue.
export default function ReminderScheduler() {
  const { data: tasks = [] } = useTasks()
  const [enabled, setEnabled] = useState(() => loadEnabled())
  const timers = useRef(new Map())
  const notified = useRef(loadNotified())

  // Keep in sync with the settings toggle across the app.
  useEffect(() => {
    const sync = () => setEnabled(loadEnabled())
    window.addEventListener(REMINDERS_CHANGED, sync)
    window.addEventListener('storage', sync) // another tab flipped it
    return () => {
      window.removeEventListener(REMINDERS_CHANGED, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    const armed = timers.current
    const clearTimers = () => {
      for (const handle of armed.values()) clearTimeout(handle)
      armed.clear()
    }

    const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted'
    if (!enabled || !granted) {
      clearTimers()
      return
    }

    // Re-sync the de-dup set from storage each time we (re)activate: the
    // settings toggle seeds it on enable to suppress a burst of catch-up
    // reminders, and another tab may have updated it.
    notified.current = loadNotified()

    const fire = (task) => {
      showReminder(task)
      notified.current.add(task.id)
    }

    const reconcile = () => {
      // Drop remembered ids for tasks that no longer exist so the set stays
      // bounded and a re-created id can be reminded again.
      const liveIds = new Set(tasks.map((t) => t.id))
      for (const id of [...notified.current]) {
        if (!liveIds.has(id)) notified.current.delete(id)
      }

      const { due, upcoming } = reminderPlan(tasks, { now: Date.now(), notified: notified.current })
      due.forEach(fire)

      // Recompute timers from scratch each pass so a changed due date can't
      // leave a stale timer armed.
      clearTimers()
      for (const { task, delay } of upcoming) {
        armed.set(
          task.id,
          setTimeout(() => {
            armed.delete(task.id)
            fire(task)
            saveNotified(notified.current)
          }, delay)
        )
      }
      saveNotified(notified.current)
    }

    reconcile()
    const onVisible = () => document.visibilityState === 'visible' && reconcile()
    document.addEventListener('visibilitychange', onVisible)
    const sweep = setInterval(reconcile, SWEEP_INTERVAL_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(sweep)
      clearTimers()
    }
  }, [enabled, tasks])

  return null
}
