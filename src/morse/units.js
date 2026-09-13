// Speed in PARIS units.
//
// A dot and the gap inside a letter are 1 unit, a dash and a letter gap 3, a
// word gap 7. "PARIS " is exactly 50 units, which defines one word, so
//   wpm = (units sent / 50) / minutes
// A perfectly timed run at W words per minute therefore measures W.

import { toMorse } from './alphabet.js'
import { DASH, DOT } from './symbols.js'

export const UNITS_PER_WORD = 50

/** Extra units a word space adds on top of the letter gap already there (7 − 3). */
export const WORD_SPACE_UNITS = 4

const MARK_UNITS = { [DOT]: 1, [DASH]: 3 }

/** Units of a sequence of letter codes: marks, the gaps inside each letter, and 3 between letters. */
export function codeUnits(codes) {
  let units = 0
  for (const [l, code] of codes.entries()) {
    if (l > 0) units += 3
    for (const [i, mark] of [...code].entries()) units += (MARK_UNITS[mark] ?? 0) + (i > 0 ? 1 : 0)
  }
  return units
}

/**
 * Units a character adds to a text: its marks, the gaps between them, and
 * the letter gap after it. A space adds the 4 extra units that turn a letter
 * gap into a word gap. Characters with no code count only their letter gap.
 */
export function characterUnits(char) {
  if (char === ' ') return WORD_SPACE_UNITS
  return codeUnits([toMorse(char) ?? '']) + 3
}

/** Units needed to send a text, first mark to last. */
export function textUnits(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return 0
  let units = 0
  for (const char of trimmed) units += characterUnits(char)
  return units - 3
}

export function wordsPerMinute(units, elapsedMs) {
  if (!Number.isFinite(units) || !Number.isFinite(elapsedMs) || units <= 0 || elapsedMs <= 0) return 0
  return units / UNITS_PER_WORD / (elapsedMs / 60_000)
}

/** Dot length in ms for a speed, and back. */
export const unitMsForWpm = wpm => 1200 / wpm
export const wpmForUnitMs = unitMs => 1200 / unitMs
