import { describe, expect, it } from 'vitest'
import { CHAR_TO_MORSE } from './alphabet.js'
import { UNKNOWN_CHAR, decode } from './decode.js'
import { CONFIG, DASH, DOT, LETTER_GAP, WORD_GAP, appendGap, classifyGap, classifyPress } from './timing.js'

describe('decode', () => {
  it('decodes nothing to an empty string', () => {
    expect(decode([])).toBe('')
    expect(decode('')).toBe('')
  })

  it('decodes letters separated by letter gaps', () => {
    expect(decode([DOT, DASH, LETTER_GAP, DASH, DOT, DOT, DOT, LETTER_GAP])).toBe('AB')
  })

  it('accepts a string of symbols', () => {
    expect(decode('.... . .-.. .-.. --- /.-- --- .-. .-.. -..')).toBe('HELLO WORLD')
  })

  it('round-trips every character in the table', () => {
    for (const [char, code] of Object.entries(CHAR_TO_MORSE)) {
      expect(decode(code)).toBe(char)
    }
  })

  it('decodes an unfinished trailing letter', () => {
    expect(decode('... ---  ...')).toBe('SOS')
    expect(decode('-')).toBe('T')
  })

  it('puts a word gap between words without a separate letter gap', () => {
    expect(decode('../.-')).toBe('I A')
  })

  it('collapses repeated gaps and never pads the result', () => {
    expect(decode([LETTER_GAP, WORD_GAP, DOT, LETTER_GAP, WORD_GAP, WORD_GAP, LETTER_GAP, DASH, WORD_GAP])).toBe(
      'E T',
    )
  })

  it('marks codes that are not in the table', () => {
    expect(decode('........ .-')).toBe(`${UNKNOWN_CHAR}A`)
  })

  it('rejects tokens that are not Morse symbols', () => {
    expect(() => decode('.-|-...')).toThrow(TypeError)
  })
})

describe('timing → decode', () => {
  // Replays key presses as [pressMs, silenceAfterMs] pairs through the classifiers.
  function transmit(presses) {
    let symbols = []
    for (const [press, silence] of presses) {
      symbols = [...symbols, classifyPress(press, CONFIG)]
      const gap = classifyGap(silence, CONFIG)
      if (gap) symbols = appendGap(symbols, gap)
    }
    return symbols
  }

  it('decodes a realistically timed "HI MOM"', () => {
    const dot = 100
    const dash = 330
    const inLetter = 130
    const betweenLetters = 420
    const betweenWords = 900

    const symbols = transmit([
      [dot, inLetter], [dot, inLetter], [dot, inLetter], [dot, betweenLetters], // H
      [dot, inLetter], [dot, betweenWords], // I
      [dash, inLetter], [dash, betweenLetters], // M
      [dash, inLetter], [dash, inLetter], [dash, betweenLetters], // O
      [dash, inLetter], [dash, betweenWords], // M
    ])

    expect(symbols.filter(s => s === WORD_GAP)).toHaveLength(2)
    expect(decode(symbols)).toBe('HI MOM')
  })

  it('runs letters together when the operator never pauses long enough', () => {
    const symbols = transmit([
      [100, 300],
      [330, 300],
    ])
    expect(decode(symbols)).toBe('A')
  })
})
