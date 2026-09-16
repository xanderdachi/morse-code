import { describe, expect, it } from 'vitest'
import { DASH, DOT } from './symbols.js'
import { CONFIG, UnitEstimator, chooseStartingUnit, errorGapMs, estimateUnit, pauseGapMs } from './timing.js'

describe('CONFIG', () => {
  it('holds the specified defaults', () => {
    expect(CONFIG).toMatchObject({
      defaultUnitMs: 120,
      alpha: 0.15,
      minUnitMs: 20,
      maxUnitMs: 400,
      dashAtUnits: 2,
      intraGapBelowUnits: 2,
      pauseUnits: 10,
      pauseMinMs: 2000,
      minPressMs: 20,
      bounceFloorMs: 8,
      bounceUnits: 0.4,
      maxPressUnits: 10,
    })
  })

  it('has no word-boundary threshold', () => {
    expect(Object.keys(CONFIG).some(key => /word/i.test(key))).toBe(false)
  })
})

describe('thresholds', () => {
  it('closes an error-path letter after the leniency table\'s number of units, and has no default', () => {
    expect(errorGapMs(40, 2)).toBe(80)
    expect(errorGapMs(125, 2)).toBe(250)
    expect(() => errorGapMs(125)).toThrow(TypeError)
    expect('errorGapUnits' in CONFIG).toBe(false)
  })

  it('calls a silence a pause beyond max(10u, 2000ms)', () => {
    expect(pauseGapMs(50)).toBe(2000)
    expect(pauseGapMs(200)).toBe(2000)
    expect(pauseGapMs(350)).toBe(3500)
  })
})

describe('UnitEstimator', () => {
  const estimator = new UnitEstimator(100)

  it('reads a press under 2u as a dot and 2u or more as a dash', () => {
    expect(estimator.classifyPress(199.9)).toBe(DOT)
    expect(estimator.classifyPress(200)).toBe(DASH)
  })

  it('gives a gap only two meanings: inside a letter, or not', () => {
    expect(estimator.isIntraGap(199.9)).toBe(true)
    expect(estimator.isIntraGap(200)).toBe(false)
    expect(estimator.thresholds()).toEqual({ dash: 200, intraGap: 200, pause: 2000, maxPress: 1000 })
  })

  it('learns from dots, and dashes divided by 3', () => {
    const e = new UnitEstimator(100)
    e.learnPress(80, DOT)
    expect(e.unit).toBeCloseTo(97, 10)
    e.reset()
    e.learnPress(240, DASH)
    expect(e.unit).toBeCloseTo(97, 10)
  })

  it('learns only from gaps inside a letter, never from boundaries or pauses', () => {
    const e = new UnitEstimator(100)
    e.learnGap(120)
    expect(e.unit).toBeCloseTo(103, 10)
    const before = e.unit
    e.learnGap(310) // a letter gap: its length in units is unknown
    e.learnGap(700) // a word gap
    e.learnGap(30_000) // a pause
    expect(e.unit).toBe(before)
  })

  it('clamps u to [20, 400], including the seed', () => {
    const fast = new UnitEstimator(100)
    for (let i = 0; i < 100; i++) fast.learnPress(1, DOT)
    expect(fast.unit).toBe(20)
    expect(new UnitEstimator(5000).unit).toBe(400)
    expect(new UnitEstimator(Number.NaN).unit).toBe(120)
  })

  it('resets to its calibration, or to a new one', () => {
    const e = new UnitEstimator(90)
    e.learnPress(300, DOT)
    e.reset()
    expect(e.unit).toBe(90)
    e.reset(150)
    e.learnPress(30, DOT)
    e.reset()
    expect(e.unit).toBe(150)
  })
})

describe('lock-in', () => {
  it('estimates u as the median of the 1-unit cluster', () => {
    expect(estimateUnit([48, 52, 150, 147, 51, 49, 50])).toBe(50)
  })

  it('needs a clear jump between clusters', () => {
    expect(estimateUnit([])).toBeNull()
    expect(estimateUnit([100, 110, 95, 105])).toBeNull()
  })

  it('keeps the seed when it agrees with the estimate, and replaces it when it does not', () => {
    const early = [48, 50, 52, 150, 152, 49]
    expect(chooseStartingUnit(55, early)).toBe(55)
    expect(chooseStartingUnit(120, early)).toBe(49.5)
    expect(chooseStartingUnit(120, [100, 100])).toBe(120)
  })
})
