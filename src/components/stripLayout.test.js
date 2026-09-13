import { describe, expect, it } from 'vitest'
import { rowMoves } from './stripLayout.js'

const dot = id => ({ key: `mark-${id}`, kind: 'dot' }) // 15 px + 7 gap
const dash = id => ({ key: `mark-${id}`, kind: 'dash' }) // 40 px + 7 gap
const letter = id => ({ key: `letter-${id}`, kind: 'letter' }) // 2 px + 7 gap

describe('rowMoves', () => {
  it('moves only the caret while the row still fits', () => {
    expect(rowMoves([dot(1)], [dot(1), dash(2)], 300)).toEqual({ marks: 0, caret: 47 })
  })

  it('moves the marks left by what was added once the row is pinned to the right', () => {
    const before = Array.from({ length: 20 }, (_, i) => dot(i)) // 20 × 22 + 3 = 443 px in 300
    expect(rowMoves(before, [...before, dash(20)], 300)).toEqual({ marks: -47, caret: 0 })
    expect(rowMoves(before, [...before, letter(19), dot(20)], 300)).toEqual({ marks: -31, caret: 0 })
  })

  it('moves the marks by only the overflow when the row starts to overflow', () => {
    const before = Array.from({ length: 13 }, (_, i) => dot(i)) // 289 px in 300
    const moves = rowMoves(before, [...before, dash(13)], 300)
    expect(moves).toEqual({ marks: -36, caret: 11 })
  })

  it('ignores marks dropping off the left edge', () => {
    const before = Array.from({ length: 40 }, (_, i) => dot(i))
    const after = [...before.slice(1), dot(40)]
    expect(rowMoves(before, after, 300)).toEqual({ marks: -22, caret: 0 })
  })

  it('snaps for a change in the middle of the row', () => {
    expect(rowMoves([dot(1), dot(2), dot(3)], [dot(1), letter(1), dot(2), dot(3)], 300)).toBeNull()
    expect(rowMoves([dot(1), letter(1), dot(2)], [dot(1), dot(2), dot(3)], 300)).toBeNull()
    expect(rowMoves([dot(1)], [], 300)).toBeNull()
  })
})
