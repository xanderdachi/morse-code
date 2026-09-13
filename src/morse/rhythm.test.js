import { describe, expect, it } from 'vitest'
import { normalize, toMorse } from './alphabet.js'
import { analyzeRhythm, slidingMedians, twoMeans } from './rhythm.js'
import { DASH, DOT } from './symbols.js'
import { synthesizeKeying } from './testing/syntheticKeyer.js'

const presses = (text, options) => {
  const log = synthesizeKeying(text, options)
  const elements = []
  for (let i = 0; i < log.length; i += 2) {
    elements.push({ durationMs: log[i + 1].t - log[i].t, gapBeforeMs: i ? log[i].t - log[i - 1].t : null })
  }
  return elements
}
const marksOf = text => [...normalize(text).replaceAll(' ', '').toUpperCase()].flatMap(char => [...toMorse(char)])

describe('twoMeans', () => {
  it('finds two clusters and splits between them', () => {
    const result = twoMeans([0, 0.1, -0.1, 1.1, 1.0, 1.2], [0, Math.log(3)])
    expect(result.low).toBeCloseTo(0, 5)
    expect(result.high).toBeCloseTo(1.1, 5)
    expect(result.split).toBeGreaterThan(0.1)
    expect(result.split).toBeLessThan(1.0)
  })

  it('splits correctly when one cluster is much larger than the other', () => {
    // 3 dots and 20 dashes: the midpoint of the means would land inside the dashes.
    const values = [-0.3, 0.2, 0.3, ...Array.from({ length: 20 }, (_, i) => 0.6 + i * 0.04)]
    const result = twoMeans(values, [0, Math.log(3)])
    expect(result.split).toBeGreaterThan(0.3)
    expect(result.split).toBeLessThan(0.6)
  })

  it('returns null when the data is one cluster', () => {
    expect(twoMeans([0, 0.05, -0.05, 0.1], [0, Math.log(3)])).toBeNull()
    expect(twoMeans([1, 1.02, 1.1], [0, Math.log(3)])).toBeNull()
  })
})

describe('slidingMedians', () => {
  it('computes windowed medians', () => {
    expect(slidingMedians([5, 1, 3, 2, 4], 1, 1)).toEqual([3, 3, 2, 3, 3])
  })

  it('shifts windows inward at the ends when asked for full size', () => {
    expect(slidingMedians([5, 1, 3, 2, 4], 1, 1, { fullSize: true })).toEqual([3, 3, 2, 3, 3])
    expect(slidingMedians([10, 1, 2, 3, 20], 1, 1, { fullSize: true })).toEqual([2, 2, 2, 3, 3])
  })
})

describe('analyzeRhythm', () => {
  it('separates dots from dashes under ±40% press noise, where a 2u threshold cannot', () => {
    const text = 'Is it not pleasant to learn with a constant perseverance and application?'
    for (let seed = 1; seed <= 30; seed++) {
      const elements = presses(text, { wpm: 15, pressJitter: 0.4, seed })
      expect(analyzeRhythm(elements).symbols, `seed ${seed}`).toEqual(marksOf(text))
    }
  })

  it('follows a steep speed ramp', () => {
    const text = 'In a certain kingdom, in a certain land, there lived a Tsar.'
    const elements = presses(text, { wpmAt: p => 8 + 27 * p })
    expect(analyzeRhythm(elements).symbols).toEqual(marksOf(text))
  })

  it('recovers when the live pass misreads every dash from a far-off seed', () => {
    const text = 'To be, or not to be.'
    const elements = presses(text, { wpm: 35 })
    expect(analyzeRhythm(elements, { seedUnitMs: 400 }).symbols).toEqual(marksOf(text))
  })

  it('reports a local unit near the true one', () => {
    const elements = presses('What is the sound of one hand?', { wpm: 20 })
    for (const unit of analyzeRhythm(elements).units) expect(unit).toBeCloseTo(60, 0)
  })

  it('leaves pad taps as tapped and flags over-long presses', () => {
    const elements = [
      { durationMs: 900, gapBeforeMs: null, fixedSymbol: DOT },
      { durationMs: 20, gapBeforeMs: 100, fixedSymbol: DASH },
      { durationMs: 5000, gapBeforeMs: 100 },
    ]
    const result = analyzeRhythm(elements, { seedUnitMs: 100 })
    expect(result.symbols).toEqual([DOT, DASH, DASH])
    expect(result.suspect).toEqual([2])
  })
})
