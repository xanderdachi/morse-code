import { describe, expect, it } from 'vitest'
import { grade } from './grade.js'

const kinds = result => result.chars.map(c => c.kind)

describe('grade', () => {
  it('scores a perfect transmission', () => {
    const result = grade({ target: 'TO BE', sent: 'TO BE', elapsedMs: 10_000 })
    expect(result.accuracy).toBe(1)
    expect(kinds(result)).toEqual(['correct', 'correct', 'correct', 'correct', 'correct'])
    expect(result.counts).toEqual({ correct: 5, wrong: 0, missed: 0, extra: 0 })
  })

  it('ignores case and keeps the original characters in the review', () => {
    const result = grade({ target: 'To be', sent: 'TO BE', elapsedMs: 1 })
    expect(result.accuracy).toBe(1)
    expect(result.chars[1]).toEqual({ kind: 'correct', expected: 'o', actual: 'O' })
  })

  it('marks a substituted character as wrong', () => {
    const result = grade({ target: 'CAT', sent: 'CUT', elapsedMs: 1 })
    expect(kinds(result)).toEqual(['correct', 'wrong', 'correct'])
    expect(result.chars[1]).toEqual({ kind: 'wrong', expected: 'A', actual: 'U' })
    expect(result.accuracy).toBeCloseTo(2 / 3)
  })

  it('marks a skipped character as missed', () => {
    const result = grade({ target: 'HELLO', sent: 'HELO', elapsedMs: 1 })
    expect(kinds(result)).toEqual(['correct', 'correct', 'correct', 'missed', 'correct'])
    expect(result.chars[3]).toEqual({ kind: 'missed', expected: 'L', actual: null })
    expect(result.accuracy).toBeCloseTo(4 / 5)
  })

  it('marks an inserted character as extra', () => {
    const result = grade({ target: 'NOT', sent: 'NOOT', elapsedMs: 1 })
    expect(result.counts).toEqual({ correct: 3, wrong: 0, missed: 0, extra: 1 })
    expect(result.chars.find(c => c.kind === 'extra')).toEqual({ kind: 'extra', expected: null, actual: 'O' })
    expect(result.accuracy).toBeCloseTo(3 / 4)
  })

  it('counts a missing word gap as a missed space', () => {
    const result = grade({ target: 'TO BE', sent: 'TOBE', elapsedMs: 1 })
    expect(result.chars[2]).toEqual({ kind: 'missed', expected: ' ', actual: null })
    expect(result.counts.missed).toBe(1)
  })

  it('lines up the review in reading order with a mix of mistakes', () => {
    const result = grade({ target: 'MORSE', sent: 'NRSEE', elapsedMs: 1 })
    expect(result.chars.map(c => [c.kind, c.expected, c.actual])).toEqual([
      ['wrong', 'M', 'N'],
      ['missed', 'O', null],
      ['correct', 'R', 'R'],
      ['correct', 'S', 'S'],
      ['correct', 'E', 'E'],
      ['extra', null, 'E'],
    ])
    expect(result.accuracy).toBeCloseTo(3 / 5)
  })

  it('always covers every character of both strings', () => {
    const target = 'IN A CERTAIN KINGDOM'
    const sent = 'IM A CERTIN KINGDOOM X'
    const { chars } = grade({ target, sent, elapsedMs: 1 })
    expect(chars.map(c => c.expected ?? '').join('')).toBe(target)
    expect(chars.map(c => c.actual ?? '').join('')).toBe(sent)
  })

  it('scores an empty transmission as zero', () => {
    const result = grade({ target: 'SOS', sent: '', elapsedMs: 5000 })
    expect(result.accuracy).toBe(0)
    expect(result.wpm).toBe(0)
    expect(kinds(result)).toEqual(['missed', 'missed', 'missed'])
  })

  it('stays within 0–1 when far more is sent than asked for', () => {
    const result = grade({ target: 'E', sent: 'TTTTTTTTTT', elapsedMs: 1 })
    expect(result.accuracy).toBe(0)
  })

  it('computes gross words per minute from five-character words', () => {
    expect(grade({ target: 'X', sent: 'A'.repeat(25), elapsedMs: 60_000 }).wpm).toBeCloseTo(5)
    expect(grade({ target: 'X', sent: 'TO BE OR NOT', elapsedMs: 30_000 }).wpm).toBeCloseTo(4.8)
    expect(grade({ target: 'X', sent: 'ABC', elapsedMs: 0 }).wpm).toBe(0)
  })
})
