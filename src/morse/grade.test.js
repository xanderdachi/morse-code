import { describe, expect, it } from 'vitest'
import { UNKNOWN_CHAR } from './decode.js'
import { grade } from './grade.js'
import { codeUnits, textUnits, unitMsForWpm } from './units.js'
import { toMorse } from './alphabet.js'

const ops = result => result.ops.map(o => o.op)
const letters = text => text.replaceAll(' ', '')

// 100 letters once spaces are removed.
const PASSAGE =
  'In a certain kingdom, in a certain land, there lived a Tsar who had three sons, one daughter and one clever grey horse too.'

describe('spaces are never scored', () => {
  it('uses a 100-letter passage', () => {
    expect(grade({ target: PASSAGE, sent: '' }).target).toHaveLength(100)
  })

  it('scores a 40-character target with 8 spaces out of 32', () => {
    const target = 'abcd efgh ijkl mnop qrst uvwx yz0 123 45'
    expect(target).toHaveLength(40)
    expect([...target].filter(c => c === ' ')).toHaveLength(8)
    const result = grade({ target, sent: letters(target).slice(0, 16) })
    expect(result.target).toHaveLength(32)
    expect(result.accuracy).toBe(50)
  })

  it('neither rewards nor penalises spaces in what was sent', () => {
    const withSpaces = grade({ target: 'TO BE', sent: 'TO BE' })
    const without = grade({ target: 'TO BE', sent: 'TOBE' })
    const extra = grade({ target: 'TO BE', sent: 'T O B E' })
    for (const result of [withSpaces, without, extra]) {
      expect(result.accuracy).toBe(100)
      expect(ops(result)).toEqual(['match', 'match', 'match', 'match'])
    }
  })

  it('re-injects word breaks into the character review', () => {
    const result = grade({ target: 'To be, or not', sent: 'TOBEORNOT' })
    expect(result.review.map(word => word.map(o => o.expected ?? '').join(''))).toEqual(['To', 'be,', 'or', 'not'])
    expect(result.review[1].map(o => o.op)).toEqual(['match', 'match', 'delete'])
  })

  it('keeps extra letters inside the word where they were sent', () => {
    const result = grade({ target: 'AB CD', sent: 'ABXCD' })
    expect(result.review.map(word => word.map(o => o.actual ?? '').join(''))).toEqual(['ABX', 'CD'])
  })
})

describe('alignment', () => {
  const at = (text, k) => letters(text).slice(0, k)

  it('costs one deleted letter in the middle of 100 exactly 1%', () => {
    const sent = at(PASSAGE, 50) + letters(PASSAGE).slice(51)
    const result = grade({ target: PASSAGE, sent })
    expect(result.accuracy).toBe(99)
    expect(result.counts).toEqual({ match: 99, substitute: 0, insert: 0, delete: 1 })
  })

  it('costs one substituted letter in the middle of 100 exactly 1%', () => {
    const sent = `${at(PASSAGE, 50)}Q${letters(PASSAGE).slice(51)}`
    expect(grade({ target: PASSAGE, sent }).accuracy).toBe(99)
  })

  it('does not cascade one inserted letter in the middle of 100', () => {
    const sent = `${at(PASSAGE, 50)}Q${letters(PASSAGE).slice(50)}`
    const result = grade({ target: PASSAGE, sent })
    expect(result.counts).toEqual({ match: 100, substitute: 0, insert: 1, delete: 0 })
    // An insertion displaces nothing, but it does count: 100 matches out of 100 letters plus 1 extra.
    expect(result.accuracy).toBeCloseTo((100 * 100) / 101, 10)
  })

  it('names each operation with what was expected and what arrived', () => {
    expect(grade({ target: 'MORSE', sent: 'NRSEE' }).ops).toEqual([
      { op: 'substitute', expected: 'M', actual: 'N' },
      { op: 'delete', expected: 'O', actual: null },
      { op: 'match', expected: 'R', actual: 'R' },
      { op: 'match', expected: 'S', actual: 'S' },
      { op: 'match', expected: 'E', actual: 'E' },
      { op: 'insert', expected: null, actual: 'E' },
    ])
  })

  it('compares case-insensitively after normalizing both sides', () => {
    const result = grade({ target: 'Petit à petit, l’oiseau', sent: "petita petit,l'OISEAU" })
    expect(result.accuracy).toBe(100)
    expect(result.ops[0]).toEqual({ op: 'match', expected: 'P', actual: 'p' })
  })

  it('keeps the unknown-letter sentinel as a wrong letter', () => {
    const result = grade({ target: 'EAT', sent: `E${UNKNOWN_CHAR}T` })
    expect(ops(result)).toEqual(['match', 'substitute', 'match'])
  })
})

describe('bounds', () => {
  it('scores an empty transmission as zero, without NaN', () => {
    expect(grade({ target: 'SOS', sent: '', elapsedMs: 5000 })).toMatchObject({ accuracy: 0, wpm: 0, effectiveWpm: 0 })
  })

  it('handles an empty target', () => {
    expect(grade({ target: '', sent: '' }).accuracy).toBe(100)
    expect(grade({ target: ' — ', sent: 'ABC' }).accuracy).toBe(0)
  })

  it('stays within [0, 100]', () => {
    expect(grade({ target: 'E', sent: 'TTTTTTTTTT' }).accuracy).toBe(0)
  })
})

describe('speed', () => {
  it('reports PARIS WPM for a perfect run, crediting the word spaces it passed', () => {
    const unit = unitMsForWpm(20)
    const result = grade({
      target: 'PARIS PARIS',
      sent: 'PARISPARIS',
      elapsedMs: textUnits('PARIS PARIS') * unit,
      letterUnits: codeUnits([...'PARISPARIS'].map(toMorse)),
    })
    expect(result.wpm).toBeCloseTo(20, 10)
    expect(result.effectiveWpm).toBeCloseTo(20, 10)
  })

  it('credits only the word spaces a partial run actually reached', () => {
    const unit = unitMsForWpm(15)
    const sent = 'INACERTAIN'
    const elapsedMs = textUnits('IN A CERTAIN') * unit
    const result = grade({ target: PASSAGE, sent, elapsedMs, letterUnits: codeUnits([...sent].map(toMorse)) })
    expect(result.wpm).toBeCloseTo(15, 10)
    expect(result.effectiveWpm).toBeCloseTo(15, 10)
  })

  it('gives no effective credit for wrong letters', () => {
    const result = grade({ target: 'PARIS', sent: 'XXXXX', elapsedMs: 10_000 })
    expect(result.wpm).toBeGreaterThan(0)
    expect(result.effectiveWpm).toBe(0)
  })
})
