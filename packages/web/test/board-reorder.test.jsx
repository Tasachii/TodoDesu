import { describe, it, expect } from 'vitest'
import { computeSortOrder } from '../src/views/BoardView.jsx'

// `list` is the target column with the dragged card already filtered out;
// `index` is where the card lands (the position of the card being dropped
// onto, or list.length for a drop at the end).
const card = (id, sort_order) => ({ id, sort_order })

describe('computeSortOrder', () => {
  it('takes the fractional midpoint when dropped between two cards', () => {
    const list = [card('a', 1), card('b', 2)]
    // dropping onto index 1 (before "b", after "a") → midpoint of 1 and 2
    expect(computeSortOrder(list, 1)).toBe(1.5)
  })

  it('keeps subdividing on repeated midpoint drops', () => {
    const list = [card('a', 1), card('b', 1.5)]
    expect(computeSortOrder(list, 1)).toBe(1.25)
  })

  it('drop at the column end (no after) is before.sort_order + 1', () => {
    const list = [card('a', 1), card('b', 2)]
    expect(computeSortOrder(list, list.length)).toBe(3)
  })

  it('drop at the column start (no before) is after.sort_order - 1', () => {
    const list = [card('a', 5), card('b', 6)]
    expect(computeSortOrder(list, 0)).toBe(4)
  })

  it('an empty column yields 1', () => {
    expect(computeSortOrder([], 0)).toBe(1)
  })

  it('a single-card column, dropping at the end, is that card + 1', () => {
    expect(computeSortOrder([card('a', 10)], 1)).toBe(11)
  })

  it('handles fractional neighbours symmetrically', () => {
    const list = [card('a', 0.25), card('b', 0.5)]
    expect(computeSortOrder(list, 1)).toBe(0.375)
  })
})
