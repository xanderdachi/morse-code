import { fromMorse } from './alphabet.js'
import { DASH, DOT, LETTER_GAP, WORD_GAP } from './timing.js'

/** Stands in for a letter whose code isn't in the table. Has no Morse code itself. */
export const UNKNOWN_CHAR = '#'

/**
 * Turn symbol tokens (an array, or a string like '.- -.../..') into uppercase text.
 * A trailing unfinished letter is decoded as if its gap had arrived. Repeated
 * gaps collapse, and the result never starts or ends with a space.
 */
export function decode(symbols) {
  let text = ''
  let code = ''
  let spacePending = false

  const endLetter = () => {
    if (!code) return
    if (spacePending && text) text += ' '
    text += fromMorse(code) ?? UNKNOWN_CHAR
    code = ''
    spacePending = false
  }

  for (const symbol of symbols) {
    if (symbol === DOT || symbol === DASH) {
      code += symbol
    } else if (symbol === LETTER_GAP) {
      endLetter()
    } else if (symbol === WORD_GAP) {
      endLetter()
      spacePending = true
    } else {
      throw new TypeError(`Unknown Morse symbol: ${JSON.stringify(symbol)}`)
    }
  }
  endLetter()

  return text
}
