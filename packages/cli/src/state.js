import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.todoo')

function ensureDir() {
  mkdirSync(dir, { recursive: true })
}

export function readLastList() {
  try {
    const raw = readFileSync(join(dir, 'last-list.json'), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeLastList(mapping) {
  ensureDir()
  writeFileSync(join(dir, 'last-list.json'), JSON.stringify(mapping), 'utf8')
}

export function readLastAction() {
  try {
    const raw = readFileSync(join(dir, 'last-action.json'), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeLastAction(action) {
  ensureDir()
  writeFileSync(join(dir, 'last-action.json'), JSON.stringify(action), 'utf8')
}

export function clearLastAction() {
  ensureDir()
  try {
    writeFileSync(join(dir, 'last-action.json'), 'null', 'utf8')
  } catch {
    /* best-effort clear — ignore write failures */
  }
}

export function readServerPid() {
  try {
    const raw = readFileSync(join(dir, 'server.pid'), 'utf8')
    return parseInt(raw.trim(), 10)
  } catch {
    return null
  }
}

export function writeServerPid(pid) {
  ensureDir()
  writeFileSync(join(dir, 'server.pid'), String(pid), 'utf8')
}
