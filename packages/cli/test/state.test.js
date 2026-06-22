import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// state.js resolves ~/.todoo from homedir() at import time. homedir() reads
// $HOME on POSIX, so point it at a throwaway dir BEFORE importing the module.
const HOME = mkdtempSync(join(tmpdir(), 'todoo-state-'))
const origHome = process.env.HOME
process.env.HOME = HOME

const state = await import('../src/state.js')
const dir = join(HOME, '.todoo')

afterAll(() => {
  process.env.HOME = origHome
  rmSync(HOME, { recursive: true, force: true })
})

// Start each test from a clean ~/.todoo so reads see no stale files.
beforeEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('last-list', () => {
  it('writes and reads back a mapping', () => {
    expect(state.readLastList()).toBeNull() // nothing yet
    state.writeLastList({ 1: 10, 2: 20 })
    expect(state.readLastList()).toEqual({ 1: 10, 2: 20 })
  })

  it('returns null for a corrupt file', () => {
    state.writeLastList({ 1: 10 })
    writeFileSync(join(dir, 'last-list.json'), '{broken', 'utf8')
    expect(state.readLastList()).toBeNull()
  })
})

describe('last-action', () => {
  it('writes, reads, and clears an action', () => {
    expect(state.readLastAction()).toBeNull()
    state.writeLastAction({ type: 'done', task_id: 5 })
    expect(state.readLastAction()).toEqual({ type: 'done', task_id: 5 })
    state.clearLastAction()
    // cleared file holds the literal null
    expect(state.readLastAction()).toBeNull()
  })
})

describe('server pid', () => {
  it('writes and reads a numeric pid', () => {
    expect(state.readServerPid()).toBeNull()
    state.writeServerPid(98765)
    expect(state.readServerPid()).toBe(98765)
  })

  it('returns null when the pid file is absent', () => {
    expect(state.readServerPid()).toBeNull()
    expect(existsSync(join(dir, 'server.pid'))).toBe(false)
  })
})
