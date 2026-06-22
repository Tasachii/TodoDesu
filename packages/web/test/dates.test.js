import { describe, it, expect } from 'vitest'
import {
  dayKey,
  localDayRange,
  isOverdue,
  formatDue,
  toLocalInput,
  fromLocalInput,
} from '../src/lib/dates.js'

describe('dayKey', () => {
  it('formats a date as yyyy-MM-dd in local time', () => {
    expect(dayKey(new Date(2026, 5, 22, 13, 30))).toBe('2026-06-22')
  })
})

describe('localDayRange', () => {
  it('brackets the given day from local midnight to end-of-day', () => {
    const { from, to } = localDayRange(new Date(2026, 5, 22, 13))
    expect(Date.parse(from)).toBeLessThan(Date.parse(to))
    // a noon timestamp on that day falls inside the range
    const noon = new Date(2026, 5, 22, 12).toISOString()
    expect(from <= noon && noon < to).toBe(true)
  })
})

describe('isOverdue', () => {
  const now = new Date(2026, 5, 22, 12)
  it('is true for a past due date on an open task', () => {
    expect(isOverdue({ due_at: new Date(2026, 5, 21).toISOString(), status: 'todo' }, now)).toBe(true)
  })
  it('is false when there is no due date', () => {
    expect(isOverdue({ due_at: null, status: 'todo' }, now)).toBeFalsy()
  })
  it('is false for a done task even if the date passed', () => {
    expect(isOverdue({ due_at: new Date(2026, 5, 21).toISOString(), status: 'done' }, now)).toBe(false)
  })
  it('is false for a future due date', () => {
    expect(isOverdue({ due_at: new Date(2026, 5, 23).toISOString(), status: 'todo' }, now)).toBe(false)
  })
})

describe('formatDue', () => {
  it('labels today and tomorrow with the time', () => {
    const today = new Date()
    today.setHours(9, 5, 0, 0)
    expect(formatDue(today.toISOString())).toMatch(/^Today 09:05$/)

    const tomorrow = new Date(today.getTime() + 24 * 3600_000)
    expect(formatDue(tomorrow.toISOString())).toMatch(/^Tomorrow /)
  })

  it('falls back to a weekday/month label for other dates', () => {
    // a date well outside today/tomorrow
    const d = new Date(2026, 11, 25, 18, 30)
    expect(formatDue(d.toISOString())).toMatch(/Dec/)
  })

  it('accepts a Date as well as an ISO string', () => {
    const d = new Date(2026, 11, 25, 8, 0)
    expect(formatDue(d)).toMatch(/Dec/)
  })
})

describe('toLocalInput / fromLocalInput', () => {
  it('round-trips a datetime-local value', () => {
    const iso = new Date(2026, 5, 22, 14, 30).toISOString()
    const local = toLocalInput(iso)
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(fromLocalInput(local)).toBe(iso)
  })
  it('maps empty input to empty/null', () => {
    expect(toLocalInput(null)).toBe('')
    expect(toLocalInput('')).toBe('')
    expect(fromLocalInput('')).toBeNull()
  })
})
