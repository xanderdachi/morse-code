// Turning key timing into symbols.
//
// A transmission is a flat array of symbol tokens. Every finished letter ends
// with LETTER_GAP; a finished word additionally gets WORD_GAP after that:
//   ['.', '-', ' ', '-', ' ', '/', '.', ' ']  →  "AT E"

export const DOT = '.'
export const DASH = '-'
export const LETTER_GAP = ' '
export const WORD_GAP = '/'

/** All timing thresholds, in units of `unitMs`. Tune here. */
export const CONFIG = {
  unitMs: 120,
  dashAfterUnits: 2, // a press longer than this is a dash
  letterGapUnits: 3, // silence at least this long ends a letter
  wordGapUnits: 7, // silence at least this long ends a word
}

export function thresholdsMs(config = CONFIG) {
  return {
    dash: config.unitMs * config.dashAfterUnits,
    letterGap: config.unitMs * config.letterGapUnits,
    wordGap: config.unitMs * config.wordGapUnits,
  }
}

/** Classify how long the key was held down. */
export function classifyPress(durationMs, config = CONFIG) {
  return durationMs > thresholdsMs(config).dash ? DASH : DOT
}

/** Classify a silence between presses: null (same letter), LETTER_GAP or WORD_GAP. */
export function classifyGap(durationMs, config = CONFIG) {
  const { letterGap, wordGap } = thresholdsMs(config)
  if (durationMs >= wordGap) return WORD_GAP
  if (durationMs >= letterGap) return LETTER_GAP
  return null
}

export function isMark(symbol) {
  return symbol === DOT || symbol === DASH
}

/**
 * Append a gap to a transmission, keeping it well-formed: no gaps before the
 * first mark, one LETTER_GAP per letter, and at most one WORD_GAP in a row.
 * Returns the same array when nothing changes.
 */
export function appendGap(symbols, gap) {
  let next = symbols
  if (isMark(next.at(-1))) next = [...next, LETTER_GAP]
  if (gap === WORD_GAP && next.at(-1) === LETTER_GAP) next = [...next, WORD_GAP]
  return next
}
