import { describe, expect, it } from 'vitest'
import {
  CONFIG,
  DASH,
  DOT,
  LETTER_GAP,
  WORD_GAP,
  appendGap,
  classifyGap,
  classifyPress,
  thresholdsMs,
} from './timing.js'

describe('CONFIG', () => {
  it('defaults to a 120ms unit with dash > 2, letter gap >= 3, word gap >= 7 units', () => {
    expect(CONFIG).toEqual({ unitMs: 120, dashAfterUnits: 2, letterGapUnits: 3, wordGapUnits: 7 })
    expect(thresholdsMs()).toEqual({ dash: 240, letterGap: 360, wordGap: 840 })
  })
})

describe('classifyPress', () => {
  it('treats presses up to and including 2 units as dots', () => {
    expect(classifyPress(0)).toBe(DOT)
    expect(classifyPress(120)).toBe(DOT)
    expect(classifyPress(240)).toBe(DOT)
  })

  it('treats presses longer than 2 units as dashes', () => {
    expect(classifyPress(240.5)).toBe(DASH)
    expect(classifyPress(241)).toBe(DASH)
    expect(classifyPress(360)).toBe(DASH)
    expect(classifyPress(5000)).toBe(DASH)
  })

  it('follows a custom config', () => {
    const slow = { ...CONFIG, unitMs: 200 }
    expect(classifyPress(300, slow)).toBe(DOT)
    expect(classifyPress(401, slow)).toBe(DASH)
  })
})

describe('classifyGap', () => {
  it('keeps short silences inside the current letter', () => {
    expect(classifyGap(0)).toBeNull()
    expect(classifyGap(120)).toBeNull()
    expect(classifyGap(359)).toBeNull()
  })

  it('ends a letter at exactly 3 units and beyond', () => {
    expect(classifyGap(360)).toBe(LETTER_GAP)
    expect(classifyGap(600)).toBe(LETTER_GAP)
    expect(classifyGap(839)).toBe(LETTER_GAP)
  })

  it('ends a word at exactly 7 units and beyond', () => {
    expect(classifyGap(840)).toBe(WORD_GAP)
    expect(classifyGap(10_000)).toBe(WORD_GAP)
  })

  it('follows a custom config', () => {
    const wide = { ...CONFIG, letterGapUnits: 4, wordGapUnits: 10 }
    expect(classifyGap(400, wide)).toBeNull()
    expect(classifyGap(480, wide)).toBe(LETTER_GAP)
    expect(classifyGap(1200, wide)).toBe(WORD_GAP)
  })
})

describe('appendGap', () => {
  it('ignores gaps before anything has been sent', () => {
    const empty = []
    expect(appendGap(empty, LETTER_GAP)).toBe(empty)
    expect(appendGap(empty, WORD_GAP)).toBe(empty)
  })

  it('closes a letter with a single letter gap', () => {
    const once = appendGap([DOT, DASH], LETTER_GAP)
    expect(once).toEqual([DOT, DASH, LETTER_GAP])
    expect(appendGap(once, LETTER_GAP)).toBe(once)
  })

  it('closes a word with a letter gap then a word gap, once', () => {
    const word = appendGap([DOT], WORD_GAP)
    expect(word).toEqual([DOT, LETTER_GAP, WORD_GAP])
    expect(appendGap(word, WORD_GAP)).toBe(word)
    expect(appendGap(word, LETTER_GAP)).toBe(word)
  })

  it('upgrades a finished letter to a finished word', () => {
    expect(appendGap([DASH, LETTER_GAP], WORD_GAP)).toEqual([DASH, LETTER_GAP, WORD_GAP])
  })
})
