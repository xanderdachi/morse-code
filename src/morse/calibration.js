// Calibration: the operator keys PARIS, the standard speed reference, and we
// measure their dot length from it.

import { interpret } from './keyer.js'
import { CONFIG } from './timing.js'
import { wpmForUnitMs } from './units.js'

export const CALIBRATION_TEXT = 'PARIS'

/**
 * Measure a dot length from a straight-key log of PARIS.
 *
 * The log is read anchored to PARIS from the default seed (not any previous
 * calibration, so a bad one can't bias the next). If it reads PARIS, every
 * press and gap has a known length in units (dot 1, dash 3, gap inside a
 * letter 1, between letters 3) and the median of duration ÷ units is the
 * answer, so one sloppy element can't skew it.
 *
 * Returns { ok: true, unitMs, wpm, heard } or { ok: false, heard }.
 */
export function calibrate(log, config = CONFIG) {
  const run = interpret(log, { target: CALIBRATION_TEXT, anchored: true, unitMs: config.defaultUnitMs, final: true, config })
  const heard = run.text
  if (heard !== CALIBRATION_TEXT || run.marks.some(mark => mark.source !== 'key')) return { ok: false, heard }

  const perUnit = []
  for (const [l, letter] of run.letters.entries()) {
    for (const [i, id] of letter.markIds.entries()) {
      const mark = run.marks[id]
      perUnit.push(mark.durationMs / (mark.symbol === '-' ? 3 : 1))
      if (i > 0) perUnit.push(mark.gapBeforeMs)
      else if (l > 0 && !mark.pauseBefore) perUnit.push(mark.gapBeforeMs / 3)
    }
  }
  perUnit.sort((a, b) => a - b)
  const mid = perUnit.length >> 1
  const middle = perUnit.length % 2 ? perUnit[mid] : (perUnit[mid - 1] + perUnit[mid]) / 2
  const unitMs = Math.min(config.maxUnitMs, Math.max(config.minUnitMs, middle))
  return { ok: true, unitMs, wpm: wpmForUnitMs(unitMs), heard }
}
