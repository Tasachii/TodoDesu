import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  loadRound,
  saveRound,
  mmss,
  ringProgress,
  computeBreak,
  advanceRound,
  usePomodoro,
  useNow,
} from '../src/hooks/useFocusEngine.js'
import { dayKey } from '../src/lib/dates.js'

function memStorage() {
  const map = new Map()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    _map: map,
  }
}

describe('mmss', () => {
  it('formats seconds as m:ss with zero-padded seconds', () => {
    expect(mmss(61)).toBe('1:01')
    expect(mmss(5)).toBe('0:05')
    expect(mmss(600)).toBe('10:00')
  })
  it('clamps negative input to 0:00 (backward clock)', () => {
    expect(mmss(-5)).toBe('0:00')
    expect(mmss(-0.4)).toBe('0:00')
  })
})

describe('ringProgress', () => {
  it('is the fraction remaining/total within [0,1]', () => {
    expect(ringProgress(150, 300)).toBe(0.5)
    expect(ringProgress(300, 300)).toBe(1)
  })
  it('clamps above 1 and below 0', () => {
    expect(ringProgress(400, 300)).toBe(1) // clock jumped: never past full
    expect(ringProgress(-50, 300)).toBe(0) // never negative
  })
  it('returns 0 when total is 0 (avoids divide-by-zero)', () => {
    expect(ringProgress(10, 0)).toBe(0)
  })
})

describe('loadRound', () => {
  it('returns the saved round when the day matches', () => {
    const s = memStorage()
    s.setItem('todoo-pomodoro-round', JSON.stringify({ round: 3, day: '2026-06-22' }))
    expect(loadRound('2026-06-22', s)).toBe(3)
  })
  it('returns 1 when the saved day is stale', () => {
    const s = memStorage()
    s.setItem('todoo-pomodoro-round', JSON.stringify({ round: 3, day: '2026-06-21' }))
    expect(loadRound('2026-06-22', s)).toBe(1)
  })
  it('returns 1 for a missing key', () => {
    expect(loadRound('2026-06-22', memStorage())).toBe(1)
  })
  it('returns 1 on corrupt JSON (the catch)', () => {
    const s = memStorage()
    s.setItem('todoo-pomodoro-round', '{not json')
    expect(loadRound('2026-06-22', s)).toBe(1)
  })
  it('returns 1 for a non-integer or non-positive round', () => {
    const s = memStorage()
    s.setItem('todoo-pomodoro-round', JSON.stringify({ round: 0, day: '2026-06-22' }))
    expect(loadRound('2026-06-22', s)).toBe(1)
    s.setItem('todoo-pomodoro-round', JSON.stringify({ round: 2.5, day: '2026-06-22' }))
    expect(loadRound('2026-06-22', s)).toBe(1)
  })
})

describe('saveRound', () => {
  it('persists round and day', () => {
    const s = memStorage()
    saveRound(4, '2026-06-22', s)
    expect(JSON.parse(s.getItem('todoo-pomodoro-round'))).toEqual({ round: 4, day: '2026-06-22' })
  })
})

describe('computeBreak', () => {
  it('starts a SHORT break before the final round', () => {
    const b = computeBreak({ round: 1, totalRounds: 4, brkMin: 5, longMin: 15, at: 1000 })
    expect(b).toEqual({
      breakKind: 'short',
      breakMode: 'pomodoro',
      breakTotal: 300,
      breakUntil: 1000 + 300 * 1000,
    })
  })
  it('starts a LONG break on the final round', () => {
    const b = computeBreak({ round: 4, totalRounds: 4, brkMin: 5, longMin: 15, at: 0 })
    expect(b.breakKind).toBe('long')
    expect(b.breakTotal).toBe(900)
  })
})

describe('advanceRound', () => {
  it('advances by one after a short break', () => {
    expect(advanceRound({ breakKind: 'short', round: 2 })).toBe(3)
  })
  it('resets to 1 after a long break', () => {
    expect(advanceRound({ breakKind: 'long', round: 4 })).toBe(1)
  })
})

describe('usePomodoro hook', () => {
  beforeEach(() => {
    // jsdom provides localStorage; clear it so loadRound starts fresh.
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('starts a pomodoro break with the right kind, total, and until', () => {
    const { result } = renderHook(() => usePomodoro())
    expect(result.current.round).toBe(1)
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    act(() => {
      result.current.startPomodoroBreak({ totalRounds: 4, brkMin: 5, longMin: 15 })
    })
    expect(result.current.breakKind).toBe('short')
    expect(result.current.breakMode).toBe('pomodoro')
    expect(result.current.breakTotal).toBe(300)
    expect(result.current.breakUntil).toBe(10_000 + 300_000)
  })

  it('endBreak on a short break advances the round once (idempotent)', () => {
    const { result } = renderHook(() => usePomodoro())
    vi.spyOn(Date, 'now').mockReturnValue(0)
    act(() => result.current.startPomodoroBreak({ totalRounds: 4, brkMin: 5, longMin: 15 }))
    expect(result.current.round).toBe(1)
    let ended
    act(() => {
      ended = result.current.endBreak()
    })
    expect(ended).toBe(true)
    expect(result.current.round).toBe(2)
    expect(result.current.breakUntil).toBeNull()
    // second call for the (now cleared) break must not advance again
    act(() => {
      ended = result.current.endBreak()
    })
    expect(ended).toBe(false)
    expect(result.current.round).toBe(2)
  })

  it('endBreak on a long break resets the round to 1', () => {
    window.localStorage.setItem(
      'todoo-pomodoro-round',
      JSON.stringify({ round: 4, day: dayKey(new Date()) })
    )
    const { result } = renderHook(() => usePomodoro())
    expect(result.current.round).toBe(4)
    vi.spyOn(Date, 'now').mockReturnValue(0)
    act(() => result.current.startPomodoroBreak({ totalRounds: 4, brkMin: 5, longMin: 15 }))
    expect(result.current.breakKind).toBe('long')
    act(() => result.current.endBreak())
    expect(result.current.round).toBe(1)
  })

  it('persists the advanced round to localStorage', () => {
    const { result } = renderHook(() => usePomodoro())
    vi.spyOn(Date, 'now').mockReturnValue(0)
    act(() => result.current.startPomodoroBreak({ totalRounds: 4, brkMin: 5, longMin: 15 }))
    act(() => result.current.endBreak())
    const saved = JSON.parse(window.localStorage.getItem('todoo-pomodoro-round'))
    expect(saved.round).toBe(2)
  })

  it('resetCycle sets and persists the round', () => {
    const { result } = renderHook(() => usePomodoro())
    act(() => result.current.resetCycle(1))
    expect(result.current.round).toBe(1)
    expect(JSON.parse(window.localStorage.getItem('todoo-pomodoro-round')).round).toBe(1)
  })

  it('a timer-mode break does not advance the round', () => {
    const { result } = renderHook(() => usePomodoro())
    act(() =>
      result.current.startBreak({ kind: 'short', mode: 'timer', total: 300, until: 5000 })
    )
    expect(result.current.breakMode).toBe('timer')
    act(() => result.current.endBreak())
    expect(result.current.round).toBe(1) // unchanged — timer breaks don't cycle
    expect(result.current.breakUntil).toBeNull()
  })
})

describe('useNow', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not tick while not running', () => {
    const { result } = renderHook(() => useNow(false))
    const first = result.current
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current).toBe(first) // frozen
  })

  it('advances on its interval while running, and cleans up on unmount', () => {
    vi.setSystemTime(new Date('2026-06-22T00:00:00.000Z'))
    const { result, unmount, rerender } = renderHook(({ run }) => useNow(run), {
      initialProps: { run: false },
    })
    rerender({ run: true })
    const before = result.current
    act(() => {
      vi.setSystemTime(new Date('2026-06-22T00:00:01.000Z'))
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBeGreaterThan(before)
    // unmount clears the interval without throwing
    expect(() => unmount()).not.toThrow()
  })
})
