// An iambic keyer: two paddles in, perfectly timed elements out.
//
// A straight key or a manual pad reads each element from the operator. An
// iambic keyer generates them: while the dot paddle is held it sends dots, the
// dash paddle dashes, and both together (a squeeze) alternate, all at exactly
// the configured speed. Dot 1 unit, dash 3, 1 unit of space after each, a unit
// being 1200 / WPM ms.
//
// Its output is the pad's own log entries, { type: 'down' | 'up', t, pad }, so
// everything downstream (anchoring, segmentation, grading) is unchanged.
//
// It is a state machine on an injected clock: it never reads the time or sets
// a timer. Tell it about each paddle change with the change's timestamp, call
// advance(now) to collect every element event due by `now`, and wake it again
// at nextEventAt. A paddle change at the same moment as a decision counts
// first, so holding a paddle for exactly five dot periods sends five dots.

import { DASH, DOT } from './symbols.js'
import { unitMsForWpm } from './units.js'

export const IAMBIC_MODES = Object.freeze({ A: 'A', B: 'B' })

/**
 * Mode B (Curtis B): letting go of a squeeze sends one more element, the
 * opposite of the last. Mode A stops. Not offered in settings yet.
 */
export const IAMBIC_MODE = IAMBIC_MODES.B

const other = symbol => (symbol === DOT ? DASH : DOT)

/**
 * Create a keyer at `wpm`.
 *
 *   press(pad, t) / release(pad, t)   a paddle went down or up at `t`
 *   stop(t)                           let go of everything now: blur, pointercancel, a hidden page.
 *                                     An element still sounding ends at `t`; nothing follows.
 *   advance(now)                      the element events due by `now`, in order
 *   nextEventAt                       when advance() next has something to do, or null when idle
 *   setWpm(wpm)                       takes effect from the next element
 *   reset()
 */
export function createIambicKeyer({ wpm, mode = IAMBIC_MODE }) {
  let unitMs = unitMsForWpm(wpm)
  const held = { [DOT]: false, [DASH]: false }
  const memory = { [DOT]: false, [DASH]: false }
  // The element being sent, through its trailing space: { symbol, start, end, space, released, squeezed }.
  let element = null
  let due = []

  function begin(symbol, t) {
    memory[symbol] = false
    element = {
      symbol,
      start: t,
      end: t + (symbol === DOT ? 1 : 3) * unitMs,
      space: unitMs,
      released: false,
      // Both paddles held at any point during the element (Mode B's trailing element).
      squeezed: held[DOT] && held[DASH],
    }
    due.push({ type: 'down', t, pad: symbol })
  }

  // What follows the current element, decided at the end of its space.
  function nextSymbol() {
    const last = element.symbol
    if (held[DOT] && held[DASH]) return other(last)
    if (memory[other(last)]) return other(last)
    if (held[DOT]) return DOT
    if (held[DASH]) return DASH
    if (mode === IAMBIC_MODES.B && element.squeezed) return other(last)
    return null
  }

  // Play the timeline forward to `t`: through it if `inclusive`, else only what happens strictly before.
  function runTo(t, inclusive) {
    const reached = at => (inclusive ? at <= t : at < t)
    while (element) {
      if (!element.released) {
        if (!reached(element.end)) return
        due.push({ type: 'up', t: element.end, pad: element.symbol })
        element.released = true
      }
      const decision = element.end + element.space
      if (!reached(decision)) return
      const next = nextSymbol()
      element = null
      if (next) begin(next, decision)
    }
  }

  return {
    press(pad, t) {
      if (pad !== DOT && pad !== DASH) return
      runTo(t, false)
      if (held[pad]) return
      held[pad] = true
      if (!element) {
        begin(pad, t)
        return
      }
      // Dot (or dash) memory: pressed during the other element, it goes next even if let go at once.
      if (pad !== element.symbol) memory[pad] = true
      if (held[DOT] && held[DASH]) element.squeezed = true
    },

    release(pad, t) {
      if (pad !== DOT && pad !== DASH) return
      runTo(t, false)
      held[pad] = false
    },

    stop(t) {
      runTo(t, false)
      held[DOT] = held[DASH] = false
      memory[DOT] = memory[DASH] = false
      if (!element) return
      element.squeezed = false
      if (!element.released) {
        element.end = Math.max(element.start, t)
        element.released = true
        due.push({ type: 'up', t: element.end, pad: element.symbol })
      }
    },

    advance(now) {
      runTo(now, true)
      const events = due
      due = []
      return events
    },

    get nextEventAt() {
      if (due.length > 0) return due[0].t
      if (!element) return null
      return element.released ? element.end + element.space : element.end
    },

    get paddles() {
      return { ...held }
    },

    get unitMs() {
      return unitMs
    },

    setWpm(nextWpm) {
      unitMs = unitMsForWpm(nextWpm)
    },

    reset() {
      held[DOT] = held[DASH] = false
      memory[DOT] = memory[DASH] = false
      element = null
      due = []
    },
  }
}
