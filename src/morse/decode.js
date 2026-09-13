import { fromMorse } from './alphabet.js'
import { DASH, DOT, LETTER_GAP } from './symbols.js'

/**
 * Stands in for a letter whose code isn't in the table. Has no Morse code
 * itself. Emitted rather than dropping the letter, so grading still sees a
 * character in that position and marks it wrong instead of shifting everything.
 */
export const UNKNOWN_CHAR = '#'

/**
 * Turn symbol tokens (an array, or a string like '.- -...') into uppercase
 * letters with no spaces: spaces are never keyed. A trailing unfinished letter
 * is decoded as if its boundary had arrived; repeated boundaries collapse.
 */
export function decode(symbols) {
  let text = ''
  let code = ''
  const endLetter = () => {
    if (code) text += fromMorse(code) ?? UNKNOWN_CHAR
    code = ''
  }

  for (const symbol of symbols) {
    if (symbol === DOT || symbol === DASH) code += symbol
    else if (symbol === LETTER_GAP) endLetter()
    else throw new TypeError(`Unknown Morse symbol: ${JSON.stringify(symbol)}`)
  }
  endLetter()
  return text
}
