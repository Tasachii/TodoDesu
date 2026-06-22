import { describe, it, expect } from 'vitest'
import { nextDueAt } from '../src/index.js'

// Exhaustive coverage of the shared recurrence rule. The server route and the
// standalone engine both delegate here, so these cases lock the behavior for
// every backend at once.

const DAY = 24 * 3600_000

describe('nextDueAt — daily', () => {
  it('advances exactly one day past a fresh due date', () => {
    const due = new Date(2026, 5, 10, 9).toISOString() // Jun 10, 09:00 local
    const ref = new Date(2026, 5, 10, 10) // an hour after it became due
    const next = new Date(nextDueAt(due, 'daily', ref))
    expect(next - new Date(due)).toBe(DAY)
    expect(next.getHours()).toBe(9) // keeps the wall-clock hour
  })

  it('lands a single period in the future when many were missed', () => {
    // due 3 days ago; the do…while loop must stop at the first future tick,
    // not pile up three days of misses.
    const due = new Date(2026, 5, 7, 9).toISOString()
    const ref = new Date(2026, 5, 10, 12)
    const next = new Date(nextDueAt(due, 'daily', ref))
    expect(next > ref).toBe(true)
    // exactly one day past ref's calendar day at the original hour
    expect(next.getDate()).toBe(11)
    expect(next.getHours()).toBe(9)
  })
})

describe('nextDueAt — weekly', () => {
  it('jumps a week from a fresh due date', () => {
    const due = new Date(2026, 5, 10, 14).toISOString()
    const ref = new Date(2026, 5, 10, 15)
    const next = new Date(nextDueAt(due, 'weekly', ref))
    expect(next - new Date(due)).toBe(7 * DAY)
  })

  it('an overdue weekly 3 weeks stale lands exactly one week ahead, not three', () => {
    const due = new Date(2026, 5, 1, 9).toISOString() // 3+ weeks before ref
    const ref = new Date(2026, 5, 24, 12)
    const next = new Date(nextDueAt(due, 'weekly', ref))
    expect(next > ref).toBe(true)
    // first weekly tick strictly after ref: Jun 1 + 4*7 = Jun 29
    expect([next.getMonth(), next.getDate(), next.getHours()]).toEqual([5, 29, 9])
  })
})

describe('nextDueAt — monthly', () => {
  it('clamps short months instead of overflowing (Jan 31 → Feb 28)', () => {
    const jan31 = new Date(2027, 0, 31, 9).toISOString()
    const ref = new Date(2027, 0, 31, 10)
    const feb = new Date(nextDueAt(jan31, 'monthly', ref))
    expect([feb.getMonth(), feb.getDate(), feb.getHours()]).toEqual([1, 28, 9])
  })

  it('once clamped to 28 it stays 28 (re-derives from the clamped date)', () => {
    const feb28 = new Date(2027, 1, 28, 9).toISOString()
    const ref = new Date(2027, 1, 28, 10)
    const mar = new Date(nextDueAt(feb28, 'monthly', ref))
    expect([mar.getMonth(), mar.getDate()]).toEqual([2, 28])
  })

  it('a 31st advancing into a 31-day month stays on the 31st (no overflow)', () => {
    const dec31 = new Date(2026, 11, 31, 9).toISOString()
    const ref = new Date(2026, 11, 31, 10)
    const jan = new Date(nextDueAt(dec31, 'monthly', ref))
    expect([jan.getMonth(), jan.getDate()]).toEqual([0, 31])
  })

  it('leap year: a 29th-anchored monthly clamps to 28 in a non-leap February', () => {
    // Jan 29 2027 → Feb 2027 is non-leap → clamps to Feb 28
    const jan29 = new Date(2027, 0, 29, 8).toISOString()
    const ref = new Date(2027, 0, 29, 9)
    const feb = new Date(nextDueAt(jan29, 'monthly', ref))
    expect([feb.getMonth(), feb.getDate()]).toEqual([1, 28])
  })

  it('leap year: a 29th-anchored monthly keeps 29 in a leap February', () => {
    // Jan 29 2028 → Feb 2028 is a leap year → stays Feb 29
    const jan29 = new Date(2028, 0, 29, 8).toISOString()
    const ref = new Date(2028, 0, 29, 9)
    const feb = new Date(nextDueAt(jan29, 'monthly', ref))
    expect([feb.getMonth(), feb.getDate()]).toEqual([1, 29])
  })
})

describe('nextDueAt — DST boundary', () => {
  it('keeps the wall-clock hour across a spring-forward daily tick', () => {
    // US spring-forward 2026 is Mar 8. A task due Mar 7 09:00 local advancing
    // daily must read 09:00 local on Mar 8 even though that day is 23h long.
    // setDate operates in local time, so the wall-clock hour is preserved.
    const due = new Date(2026, 2, 7, 9).toISOString()
    const ref = new Date(2026, 2, 7, 10)
    const next = new Date(nextDueAt(due, 'daily', ref))
    expect(next.getHours()).toBe(9)
    expect(next.getDate()).toBe(8)
  })

  it('keeps the wall-clock hour across a fall-back daily tick', () => {
    // US fall-back 2026 is Nov 1 (a 25h day).
    const due = new Date(2026, 9, 31, 9).toISOString()
    const ref = new Date(2026, 9, 31, 10)
    const next = new Date(nextDueAt(due, 'daily', ref))
    expect(next.getHours()).toBe(9)
    expect(next.getDate()).toBe(1)
    expect(next.getMonth()).toBe(10) // November
  })
})
