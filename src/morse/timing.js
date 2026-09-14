// Adaptive timing: an estimate `u` of the operator's dot length.
//
// Standard Morse is 1 unit for a dot and the gap inside a letter, 3 for a dash.
// Letter boundaries are not decided by timing on the happy path any more (see
// anchor.js); a gap only ever means "inside the letter" or "boundary", and the
// boundary reading is used only where no target anchors the letter.

import { DASH, DOT } from './symbols.js'

/** Every timing constant in one place. Tune here. */
export const CONFIG = {
  defaultUnitMs: 120, // starting dot length when the operator hasn't calibrated (10 WPM)
  minUnitMs: 40,
  maxUnitMs: 400,
  alpha: 0.15, // EMA weight of each new observation

  dashAtUnits: 2, // live estimator: a press this long or longer is a dash
  intraGapBelowUnits: 2, // a gap shorter than this is inside a letter (and teaches u)

  // The error path's letter boundary is a leniency rule, not a timing constant:
  // callers pass errorGapUnits from the tier's leniency table (src/lib/progress.js).

  // A silence longer than max(10u, 2000ms) is a pause: the clock stops beyond it.
  pauseUnits: 10,
  pauseMinMs: 2000,

  // Finalizing a run. Once every letter has been sent, max(4u, 800ms) of silence
  // ends it. Otherwise a pause that has lasted this long ends it: 10s while at
  // or past the last letter, 60s mid-passage (so thinking stays free).
  settleUnits: 4,
  settleMinMs: 800,
  finishPauseAtEndMs: 10_000,
  finishPauseMidMs: 60_000,

  prosignAckMs: 2500, // how long the error prosign's acknowledgement stays up

  minPressMs: 20, // shorter presses are contact bounce and are ignored
  maxPressUnits: 10, // longer presses count as dashes but are flagged and not learned from

  // Lock-in: estimate u from the first elements of a run (see estimateUnit) and
  // use it instead of the seed when the seed would misread them.
  lockInElements: 24,
  lockInBreakRatio: 1.8,
  seedAgreement: [0.85, 1.15],

  // Rhythm (rhythm.js): presses on each side of a press whose implied units give its
  // local unit. The narrow window is used where it disagrees with the wide one by
  // more than switchRatio, i.e. where the operator's speed really changed.
  rhythmWindows: { narrow: 12, wide: 64, switchRatio: 1.4 },
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/**
 * The error path's letter boundary: a gap at least `errorGapUnits` units long
 * ends a letter that has diverged from the passage (or, unanchored, any letter).
 * The units come from the tier's leniency table; there is deliberately no default.
 */
export function errorGapMs(unitMs, errorGapUnits) {
  return requireErrorGapUnits(errorGapUnits) * unitMs
}

/** Returns `errorGapUnits`, or throws if a caller forgot to pass the leniency table's value. */
export function requireErrorGapUnits(errorGapUnits) {
  if (!(Number.isFinite(errorGapUnits) && errorGapUnits > 0)) {
    throw new TypeError(`errorGapUnits must come from the leniency table, got ${errorGapUnits}`)
  }
  return errorGapUnits
}

/** How long a silence must last to count as a pause: max(10u, 2000ms). */
export function pauseGapMs(unitMs, config = CONFIG) {
  return Math.max(config.pauseUnits * unitMs, config.pauseMinMs)
}

/** Silence after the last letter that ends a run: max(4u, 800ms). */
export function settleGapMs(unitMs, config = CONFIG) {
  return Math.max(config.settleUnits * unitMs, config.settleMinMs)
}

/**
 * Running estimate of the operator's dot length, u.
 * classify* never change u; learn* apply one EMA step. reset() returns to the
 * calibration value so a new run doesn't inherit the last run's drift.
 */
export class UnitEstimator {
  #config
  #baseUnit
  #unit

  constructor(unitMs = CONFIG.defaultUnitMs, config = CONFIG) {
    this.#config = config
    this.#baseUnit = this.#clampUnit(unitMs)
    this.#unit = this.#baseUnit
  }

  /** Current dot length estimate, ms. */
  get unit() {
    return this.#unit
  }

  /** Back to the calibration value, or to a new one. */
  reset(unitMs = this.#baseUnit) {
    this.#baseUnit = this.#clampUnit(unitMs)
    this.#unit = this.#baseUnit
  }

  thresholds() {
    const u = this.#unit
    const c = this.#config
    return {
      dash: c.dashAtUnits * u,
      intraGap: c.intraGapBelowUnits * u,
      pause: pauseGapMs(u, c),
      maxPress: c.maxPressUnits * u,
    }
  }

  classifyPress(durationMs) {
    return durationMs < this.thresholds().dash ? DOT : DASH
  }

  /** True for a gap short enough to be inside a letter. */
  isIntraGap(durationMs) {
    return durationMs < this.thresholds().intraGap
  }

  learnPress(durationMs, symbol) {
    this.#learn(symbol === DASH ? durationMs / 3 : durationMs)
  }

  /**
   * Learn from a gap only when it is inside a letter (exactly 1 unit). A
   * boundary could be 3 units, 7, or a pause, so it says nothing reliable about u.
   */
  learnGap(durationMs) {
    if (this.isIntraGap(durationMs)) this.#learn(durationMs)
  }

  #learn(sampleUnitMs) {
    const { alpha } = this.#config
    this.#unit = this.#clampUnit(this.#unit * (1 - alpha) + sampleUnitMs * alpha)
  }

  #clampUnit(unitMs) {
    const value = Number.isFinite(unitMs) ? unitMs : CONFIG.defaultUnitMs
    return clamp(value, this.#config.minUnitMs, this.#config.maxUnitMs)
  }
}

/**
 * Estimate u from a handful of raw element durations (presses and gaps),
 * without knowing which is which.
 *
 * Dots and intra-letter gaps are 1 unit; everything else is 3 or more. Sorted,
 * the durations fall into clusters with a clear jump (about 3x) after the
 * 1-unit cluster. Returns the median of that lowest cluster, or null when
 * there's no clear jump yet (too few elements, or all of them alike).
 */
export function estimateUnit(durations, config = CONFIG) {
  const sorted = durations.filter(d => Number.isFinite(d) && d > 0).sort((a, b) => a - b)
  // The lowest cluster needs at least two members, so one stray short element can't define it.
  for (let i = 1; i < sorted.length - 1; i++) {
    if (sorted[i + 1] / sorted[i] >= config.lockInBreakRatio) return median(sorted.slice(0, i + 1))
  }
  return null
}

/** The starting u for a run: the seed, unless early evidence says it would misread. */
export function chooseStartingUnit(seedUnitMs, earlyDurations, config = CONFIG) {
  const estimate = estimateUnit(earlyDurations, config)
  if (estimate === null) return seedUnitMs
  const [low, high] = config.seedAgreement
  const ratio = seedUnitMs / estimate
  return ratio >= low && ratio <= high ? seedUnitMs : estimate
}

export function median(sortedValues) {
  const mid = sortedValues.length >> 1
  return sortedValues.length % 2 ? sortedValues[mid] : (sortedValues[mid - 1] + sortedValues[mid]) / 2
}
