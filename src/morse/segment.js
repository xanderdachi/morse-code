// Unanchored segmentation: letters from timing alone, decided over the whole run.
//
// Every gap between marks is either inside a letter or a boundary. Rather
// than thresholding each gap on its own, choose the segmentation of the whole
// mark sequence that best fits the gaps (Viterbi), with costs in log space
// because timing error is multiplicative.
//
// A segment is one of:
//   letter    a code in the table                                    free
//   garbled   symbols that are no prefix of any code (trie.js): one  cheap, so a run
//             garbled character, however long the run goes on        sent without letter
//                                                                     gaps stays one #
//   prosign   eight dots, plus anything run on after them            free; takes back
//                                                                     the letter before
//   unfinished a prefix of a code that is no code itself (#)          expensive: only when
//                                                                     nothing else fits

import { fromMorse } from './alphabet.js'
import { UNKNOWN_CHAR } from './decode.js'
import { twoMeans } from './rhythm.js'
import { errorGapMs, requireErrorGapUnits } from './timing.js'
import { LONGEST_LETTER, isCodePrefix, startsWithProsign } from './trie.js'

const LONGEST_RUN = 16 // a garbled character or prosign swallows at most this many symbols
const GARBLED_COST = 0.6 // below one boundary misread at an inside gap, (log 3)² ≈ 1.21
const UNFINISHED_COST = 40
const DEFAULT_CENTERS = [0, Math.log(3)] // a gap inside a letter is 1 unit, a boundary 3

/**
 * Segment a run's marks into letters from timing.
 *
 *   steps          the run in order ({ type: 'mark' | 'boundary' | 'undo' }); an explicit
 *                  boundary forces one, undo has no meaning here and is ignored
 *   marks          by id: { id, symbol, gapBeforeMs, gapUnitMs, pauseBefore }
 *   errorGapUnits  the silence, in units, that closes the last letter (leniency table; required)
 *   final          the run is over; otherwise the last letter is still open
 *
 * Returns { letters, pendingIds, complete, nextCheckAt, scrubs }. While live,
 * the segmentation of earlier marks can change as later evidence arrives. A
 * garbled character or prosign at the end is decided at once, not left open.
 */
export function segmentLetters(
  steps,
  marks,
  { errorGapUnits, targetLength = 0, final = false, silenceMs = null, unitMs, lastEnd = null, holding = false },
) {
  requireErrorGapUnits(errorGapUnits)
  const sequence = []
  const forced = []
  let boundaryPending = false
  for (const step of steps) {
    if (step.type === 'boundary') boundaryPending = true
    if (step.type !== 'mark') continue
    const mark = marks[step.id]
    forced.push(sequence.length > 0 && (boundaryPending || mark.pauseBefore))
    sequence.push(mark)
    boundaryPending = false
  }

  const ratios = sequence.map(mark => (mark.gapBeforeMs > 0 ? Math.log(mark.gapBeforeMs / mark.gapUnitMs) : 0))
  const segments = segmentSymbols(
    sequence.map(mark => mark.symbol),
    ratios,
    forced,
    { centers: gapCenters(ratios, forced) },
  )

  const letters = []
  const scrubs = []
  for (const { start, end, kind } of segments) {
    const run = sequence.slice(start, end)
    const markIds = run.map(mark => mark.id)
    if (kind === 'prosign') {
      scrubs.push({ markIds, letter: letters.pop() ?? null })
      continue
    }
    const code = run.map(mark => mark.symbol).join('')
    letters.push({ code, char: fromMorse(code) ?? UNKNOWN_CHAR, markIds, kind: 'timed' })
  }

  // While live, the last letter isn't finished until the silence says so, unless it can't grow into one.
  let pendingIds = []
  let complete = false
  let nextCheckAt = null
  const lastKind = segments.at(-1)?.kind
  if (!final && segments.length > 0) {
    const limit = errorGapMs(unitMs, errorGapUnits)
    const silent = silenceMs !== null && !holding && silenceMs >= limit
    const decided = lastKind === 'garbled' || lastKind === 'prosign'
    if (!silent && !decided) pendingIds = letters.pop().markIds
    complete = (silent || decided) && letters.length >= targetLength && targetLength > 0
    if (!silent && !decided && silenceMs !== null && !holding && lastEnd !== null) nextCheckAt = lastEnd + limit
  }

  return { letters, pendingIds, complete, nextCheckAt, scrubs, undos: [] }
}

/**
 * Cluster gap log-ratios into "inside a letter" and "boundary" (k-means, k = 2,
 * seeded at 1 and 3 units). Falls back to exactly 1 and 3 units when the gaps
 * don't form two clusters.
 */
export function gapCenters(ratios, forced = []) {
  const free = ratios.filter((_, i) => i > 0 && !forced[i])
  const clusters = twoMeans(free, DEFAULT_CENTERS)
  return clusters ? [clusters.low, clusters.high] : DEFAULT_CENTERS
}

/**
 * Viterbi: the cheapest split of `symbols` into segments.
 *
 *   ratios[k]  log(gap before symbol k ÷ unit)
 *   forced[k]  a boundary must fall before symbol k
 *
 * dp[j] is the cheapest segmentation of symbols[0..j). A segment symbols[i..j) costs
 *   (ratio[i] − boundary center)²        for the gap that starts it
 * + Σ (ratio[k] − inside center)²        for the gaps within it
 * + its kind's cost (see the top of this file).
 *
 * Returns [{ start, end, kind: 'letter' | 'garbled' | 'prosign' | 'unfinished' }].
 */
export function segmentSymbols(symbols, ratios, forced = [], { centers = DEFAULT_CENTERS, isValid = code => fromMorse(code) !== undefined } = {}) {
  const count = symbols.length
  if (count === 0) return []
  const [inside, boundary] = centers

  // insideCost[k] = Σ inside costs of gaps 1..k-1; forcedCount likewise.
  const insideCost = new Float64Array(count + 1)
  const forcedCount = new Int32Array(count + 1)
  for (let k = 1; k < count; k++) {
    insideCost[k + 1] = insideCost[k] + (forced[k] ? 0 : (ratios[k] - inside) ** 2)
    forcedCount[k + 1] = forcedCount[k] + (forced[k] ? 1 : 0)
  }
  const boundaryCost = k => (forced[k] ? 0 : (ratios[k] - boundary) ** 2)

  const best = new Float64Array(count + 1).fill(Infinity)
  const from = new Int32Array(count + 1)
  const kinds = new Array(count + 1)
  best[0] = 0
  for (let end = 1; end <= count; end++) {
    let code = ''
    for (let start = end - 1; start >= Math.max(0, end - LONGEST_RUN); start--) {
      code = symbols[start] + code
      if (forcedCount[end] - forcedCount[start + 1] > 0) break
      const kind = segmentKind(code, isValid)
      const cost =
        best[start] + (start > 0 ? boundaryCost(start) : 0) + (insideCost[end] - insideCost[start + 1]) + KIND_COST[kind]
      if (cost < best[end]) {
        best[end] = cost
        from[end] = start
        kinds[end] = kind
      }
    }
  }

  const segments = []
  for (let end = count; end > 0; end = from[end]) segments.push({ start: from[end], end, kind: kinds[end] })
  return segments.reverse()
}

const KIND_COST = { letter: 0, prosign: 0, garbled: GARBLED_COST, unfinished: UNFINISHED_COST }

// What a run of symbols would be as one segment.
function segmentKind(code, isValid) {
  if (startsWithProsign(code)) return 'prosign'
  if (code.length <= LONGEST_LETTER && isValid(code)) return 'letter'
  return isCodePrefix(code) ? 'unfinished' : 'garbled'
}
