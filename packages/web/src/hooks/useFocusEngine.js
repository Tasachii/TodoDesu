import { useCallback, useEffect, useRef, useState } from 'react'
import { dayKey } from '../lib/dates.js'

const ROUND_KEY = 'todoo-pomodoro-round'

// ── pure helpers (no DOM, no React) ───────────────────────────────────────────

// The current round survives a reload but resets each day. Returns 1 on a
// corrupt snapshot, a missing key, a stale day, or a non-positive integer.
export function loadRound(today = dayKey(new Date()), storage = globalThis.localStorage) {
  const raw = storage?.getItem(ROUND_KEY)
  if (!raw) return 1
  try {
    const { round, day } = JSON.parse(raw)
    if (day === today && Number.isInteger(round) && round >= 1) return round
  } catch {
    /* corrupt — start fresh */
  }
  return 1
}

export function saveRound(round, today = dayKey(new Date()), storage = globalThis.localStorage) {
  storage?.setItem(ROUND_KEY, JSON.stringify({ round, day: today }))
}

// mm:ss, clamped so a backward clock can never render a negative time.
export function mmss(sec) {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Ring fill fraction, clamped to [0,1] so a backward `now` can't push the
// stroke past either end of the arc.
export function ringProgress(remaining, total) {
  if (!total) return 0
  return Math.min(1, Math.max(0, remaining / total))
}

// What break a finishing pomodoro work session starts: the long break lands
// after the final round, a short one otherwise. Pure — given the round and the
// configured minutes it fully describes the next break.
export function computeBreak({ round, totalRounds, brkMin, longMin, at }) {
  const isLong = round >= totalRounds
  const sec = (isLong ? longMin : brkMin) * 60
  return {
    breakKind: isLong ? 'long' : 'short',
    breakMode: 'pomodoro',
    breakTotal: sec,
    breakUntil: at + sec * 1000,
  }
}

// Round after a pomodoro break ends: a long break resets the cycle to 1, a
// short break advances by one.
export function advanceRound({ breakKind, round }) {
  return breakKind === 'long' ? 1 : round + 1
}

// ── hooks ─────────────────────────────────────────────────────────────────────

// Always derive time from timestamps: iOS suspends JS in background, so
// counting down with an interval would drift.
export function useNow(running) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 250)
    const onVisible = () => setNow(Date.now())
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running])
  return now
}

// Round + break state machine. Owns the once-only guards (finish, break-end)
// so the effects in FocusView depend only on stable callbacks — no stale
// closures, no eslint-disable.
export function usePomodoro() {
  const [round, setRound] = useState(loadRound)
  const [breakUntil, setBreakUntil] = useState(null)
  const [breakTotal, setBreakTotal] = useState(300)
  const [breakKind, setBreakKind] = useState('short')
  // Captured when a break starts so toggling the style mid-break can't change
  // how (or whether) the round advances.
  const [breakMode, setBreakMode] = useState('timer')

  // breakUntil doubles as a break id; round/mode/kind are read via refs so the
  // callbacks below keep a stable identity while still seeing the latest value.
  // The refs are synced in an effect (not during render) so endBreak — only
  // ever called from event handlers or effects — reads committed values.
  const roundRef = useRef(round)
  const breakModeRef = useRef(breakMode)
  const breakKindRef = useRef(breakKind)
  const breakUntilRef = useRef(breakUntil)
  const breakEndedFor = useRef(null)
  useEffect(() => {
    roundRef.current = round
    breakModeRef.current = breakMode
    breakKindRef.current = breakKind
    breakUntilRef.current = breakUntil
  })

  const startBreak = useCallback(({ kind, mode, total, until }) => {
    setBreakKind(kind)
    setBreakMode(mode)
    setBreakTotal(total)
    setBreakUntil(until)
  }, [])

  const startPomodoroBreak = useCallback(
    ({ totalRounds, brkMin, longMin, at = Date.now() }) => {
      const b = computeBreak({ round: roundRef.current, totalRounds, brkMin, longMin, at })
      setBreakKind(b.breakKind)
      setBreakMode(b.breakMode)
      setBreakTotal(b.breakTotal)
      setBreakUntil(b.breakUntil)
    },
    []
  )

  // Idempotent per break: calling endBreak twice for the same breakUntil
  // advances the round exactly once. The guard is keyed on breakUntil (read
  // from a ref so this stays a stable callback) which doubles as the break id.
  const endBreak = useCallback(() => {
    const until = breakUntilRef.current
    if (until == null || breakEndedFor.current === until) return false
    breakEndedFor.current = until
    setBreakUntil(null)
    if (breakModeRef.current === 'pomodoro') {
      const next = advanceRound({ breakKind: breakKindRef.current, round: roundRef.current })
      setRound(next)
      saveRound(next)
    }
    return true
  }, [])

  const resetCycle = useCallback((n = 1) => {
    setRound(n)
    saveRound(n)
  }, [])

  return {
    round,
    setRound,
    breakUntil,
    breakTotal,
    breakKind,
    breakMode,
    startBreak,
    startPomodoroBreak,
    endBreak,
    resetCycle,
  }
}
