// The keyer: a run's raw keystroke log in, letters out.
//
// The log is the source of truth. interpret() replays it from the start every
// time it's asked, so a live run, a finished run and a replay of a saved log
// always agree.
//
// Log entries (timestamps in ms on one monotonic clock, e.g. event.timeStamp):
//   { type: 'down' | 'up', t }                 straight key
//   { type: 'down' | 'up', t, pad: '.' | '-' } dot or dash pad button
//   { type: 'letter', t }                      explicit letter boundary (pad control)
//   { type: 'undo', t }                        remove the letter in progress, or the last letter
//   { type: 'finish', t }                      the run was finalized; anything after it is ignored

import { normalize } from './alphabet.js'
import { anchorLetters } from './anchor.js'
import { analyzeRhythm } from './rhythm.js'
import { segmentLetters } from './segment.js'
import { DASH, DOT, isMark } from './symbols.js'
import { CONFIG, pauseGapMs, requireErrorGapUnits, settleGapMs } from './timing.js'
import { codeUnits } from './units.js'

/**
 * Decode a keystroke log into letters.
 *
 * Options:
 *   target         the passage (any form; normalized and spaces removed here)
 *   errorGapUnits  the error path's letter gap, from the tier's leniency table (required)
 *   anchored       segment against the target (default) or from timing alone
 *   unitMs         the operator's calibrated dot length
 *   now            the current time, for a live run
 *   final          the run is over (also implied by a 'finish' event in the log)
 *
 * Returns:
 *   letters        [{ code, char, markIds, kind }]
 *   text           the letters as a string, no spaces
 *   strip          marks to display, in order: [{ id, symbol, endsLetter }]
 *   cursor         next expected letter in the space-stripped target, never past its end. It can step
 *                  back while a letter is being decided; what the app shows is createKeyer's
 *                  displayCursor, which steps back only when the operator takes a letter back
 *   lettersSent    letters on the wire, never more than the target has
 *   remaining      letters of the target not yet reached
 *   scrubs         [{ markIds, letter }] for each error prosign, with the letter it took back
 *   scrubbedLetters how many letters prosigns took back
 *   prosignHeard   an error prosign ended within the last CONFIG.prosignAckMs (live runs)
 *   tookBack       the symbols ('' for none) the latest undo removed, within CONFIG.undoAckMs of it; else null
 *   complete       every letter of the target has been sent
 *   finalized      the run is over and its result is fixed
 *   finalizeAt     when silence alone will end this live run (or null)
 *   finalizeDue    that moment has passed: the run should be finalized now
 *   finalizeReason 'settle' (every letter sent) or 'pause'
 *   beamWidth      how many hypotheses the error path is still weighing (1 = in sync)
 *   paused         silent for longer than the pause threshold right now
 *   startedAt, endedAt, pausedMs, elapsedMs (sending time: first press to last
 *   release, pauses excluded; silence after the last release never counts),
 *   pauseAfterMs   the current pause threshold
 *   letterUnits    PARIS units of the letters sent
 *   marks, anomalies, unitMs, isKeyDown, padsDown, dashFormed, nextCheckAt
 */
export function interpret(
  log,
  { target = '', errorGapUnits, anchored = true, unitMs = CONFIG.defaultUnitMs, now = null, final = false, config = CONFIG } = {},
) {
  const { marks, steps, anomalies, keyDownAt, padDownAt, lastEnd, finished } = readLog(log, config, unitMs)
  const isFinal = final || finished

  const rhythm = analyzeRhythm(marks, { seedUnitMs: unitMs, lookahead: isFinal, config })
  for (const [i, mark] of marks.entries()) {
    mark.symbol = rhythm.symbols[i]
    mark.unitMs = rhythm.units[i]
  }
  for (const i of rhythm.suspect) anomalies.push({ type: 'long-press', t: marks[i].start, durationMs: marks[i].durationMs })
  anomalies.sort((a, b) => a.t - b.t)

  // Silence beyond the pause threshold stops the clock; the threshold itself
  // still counts as sending time, so the timer never jumps backwards.
  let pausedMs = 0
  for (const [i, mark] of marks.entries()) {
    mark.gapUnitMs = i > 0 ? marks[i - 1].unitMs : mark.unitMs
    const limit = pauseGapMs(mark.gapUnitMs, config)
    mark.pauseBefore = mark.gapBeforeMs !== null && mark.gapBeforeMs > limit
    if (mark.pauseBefore) pausedMs += mark.gapBeforeMs - limit
  }

  const holding = keyDownAt !== null || padDownAt.size > 0
  const currentUnitMs = marks.at(-1)?.unitMs ?? rhythm.startUnitMs
  const silenceMs = !isFinal && !holding && lastEnd !== null && now !== null ? Math.max(0, now - lastEnd) : null
  const pauseAfterMs = pauseGapMs(currentUnitMs, config)
  // Inclusive, so a check that fires exactly on the pause deadline sees the pause begin.
  const paused = silenceMs !== null && silenceMs >= pauseAfterMs

  const compareTarget = normalize(target).replaceAll(' ', '').toUpperCase()
  const segmentation = { target: compareTarget, errorGapUnits, final: isFinal, silenceMs, unitMs: currentUnitMs, lastEnd, holding, config }
  const result = anchored
    ? anchorLetters(steps, marks, segmentation)
    : segmentLetters(steps, marks, { ...segmentation, targetLength: compareTarget.length })

  const strip = []
  for (const letter of result.letters) {
    letter.markIds.forEach((id, i) => strip.push({ id, symbol: marks[id].symbol, endsLetter: i === letter.markIds.length - 1 }))
  }
  for (const id of result.pendingIds) strip.push({ id, symbol: marks[id].symbol, endsLetter: false })

  // How far through the target the run has got. Anchored, that is the cursor.
  // Unanchored, it is how much of the passage the letters line up with, so extra
  // letters can't make a run look finished while the operator is still keying.
  // A letter still open counts: by the time the settle silence has passed, it has closed.
  const position = anchored
    ? result.cursor
    : reachedIn(compareTarget, result.letters.map(letter => letter.char), result.pendingIds.length > 0)
  const remaining = Math.max(0, compareTarget.length - position)

  // The acknowledgement for an error prosign lasts a moment after its last dot.
  const lastProsign = result.scrubs.at(-1)
  const prosignEnd = lastProsign ? Math.max(...lastProsign.markIds.map(id => marks[id].end)) : null
  const prosignHeard = !isFinal && now !== null && prosignEnd !== null && now < prosignEnd + config.prosignAckMs

  // Each undo shows, for a moment, what it removed.
  const lastUndo = result.undos.at(-1)
  const undoShowing = !isFinal && now !== null && lastUndo !== undefined && now < lastUndo.t + config.undoAckMs
  const tookBack = undoShowing ? lastUndo.markIds.map(id => marks[id].symbol).join('') : null

  const startedAt = marks[0]?.start ?? null
  let dashFormed = false
  const deadlines = [
    result.nextCheckAt,
    prosignHeard ? prosignEnd + config.prosignAckMs : null,
    undoShowing ? lastUndo.t + config.undoAckMs : null,
  ]
  let finalizeAt = null
  let finalizeReason = null
  if (!isFinal) {
    if (keyDownAt !== null && now !== null) {
      dashFormed = now - keyDownAt >= config.dashAtUnits * currentUnitMs
      if (!dashFormed) deadlines.push(keyDownAt + config.dashAtUnits * currentUnitMs)
    }
    if (silenceMs !== null && !paused) deadlines.push(lastEnd + pauseAfterMs)

    // Ending on silence never depends on the letters being right. Every letter
    // reached: a short settle ends it, overrun included, since each extra mark
    // just restarts it. Otherwise a long pause does, shorter at the last letter.
    if (!holding && lastEnd !== null && compareTarget.length > 0) {
      if (remaining === 0) {
        finalizeAt = lastEnd + settleGapMs(currentUnitMs, config)
        finalizeReason = 'settle'
      } else {
        // At the last letter, or with as many letters sent as the passage has (unanchored, the
        // alignment may still say a few are missing): the shorter pause ends it.
        const atEnd = remaining <= 1 || result.letters.length >= compareTarget.length
        const pauseLimit = atEnd ? config.finishPauseAtEndMs : config.finishPauseMidMs
        finalizeAt = lastEnd + pauseAfterMs + pauseLimit
        finalizeReason = 'pause'
      }
      deadlines.push(finalizeAt)
    }
  }
  const upcoming = deadlines.filter(t => t !== null)

  return {
    letters: result.letters,
    text: result.letters.map(letter => letter.char).join(''),
    strip,
    cursor: Math.min(result.cursor ?? result.letters.length, compareTarget.length),
    lettersSent: compareTarget.length > 0 ? Math.min(result.letters.length, compareTarget.length) : result.letters.length,
    remaining,
    scrubs: result.scrubs,
    scrubbedLetters: result.scrubs.filter(scrub => scrub.letter !== null).length,
    prosignHeard,
    tookBack,
    complete: result.complete,
    finalized: isFinal,
    finalizeAt,
    finalizeDue: finalizeAt !== null && now !== null && now >= finalizeAt,
    finalizeReason,
    beamWidth: result.beamWidth ?? 1,
    anchored,
    paused,
    startedAt,
    endedAt: lastEnd,
    pausedMs,
    elapsedMs: startedAt === null ? 0 : lastEnd - startedAt - pausedMs,
    pauseAfterMs,
    letterUnits: codeUnits(result.letters.map(letter => letter.code)),
    marks,
    anomalies,
    unitMs: currentUnitMs,
    isKeyDown: keyDownAt !== null,
    padsDown: { [DOT]: padDownAt.has(DOT), [DASH]: padDownAt.has(DASH) },
    dashFormed,
    nextCheckAt: upcoming.length ? Math.min(...upcoming) : null,
  }
}

/**
 * A live keyer for one run. Input methods record accepted transitions in the
 * log (a second 'down' while already down — keyboard auto-repeat, a second
 * finger — is ignored and returns false). Once the run is finalized, every
 * input method returns false and records nothing.
 *
 * Every state it returns, live or final, also carries displayCursor: the letter
 * the passage highlight and the SENT count put the operator at (advanceDisplay).
 * It is the one thing in a state that depends on the states returned before it,
 * so a replay of the log doesn't have it. Grading never reads it.
 */
export function createKeyer({ unitMs = CONFIG.defaultUnitMs, target = '', errorGapUnits, anchored = true, config = CONFIG } = {}) {
  requireErrorGapUnits(errorGapUnits)
  let log = []
  const options = { unitMs, target, anchored, errorGapUnits }
  let keyHeld = false
  const padsHeld = new Set()
  let finalRun = null
  let display = NOTHING_SHOWN

  // A state on its way to the app, with the display cursor moved on to it.
  function shown(state) {
    // Only anchoring acts on undo; unanchored, it is ignored.
    const undos = options.anchored ? log.filter(event => event.type === 'undo').length : 0
    display = advanceDisplay(display, state, undos)
    return { ...state, displayCursor: display.cursor }
  }

  const keyer = {
    get log() {
      return log
    },

    get finalized() {
      return finalRun !== null
    },

    /** Whether the key or a pad is held right now. Cheap: no interpretation. */
    get holding() {
      return keyHeld || padsHeld.size > 0
    },

    /** Change the calibration, target or anchoring. The whole run is re-read with them. */
    configure(next) {
      if (next.unitMs !== undefined) options.unitMs = next.unitMs ?? CONFIG.defaultUnitMs
      // A place in one passage means nothing in another: the display starts again from the new target's cursor.
      if (next.target !== undefined && next.target !== options.target) display = NOTHING_SHOWN
      if (next.target !== undefined) options.target = next.target
      if (next.anchored !== undefined) options.anchored = next.anchored
      if (next.errorGapUnits !== undefined) options.errorGapUnits = requireErrorGapUnits(next.errorGapUnits)
    },

    keyDown(t) {
      if (finalRun || keyHeld) return false
      keyHeld = true
      log.push({ type: 'down', t })
      return true
    },

    keyUp(t) {
      if (finalRun || !keyHeld) return false
      keyHeld = false
      log.push({ type: 'up', t })
      return true
    },

    padDown(pad, t) {
      if (finalRun || !isMark(pad) || padsHeld.has(pad)) return false
      padsHeld.add(pad)
      log.push({ type: 'down', t, pad })
      return true
    },

    padUp(pad, t) {
      if (finalRun || !padsHeld.has(pad)) return false
      padsHeld.delete(pad)
      log.push({ type: 'up', t, pad })
      return true
    },

    /** Force a letter boundary here, even mid-letter. */
    commitLetter(t) {
      if (finalRun) return false
      log.push({ type: 'letter', t })
      return true
    },

    undo(t) {
      if (finalRun) return false
      log.push({ type: 'undo', t })
      return true
    },

    /** Release everything held, as if let go at `t` (blur, pointercancel, mode switch). */
    releaseAll(t) {
      let changed = keyer.keyUp(t)
      for (const pad of [...padsHeld]) changed = keyer.padUp(pad, t) || changed
      return changed
    },

    /** The live state at `now`, or the fixed result once the run is finalized. */
    state(now) {
      return finalRun ?? shown(interpret(log, { ...options, now, config }))
    },

    /**
     * Finalize the run if silence has ended it by `now`. The decision is made
     * from the real time since the last release, so a timer that fires late or
     * early can't end a run at the wrong moment. Returns true if it finalized.
     */
    tick(now) {
      if (finalRun) return false
      return keyer.update(now).finalized
    },

    /**
     * tick() and state() in one pass: finalizes the run if silence has ended it
     * by `now`, then returns the state. Reads the log once when nothing ends.
     */
    update(now) {
      if (finalRun) return finalRun
      const live = interpret(log, { ...options, now, config })
      return live.finalizeDue ? keyer.finalize(now, live.finalizeReason) : shown(live)
    },

    /**
     * End the run at `t`: anything held counts as released, any letter in
     * progress commits as sent (# if it isn't a valid code), and from here on
     * all input is discarded. Returns the result, with its keystroke log.
     */
    finalize(t, reason = 'finish') {
      if (finalRun) return finalRun
      keyer.releaseAll(t)
      log.push({ type: 'finish', t })
      finalRun = { ...shown(interpret(log, { ...options, config })), log: [...log], finishReason: reason }
      return finalRun
    },

    /** The explicit Finish control. */
    finish(t) {
      return keyer.finalize(t, 'finish')
    },

    reset() {
      log = []
      keyHeld = false
      padsHeld.clear()
      finalRun = null
      display = NOTHING_SHOWN
    },
  }

  return keyer
}

const NOTHING_SHOWN = Object.freeze({ cursor: 0, undos: 0, prosigns: Object.freeze([]) })

/**
 * The display cursor, moved on to `state`: where the passage highlight and the
 * SENT count put the operator. It follows the cursor forward and never back on
 * its own account. The cursor steps back while a letter is being decided: when
 * a hypothesis further behind takes the lead, when a letter the silence closed
 * opens again as the next press starts, when a hard resync lands behind, and
 * (unanchored) when the timing regroups letters. The display holds through all
 * of it; the final alignment, not the display, decides what was right.
 *
 * The operator taking a letter back does move it back, to wherever the cursor
 * lands: an undo (`undos` counts those the decoder acted on) or an error prosign
 * not heard before, known by when its first mark was pressed so that a prosign
 * the beam reads again isn't taken for another.
 */
function advanceDisplay(display, { cursor, scrubs, marks }, undos) {
  const prosigns = scrubs.map(scrub => marks[scrub.markIds[0]].start)
  if (undos > display.undos || prosigns.some(start => !display.prosigns.includes(start))) {
    return { cursor, undos: Math.max(undos, display.undos), prosigns: [...new Set([...display.prosigns, ...prosigns])] }
  }
  return cursor > display.cursor ? { ...display, cursor } : display
}

/**
 * How many letters of `target` the letters sent so far best line up with: the
 * prefix length with the least edit distance to them. A letter still open
 * matches whatever comes next. On a tie (were the last letters wrong, or extra
 * with more still to come?) the shorter prefix wins: a run must never end while
 * the operator is still keying, and Finish or the pause rule end it otherwise.
 */
export function reachedIn(target, sent, open = false) {
  const n = sent.length + (open ? 1 : 0)
  if (target.length === 0) return n
  // previous[j]: distance between the letters so far and target[0..j).
  let previous = Array.from({ length: target.length + 1 }, (_, j) => j)
  for (let i = 1; i <= n; i++) {
    const letter = i <= sent.length ? sent[i - 1] : null
    const row = [i]
    for (let j = 1; j <= target.length; j++) {
      const substitution = previous[j - 1] + (letter === null || letter === target[j - 1] ? 0 : 1)
      row.push(Math.min(substitution, previous[j] + 1, row[j - 1] + 1))
    }
    previous = row
  }
  let best = 0
  for (let j = 1; j <= target.length; j++) {
    if (previous[j] < previous[best]) best = j
  }
  return best
}

/**
 * The shortest press that isn't contact bounce, for this log: bounceUnits of the operator's dot, held within
 * [bounceFloorMs, minPressMs]. The dot comes from the run's own straight-key presses once there are enough of them
 * (their 10th percentile: dots jittered short, not the odd bounce), and from the seed unit until then.
 */
export function bounceThresholdMs(log, seedUnitMs = CONFIG.defaultUnitMs, config = CONFIG) {
  const durations = []
  let downAt = null
  for (const event of log) {
    if (event.type === 'finish') break
    if (event.pad !== undefined) continue
    if (event.type === 'down') downAt ??= event.t
    else if (event.type === 'up' && downAt !== null) {
      if (event.t - downAt >= config.bounceFloorMs) durations.push(event.t - downAt)
      downAt = null
    }
  }
  let dotMs = seedUnitMs
  if (durations.length >= config.bounceReferencePresses) {
    durations.sort((a, b) => a - b)
    dotMs = durations[Math.floor(durations.length / 10)]
  }
  return Math.min(config.minPressMs, Math.max(config.bounceFloorMs, config.bounceUnits * dotMs))
}

// Pair downs with ups into marks, dropping repeats, stray ups and bounces.
// Reading stops at a 'finish' event.
function readLog(log, config, seedUnitMs) {
  const bounceMs = bounceThresholdMs(log, seedUnitMs, config)
  const marks = []
  const steps = []
  const anomalies = []
  let keyDownAt = null
  const padDownAt = new Map()
  let lastEnd = null
  let rhythmBreak = false
  let finished = false

  for (const event of log) {
    if (event.type === 'finish') {
      finished = true
      break
    }
    if (event.type === 'letter' || event.type === 'undo') {
      steps.push({ type: event.type === 'letter' ? 'boundary' : 'undo', t: event.t })
      rhythmBreak = true
      continue
    }
    const pad = event.pad
    if (pad !== undefined && !isMark(pad)) continue

    if (event.type === 'down') {
      if (pad === undefined) keyDownAt ??= event.t
      else if (!padDownAt.has(pad)) padDownAt.set(pad, event.t)
      continue
    }
    if (event.type !== 'up') continue

    const start = pad === undefined ? keyDownAt : padDownAt.get(pad)
    if (start === null || start === undefined) continue
    if (pad === undefined) keyDownAt = null
    else padDownAt.delete(pad)

    const durationMs = event.t - start
    if (durationMs < bounceMs) {
      anomalies.push({ type: 'bounce', t: start, durationMs })
      continue
    }

    const id = marks.length
    marks.push({
      id,
      source: pad === undefined ? 'key' : 'pad',
      fixedSymbol: pad,
      start,
      end: event.t,
      durationMs,
      // Overlapping pad taps have no gap between them.
      gapBeforeMs: lastEnd === null ? null : Math.max(0, start - lastEnd),
      rhythmBreak,
    })
    steps.push({ type: 'mark', id })
    lastEnd = Math.max(lastEnd ?? event.t, event.t)
    rhythmBreak = false
  }

  // A finished run holds nothing: anything still down was released by finalize.
  if (finished) {
    keyDownAt = null
    padDownAt.clear()
  }
  return { marks, steps, anomalies, keyDownAt, padDownAt, lastEnd, finished }
}
