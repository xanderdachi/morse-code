import { describe, expect, it } from 'vitest'
import { CHAR_TO_MORSE } from './alphabet.js'
import { UNKNOWN_CHAR, decode } from './decode.js'
import { DASH, DOT, LETTER_GAP } from './symbols.js'

describe('decode', () => {
  it('decodes nothing to an empty string', () => {
    expect(decode([])).toBe('')
    expect(decode('')).toBe('')
  })

  it('decodes letters separated by letter boundaries, with no spaces', () => {
    expect(decode([DOT, DASH, LETTER_GAP, DASH, DOT, DOT, DOT, LETTER_GAP])).toBe('AB')
    expect(decode('.... . .-.. .-.. --- .-- --- .-. .-.. -..')).toBe('HELLOWORLD')
  })

  it('round-trips every character in the table', () => {
    for (const [char, code] of Object.entries(CHAR_TO_MORSE)) expect(decode(code)).toBe(char)
  })

  it('decodes an unfinished trailing letter and collapses repeated boundaries', () => {
    expect(decode('...  ---   ...')).toBe('SOS')
    expect(decode('-')).toBe('T')
  })

  it('emits the sentinel for a code that is not in the table', () => {
    expect(decode('........ .-')).toBe(`${UNKNOWN_CHAR}A`)
  })

  it('rejects tokens that are not symbols, including the old word separator', () => {
    expect(() => decode('.-/-...')).toThrow(TypeError)
  })
})
