// Turning a finalized run into the result the player sees, by the rules of their tier.

import { grade } from '../morse/grade.js'
import { leniencyFor, prosignDeletions } from './progress.js'

/**
 * Leaderboard divisions. Iambic keying is machine-timed, so its speed is
 * chosen rather than earned: iambic runs rank on their own, apart from the
 * straight key and the manual pad, and never share a table with them.
 */
export const DIVISIONS = Object.freeze({
  'straight-key': 'Straight key',
  'pad-manual': 'Dot / dash pad',
  'pad-iambic': 'Iambic keyer',
})

/** The division a run ranks in, from how it was keyed. */
export function divisionOf({ mode, keyerMode }) {
  if (mode !== 'pad') return 'straight-key'
  return keyerMode === 'iambic' ? 'pad-iambic' : 'pad-manual'
}

/**
 * Grade a finalized run.
 *
 *   run        the keyer's fixed result
 *   target     the passage's text_morse_safe
 *   progress   the player's progress, for their tier's leniency
 *   mode       'key' or 'pad'
 *   keyerMode  'manual' or 'iambic' (the pad only)
 *   keyerWpm   the iambic keyer's speed, when it keyed the run
 *
 * Letters taken back with the error prosign are left out of grading where the
 * tier makes that free, and graded as missed letters where it doesn't.
 */
export function scoreRun({ run, target, progress, mode, keyerMode = 'manual', keyerWpm = null }) {
  const iambic = mode === 'pad' && keyerMode === 'iambic'
  const graded = grade({
    target,
    sent: run.text,
    elapsedMs: run.elapsedMs,
    letterUnits: run.letterUnits,
    extraDeletions: prosignDeletions(progress, run.scrubbedLetters ?? 0),
  })
  return {
    ...graded,
    elapsedMs: run.elapsedMs,
    pausedMs: run.pausedMs,
    anchored: run.anchored,
    scrubbedLetters: run.scrubbedLetters ?? 0,
    prosign: leniencyFor(progress.tier).prosign,
    mode,
    keyerMode: iambic ? 'iambic' : 'manual',
    keyerWpm: iambic ? keyerWpm : null,
    division: divisionOf({ mode, keyerMode }),
  }
}
