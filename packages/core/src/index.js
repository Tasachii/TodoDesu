// @todoo/core — business rules shared by the server (SQLite + REST) and the
// standalone engine (localStorage). Keeping the single source of truth here
// guarantees the two data backends behave identically.

// The next occurrence keeps the time of day and always lands in the future —
// completing an overdue daily task schedules tomorrow, not a stack of misses.
// Monthly keeps the day-of-month, clamping in shorter months (a task due the
// 31st falls on Feb 28, then the 28th onward) — it never overflows into the
// next month the way raw setMonth would (Jan 31 + 1 month = Mar 3).
export function nextDueAt(dueIso, repeat, now = new Date()) {
  const d = new Date(dueIso)
  const anchorDay = d.getDate()
  do {
    if (repeat === 'daily') d.setDate(d.getDate() + 1)
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7)
    else {
      d.setDate(1)
      d.setMonth(d.getMonth() + 1)
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      d.setDate(Math.min(anchorDay, daysInMonth))
    }
  } while (d <= now)
  return d.toISOString()
}
