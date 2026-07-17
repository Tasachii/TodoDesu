// Pure logic for due-date reminders — no DOM, no timers, no Notification API,
// so every decision here is unit-testable in isolation. The impure glue that
// actually schedules timers and shows notifications lives in
// components/ReminderScheduler.jsx; the settings toggle lives in
// components/SettingsSheet.jsx.
//
// Reminders are a per-device preference: notification permission is granted
// per browser/install, so the on/off flag and the "already notified" set are
// kept in localStorage directly (like the theme in useTheme.js), not synced
// through the settings API.

import { formatDue } from './dates.js'

export const REMINDERS_KEY = 'todoo-reminders'
export const NOTIFIED_KEY = 'todoo-reminders-notified'

// How far ahead an in-page timer is armed. Tasks further out than this are
// picked up on a later sweep (reload, tab focus, or the periodic re-check)
// once they fall inside the window.
export const REMINDER_HORIZON_MS = 24 * 60 * 60 * 1000

// A task can be reminded about when it is still open (not done, not deleted)
// and actually has a due date. Priority and recurrence are irrelevant here.
export function isRemindable(task) {
  return Boolean(task && task.due_at && task.status !== 'done' && !task.deleted_at)
}

// Partition the current task list into reminders to fire now vs. timers to
// arm. Pure and deterministic given its inputs:
//   now       — reference time (ms epoch or Date), default Date.now()
//   notified  — ids already notified (Set or any iterable), skipped entirely
//   horizonMs — how far ahead to arm timers
// Returns:
//   due      — remindable, un-notified tasks whose due time is at/before now.
//              These fire immediately; this is the catch-up sweep for tasks
//              that came due while the app was closed or backgrounded.
//   upcoming — remindable, un-notified tasks due within (now, now+horizon),
//              each with the delay in ms until it is due, for a setTimeout.
export function reminderPlan(
  tasks = [],
  { now = Date.now(), notified = new Set(), horizonMs = REMINDER_HORIZON_MS } = {}
) {
  const nowMs = now instanceof Date ? now.getTime() : now
  const seen = notified instanceof Set ? notified : new Set(notified)
  const due = []
  const upcoming = []
  for (const task of tasks) {
    if (!isRemindable(task) || seen.has(task.id)) continue
    const dueMs = Date.parse(task.due_at)
    if (Number.isNaN(dueMs)) continue
    if (dueMs <= nowMs) due.push(task)
    else if (dueMs < nowMs + horizonMs) upcoming.push({ task, delay: dueMs - nowMs })
  }
  return { due, upcoming }
}

// The user-visible content of a task's reminder. `tag` keys the notification
// to the task so a re-fire replaces rather than stacks.
export function reminderNotification(task) {
  return {
    title: task.title,
    body: `Due ${formatDue(task.due_at)}`,
    tag: `todoo-task-${task.id}`,
  }
}

// ── per-device preference + de-dup set, persisted in localStorage ─────────────
// A storage argument (defaulting to the real localStorage) keeps these testable
// with an injected stub, the same pattern as useFocusEngine's loadRound.

export function loadEnabled(storage = globalThis.localStorage) {
  return storage?.getItem(REMINDERS_KEY) === 'on'
}

export function saveEnabled(enabled, storage = globalThis.localStorage) {
  storage?.setItem(REMINDERS_KEY, enabled ? 'on' : 'off')
}

export function loadNotified(storage = globalThis.localStorage) {
  const raw = storage?.getItem(NOTIFIED_KEY)
  if (!raw) return new Set()
  try {
    const ids = JSON.parse(raw)
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    // Corrupt snapshot — start with a clean set rather than throw.
    return new Set()
  }
}

export function saveNotified(ids, storage = globalThis.localStorage) {
  storage?.setItem(NOTIFIED_KEY, JSON.stringify([...ids]))
}
