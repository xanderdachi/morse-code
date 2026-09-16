// Rhythm: which straight-key presses are dots and which are dashes, and the
// operator's unit at each point in the run.
//
// The live estimator alone (timing.js) reads each press against a running u.
// That is fine for clean keying, but with heavy timing noise a short dash
// (0.6 × 3u = 1.8u) sits right next to a long dot (1.4 × 1u), and a speed
// ramp makes one global threshold useless: a dot at 8 WPM outlasts a dash at 30.
// So after the live pass, every press is normalized by the local unit around
// it, and the normalized durations are split into two clusters.

import { DASH, DOT } from './symbols.js'
import { CONFIG, UnitEstimator, chooseStartingUnit, estimateUnit, median } from './timing.js'

const LOG_3 = Math.log(3)
const MIN_PRESSES_TO_REFINE = 8

/**
 * Classify presses and estimate the unit at each element.
 *
 * elements: [{ durationMs, gapBeforeMs, fixedSymbol?, rhythmBreak? }]
 *   fixedSymbol  a pad tap: its symbol is given and its length means nothing
 *   rhythmBreak  an explicit boundary came before it, so the gap isn't rhythm
 *
 * 1. Live pass: the adaptive estimator (lock-in seeded) classifies and learns.
 * 2. Refine: each keyed press's local unit is the median implied unit
 *    (duration, or duration / 3 for a dash) of the presses around it: centered
 *    when the whole run is known (lookahead), trailing while it's live. The
 *    presses' log(duration / local unit) values go through 1-D k-means (k = 2,
 *    seeded at 1 unit and 3 units) and are split in the middle of the gap
 *    between the two clusters. Repeated until stable. If a cluster is empty
 *    (a run of only dots, say), the live pass's reading stands.
 *
 * Returns { symbols, units, suspect, startUnitMs } with one entry per element;
 * suspect lists presses over maxPressUnits, which count as dashes.
 */
export function analyzeRhythm(elements, { seedUnitMs = CONFIG.defaultUnitMs, lookahead = true, config = CONFIG } = {}) {
  const count = elements.length
  const symbols = new Array(count)
  const units = new Array(count)
  const suspect = new Set()

  const seed = new UnitEstimator(seedUnitMs, config).unit
  const estimator = new UnitEstimator(chooseStartingUnit(seed, earlyDurations(elements, config), config), config)
  const startUnitMs = estimator.unit

  for (let i = 0; i < count; i++) {
    const element = elements[i]
    if (element.gapBeforeMs !== null && element.gapBeforeMs > 0 && !element.rhythmBreak) estimator.learnGap(element.gapBeforeMs)
    units[i] = estimator.unit
    if (element.fixedSymbol) {
      symbols[i] = element.fixedSymbol
    } else if (element.durationMs > estimator.thresholds().maxPress) {
      symbols[i] = DASH
      suspect.add(i)
    } else {
      symbols[i] = estimator.classifyPress(element.durationMs)
      estimator.learnPress(element.durationMs, symbols[i])
    }
  }

  const keyed = []
  for (let i = 0; i < count; i++) if (!elements[i].fixedSymbol && !suspect.has(i)) keyed.push(i)

  if (keyed.length >= MIN_PRESSES_TO_REFINE) {
    const { narrow, wide, switchRatio } = config.rhythmWindows
    const medians = (values, half) =>
      lookahead ? slidingMedians(values, half, half, { fullSize: true }) : slidingMedians(values, 2 * half, 0)
    let reseeded = false
    for (let round = 0; round < 6; round++) {
      const implied = keyed.map(i => elements[i].durationMs / (symbols[i] === DASH ? 3 : 1))
      // A wide window averages out timing noise; where the narrow one disagrees
      // by more than noise explains, the speed really changed, so follow it.
      const wideUnits = medians(implied, wide)
      const narrowUnits = medians(implied, narrow)
      const local = wideUnits.map((w, k) => (Math.abs(Math.log(narrowUnits[k] / w)) > Math.log(switchRatio) ? narrowUnits[k] : w))
      const logs = keyed.map((i, k) => Math.log(elements[i].durationMs / local[k]))
      const clusters = twoMeans(logs, [0, LOG_3])
      if (!clusters) {
        // One cluster after normalizing can mean the live pass read every dash
        // as a dot (or the reverse). If the raw durations clearly form two
        // clusters, start again from those; if not, it really is all one symbol.
        const rawLogs = keyed.map(i => Math.log(elements[i].durationMs))
        const raw = reseeded ? null : twoMeans(rawLogs, [Math.min(...rawLogs), Math.max(...rawLogs)])
        if (!raw || raw.high - raw.low < Math.log(2)) break
        reseeded = true
        for (const i of keyed) symbols[i] = Math.log(elements[i].durationMs) < raw.split ? DOT : DASH
        continue
      }

      let changed = false
      keyed.forEach((i, k) => {
        const symbol = logs[k] < clusters.split ? DOT : DASH
        if (symbol !== symbols[i]) changed = true
        symbols[i] = symbol
        // Classification uses the raw local unit; thresholds use the clamped one (CONFIG.minUnitMs is 60 WPM).
        units[i] = Math.min(config.maxUnitMs, Math.max(config.minUnitMs, local[k]))
      })
      if (!changed) break
    }
  }

  return { symbols, units, suspect: [...suspect], startUnitMs }
}

/**
 * 1-D k-means with k = 2 from the given seeds.
 * Returns { low, high, split, gap }: the two cluster means, a split point
 * placed by Otsu's method in the middle of a gap between neighbouring values,
 * and that gap's width. Null when the data isn't two clusters (one side empty,
 * or the means closer than 1.5x in log space).
 */
export function twoMeans(values, [seedLow, seedHigh], { minSeparation = Math.log(1.5), iterations = 30 } = {}) {
  let low = seedLow
  let high = seedHigh

  for (let iteration = 0; iteration < iterations; iteration++) {
    const mid = (low + high) / 2
    let sumLow = 0
    let countLow = 0
    let sumHigh = 0
    let countHigh = 0
    for (const value of values) {
      if (value < mid) {
        sumLow += value
        countLow++
      } else {
        sumHigh += value
        countHigh++
      }
    }
    if (countLow === 0 || countHigh === 0) return null
    const nextLow = sumLow / countLow
    const nextHigh = sumHigh / countHigh
    if (nextLow === low && nextHigh === high) break
    low = nextLow
    high = nextHigh
  }

  if (high - low < minSeparation) return null

  // Place the split with Otsu's method: between the neighbouring values where
  // splitting maximizes the between-cluster variance, at the middle of that
  // gap. The midpoint of the means drifts toward the smaller cluster when the
  // clusters differ in size (a passage with more dashes than dots) and can file
  // the shortest dash with the dots; the widest single gap can be fooled by a
  // sparse stretch inside a small cluster. Otsu is fooled by neither.
  const sorted = [...values].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  let best = -1
  let split = (low + high) / 2
  let gap = 0
  let sumLeft = 0
  for (let i = 0; i + 1 < sorted.length; i++) {
    sumLeft += sorted[i]
    const left = i + 1
    const right = sorted.length - left
    const between = left * right * (sumLeft / left - (total - sumLeft) / right) ** 2
    if (between > best) {
      best = between
      split = (sorted[i] + sorted[i + 1]) / 2
      gap = sorted[i + 1] - sorted[i]
    }
  }
  return { low, high, split, gap }
}

/**
 * Median of values[k - before .. k + after] for every k, in O(n · window).
 * With fullSize, windows at the ends shift inward instead of shrinking, so
 * every estimate uses as many samples as the middle ones.
 */
export function slidingMedians(values, before, after, { fullSize = false } = {}) {
  const count = values.length
  const out = new Array(count)
  const sorted = []
  const size = Math.min(count, before + after + 1)
  let lo = 0
  let hi = -1

  const position = value => {
    let a = 0
    let b = sorted.length
    while (a < b) {
      const m = (a + b) >> 1
      if (sorted[m] < value) a = m + 1
      else b = m
    }
    return a
  }

  for (let k = 0; k < count; k++) {
    let wantLo = Math.max(0, k - before)
    let wantHi = Math.min(count - 1, k + after)
    if (fullSize) {
      wantHi = Math.min(count - 1, wantLo + size - 1)
      wantLo = Math.max(0, wantHi - size + 1)
    }
    while (hi < wantHi) {
      hi++
      sorted.splice(position(values[hi]), 0, values[hi])
    }
    while (lo < wantLo) {
      sorted.splice(position(values[lo]), 1)
      lo++
    }
    out[k] = median(sorted)
  }
  return out
}

// Raw durations of the run's first elements, for lock-in. Gaps are the
// noisiest timing there is (hesitations, pauses, word gaps), so key presses
// alone are used once they show both dots and dashes. Until then (a passage
// opening "TO", all dashes) the gaps inside those letters are the only 1-unit
// reference: only gaps under 1.5x the shortest press qualify, which keeps out
// word gaps and hesitations. A pad-only run has only gaps.
function earlyDurations(elements, config) {
  const early = elements.slice(0, config.lockInElements)
  const presses = early.filter(element => !element.fixedSymbol).map(element => element.durationMs)
  if (presses.length > 0 && estimateUnit(presses, config) !== null) return presses
  const shortestPress = presses.length > 0 ? Math.min(...presses) : Infinity
  const gaps = early
    .filter(element => element.gapBeforeMs > 0 && !element.rhythmBreak && element.gapBeforeMs < 1.5 * shortestPress)
    .map(element => element.gapBeforeMs)
  return [...presses, ...gaps]
}
