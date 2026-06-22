import { describe, it, expect } from 'vitest'
import { nextDueAt as core } from '../src/index.js'
import { nextDueAt as serverRoute } from '../../server/src/routes/tasks.js'

// Guards A8: the server route and @todoo/core must produce byte-identical
// recurrence output for the same (dueIso, repeat, now) triple. The web
// standalone engine imports the same core function, so covering server↔core
// here transitively covers server↔web.

const REPEATS = ['daily', 'weekly', 'monthly']
const CASES = [
  new Date(2026, 5, 10, 9),
  new Date(2027, 0, 31, 9), // month-clamp edge
  new Date(2028, 0, 29, 8), // leap-year edge
  new Date(2026, 11, 31, 23, 59),
]

describe('server route ↔ core parity', () => {
  for (const repeat of REPEATS) {
    for (const due of CASES) {
      it(`${repeat} from ${due.toISOString()} matches`, () => {
        const now = new Date(due.getTime() + 3600_000)
        expect(serverRoute(due.toISOString(), repeat, now)).toBe(
          core(due.toISOString(), repeat, now)
        )
      })
    }
  }
})
