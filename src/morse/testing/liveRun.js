// Playing a keystroke log through a live keyer the way the app does: every
// input at its moment, and in between, waking only when the keyer says
// something could change (its nextCheckAt), exactly like the hook's timer.
// After the last input nothing more is keyed; the run has to end by itself.

import { normalize } from '../alphabet.js'
import { createKeyer } from '../keyer.js'

/**
 * Returns { run, finalized, finalizedAt, lastInputAt, lastReleaseAt, observations }.
 * lastReleaseAt is the last release the keyer accepted: input after the run ended is discarded.
 *
 * observations, over every live state the app would have rendered:
 *   maxPending        the most marks ever waiting in the letter being decided
 *   maxLettersSent    the largest SENT numerator shown
 *   targetLetters     its denominator
 *   negativeElapsed   live states with a negative sending time
 *   pastDeadlines     wake-ups whose deadline had already passed without resolving (a spinning timer)
 *   inputAfterFinalize inputs that arrived after the run had ended (they are discarded)
 */
export function playLive(log, { target, anchored = true, errorGapUnits, unitMs, silenceMs = 180_000 }) {
  const keyer = createKeyer({ errorGapUnits, target, anchored, unitMs })
  const observations = {
    maxPending: 0,
    maxLettersSent: 0,
    targetLetters: normalize(target).replaceAll(' ', '').length,
    negativeElapsed: 0,
    pastDeadlines: 0,
    inputAfterFinalize: 0,
    wakeUps: 0,
  }
  let now = log[0]?.t ?? 0
  let finalizedAt = null

  const observe = at => {
    const state = keyer.state(at)
    observations.maxPending = Math.max(observations.maxPending, pendingMarks(state))
    observations.maxLettersSent = Math.max(observations.maxLettersSent, state.lettersSent)
    if (state.elapsedMs < 0) observations.negativeElapsed++
    return state
  }

  // Sleep until `until`, waking at each deadline on the way.
  const sleepUntil = until => {
    for (let guard = 0; guard < 10_000 && !keyer.finalized; guard++) {
      const next = keyer.state(now).nextCheckAt
      if (next === null || next > until) break
      if (next < now) observations.pastDeadlines++
      // The hook wakes a millisecond after the deadline, never before it.
      now = Math.max(now, next) + 1
      if (now > until) break
      observations.wakeUps++
      if (keyer.tick(now)) finalizedAt = now
      observe(now)
    }
    now = Math.max(now, until)
  }

  let lastReleaseAt = null
  for (const event of log) {
    sleepUntil(event.t)
    if (keyer.finalized) {
      observations.inputAfterFinalize++
      continue
    }
    if (event.type === 'down') {
      if (event.pad) keyer.padDown(event.pad, event.t)
      else keyer.keyDown(event.t)
    } else if (event.type === 'up') {
      if (event.pad) keyer.padUp(event.pad, event.t)
      else keyer.keyUp(event.t)
      lastReleaseAt = event.t
    } else if (event.type === 'undo') keyer.undo(event.t)
    else if (event.type === 'letter') keyer.commitLetter(event.t)
    if (keyer.tick(event.t)) finalizedAt = event.t
    observe(event.t)
  }

  const lastInputAt = log.at(-1)?.t ?? now
  sleepUntil(lastInputAt + silenceMs)
  return {
    keyer,
    finalized: keyer.finalized,
    run: keyer.finalized ? keyer.state(now) : null,
    finalizedAt,
    lastInputAt,
    lastReleaseAt,
    observations,
  }
}

/** Marks after the last committed letter: what is still being decided. */
export function pendingMarks(state) {
  return state.strip.length - 1 - state.strip.findLastIndex(mark => mark.endsLetter)
}
