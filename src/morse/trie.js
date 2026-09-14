// Every code in the alphabet table, plus the error prosign, as a prefix trie of
// dots and dashes, built once when the module loads. It answers the only
// question the decoders need while a letter is being keyed: could these symbols
// still become something? These are facts about Morse, never about the passage.

import { CHAR_TO_MORSE } from './alphabet.js'
import { DOT } from './symbols.js'

/** Eight dots: the error prosign, "disregard that, starting over". */
export const ERROR_PROSIGN = DOT.repeat(8)

const LETTER_CODES = Object.values(CHAR_TO_MORSE)

const root = new Map()
for (const code of [...LETTER_CODES, ERROR_PROSIGN]) {
  let node = root
  for (const symbol of code) {
    if (!node.has(symbol)) node.set(symbol, new Map())
    node = node.get(symbol)
  }
}

/** The longest letter code (7, for $). No buffer that could still be a letter is longer. */
export const LONGEST_LETTER = Math.max(...LETTER_CODES.map(code => code.length))

/**
 * Whether `code` is all or the start of a code in the table, or of the error
 * prosign. A buffer that isn't can never become a letter.
 */
export function isCodePrefix(code) {
  let node = root
  for (const symbol of code) {
    node = node.get(symbol)
    if (!node) return false
  }
  return true
}

/** Whether `code` is the error prosign, perhaps with more symbols run on after it. */
export function startsWithProsign(code) {
  return code.startsWith(ERROR_PROSIGN)
}
