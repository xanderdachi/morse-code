import { describe, expect, it } from 'vitest'
import { characterUnits, codeUnits, textUnits, unitMsForWpm, wordsPerMinute, wpmForUnitMs } from './units.js'

describe('PARIS units', () => {
  it('makes "PARIS " exactly 50 units', () => {
    expect(textUnits('PARIS')).toBe(43)
    expect([...'PARIS '].reduce((sum, char) => sum + characterUnits(char), 0)).toBe(50)
    expect(textUnits('PARIS PARIS')).toBe(93)
  })

  it('counts letter codes: marks, gaps inside letters, and 3 between letters', () => {
    expect(codeUnits(['.--.', '.-', '.-.', '..', '...'])).toBe(43)
    expect(codeUnits(['.'])).toBe(1)
    expect(codeUnits(['..'])).toBe(3)
    expect(codeUnits(['-', '.'])).toBe(7)
    expect(codeUnits([])).toBe(0)
  })

  it('is zero for nothing', () => {
    expect(textUnits('')).toBe(0)
    expect(textUnits('   ')).toBe(0)
  })
})

describe('wordsPerMinute', () => {
  it('is 50 units per word per minute', () => {
    expect(wordsPerMinute(50, 60_000)).toBe(1)
    expect(wordsPerMinute(43, 43 * unitMsForWpm(20))).toBeCloseTo(20, 10)
  })

  it('is zero rather than NaN or Infinity for empty or instant runs', () => {
    expect(wordsPerMinute(0, 0)).toBe(0)
    expect(wordsPerMinute(10, 0)).toBe(0)
    expect(wordsPerMinute(Number.NaN, 5000)).toBe(0)
  })

  it('converts between speed and dot length', () => {
    expect(unitMsForWpm(10)).toBe(120)
    expect(wpmForUnitMs(60)).toBe(20)
  })
})
