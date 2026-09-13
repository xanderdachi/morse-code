// Symbols: dots, dashes, and the letter boundary.
//
// A display stream is a flat array: marks, with LETTER_GAP wherever a letter
// has been committed. There is no word boundary: spaces are never keyed.
//   ['.', '-', ' ', '-', ' ', '.']  →  "ATE"

export const DOT = '.'
export const DASH = '-'
export const LETTER_GAP = ' '

export function isMark(symbol) {
  return symbol === DOT || symbol === DASH
}
