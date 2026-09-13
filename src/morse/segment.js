// Unanchored segmentation: letters from timing alone, decided over the whole run.
//
// Every gap between marks is either inside a letter or a boundary. Rather
// than thresholding each gap on its own, choose the segmentation of the whole
// mark sequence into valid Morse codes that best fits the gaps (Viterbi), with
// costs in log space because timing error is multiplicative.

import { fromMorse } from './alphabet.js'
import { UNKNOWN_CHAR } from './decode.js'
import { twoMeans } from './rhythm.js'
import { CONFIG, errorGapMs } from './timing.js'

const MAX_CODE_LENGTH = 6
const INVALID_SEGMENT_COST = 40
const DEFAULT_CENTERS = [0, Math.log(3)] // a gap inside a letter is 1 unit, a boundary 3

/**
 * Segment a run's marks into letters from timing.
 *
 *   steps      the run in order ({ type: 'mark' | 'boundary' | 'undo' }); an explicit
 *              boundary forces one, undo has no meaning here and is ignored
 *   marks      by id: { id, symbol, gapBeforeMs, gapUnitMs, pauseBefore }
 *   final      the run is over; otherwise the last letter is still open
 *
 * Returns { letters, pendingIds, complete, nextCheckAt }. While live, the
 * segmentation of earlier marks can change as later evidence arrives.
 */
export function segmentLetters(
  steps,
  marks,
  { targetLength = 0, final = false, silenceMs = null, unitMs, lastEnd = null, holding = false, config = CONFIG },
) {
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

  const letters = segments.map(({ start, end }) => {
    const code = sequence
      .slice(start, end)
      .map(mark => mark.symbol)
      .join('')
    return { code, char: fromMorse(code) ?? UNKNOWN_CHAR, markIds: sequence.slice(start, end).map(mark => mark.id), kind: 'timed' }
  })

  // While live, the last letter isn't finished until the silence says so.
  let pendingIds = []
  let complete = false
  let nextCheckAt = null
  if (!final && letters.length > 0) {
    const limit = errorGapMs(unitMs, config)
    const settled = silenceMs !== null && !holding && silenceMs >= limit
    if (!settled) pendingIds = letters.pop().markIds
    complete = settled && letters.length >= targetLength && targetLength > 0
    if (!settled && silenceMs !== null && !holding && lastEnd !== null) nextCheckAt = lastEnd + limit
  }

  return { letters, pendingIds, complete, nextCheckAt }
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
 * Viterbi: the cheapest split of `symbols` into letters.
 *
 *   ratios[k]  log(gap before symbol k ÷ unit)
 *   forced[k]  a boundary must fall before symbol k
 *
 * dp[j] is the cheapest segmentation of symbols[0..j). A letter symbols[i..j)
 * is at most 6 long and costs
 *   (ratio[i] − boundary center)²        for the gap that starts it
 * + Σ (ratio[k] − inside center)²        for the gaps within it
 * + a large penalty if it isn't a real code (it then decodes as #), so a run
 *   with no valid segmentation still grades instead of throwing.
 *
 * Returns [{ start, end }].
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
  best[0] = 0
  for (let end = 1; end <= count; end++) {
    for (let start = Math.max(0, end - MAX_CODE_LENGTH); start < end; start++) {
      if (forcedCount[end] - forcedCount[start + 1] > 0) continue
      const code = symbols.slice(start, end).join('')
      const cost =
        best[start] +
        (start > 0 ? boundaryCost(start) : 0) +
        (insideCost[end] - insideCost[start + 1]) +
        (isValid(code) ? 0 : INVALID_SEGMENT_COST)
      if (cost < best[end]) {
        best[end] = cost
        from[end] = start
      }
    }
  }

  const segments = []
  for (let end = count; end > 0; end = from[end]) segments.push({ start: from[end], end })
  return segments.reverse()
}
