import { describe, expect, it } from 'vitest'
import { CALIBRATION_TEXT, calibrate } from './calibration.js'
import { synthesizeKeying, synthesizeTapping } from './testing/syntheticKeyer.js'
import { unitMsForWpm } from './units.js'
import { leniencyFor } from '../lib/progress.js'

// The error path's letter gap, from the leniency table as the app uses it.
const { errorGapUnits } = leniencyFor(1)

describe('calibrate', () => {
  it('measures the dot length of a perfect PARIS at any speed', () => {
    expect(CALIBRATION_TEXT).toBe('PARIS')
    for (const wpm of [5, 10, 18, 25, 30]) {
      const result = calibrate(synthesizeKeying('PARIS', { wpm }), { errorGapUnits })
      expect(result.ok).toBe(true)
      expect(result.unitMs).toBeCloseTo(unitMsForWpm(wpm), 6)
    }
  })

  it('stays close with ±15% noise', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = calibrate(synthesizeKeying('PARIS', { wpm: 16, jitter: 0.15, seed }), { errorGapUnits })
      expect(result.ok, `seed ${seed}`).toBe(true)
      expect(result.unitMs / unitMsForWpm(16)).toBeGreaterThan(0.9)
      expect(result.unitMs / unitMsForWpm(16)).toBeLessThan(1.1)
    }
  })

  it('is not thrown by long hesitations between letters', () => {
    const log = synthesizeKeying('PARIS', {
      wpm: 20,
      pauses: [
        { letter: 2, mark: 0, ms: 1500 },
        { letter: 4, mark: 0, ms: 4000 },
      ],
    })
    expect(calibrate(log, { errorGapUnits }).unitMs).toBeCloseTo(60, 0)
  })

  it('clamps to the estimator range', () => {
    expect(calibrate(synthesizeKeying('PARIS', { wpm: 33 }), { errorGapUnits })).toMatchObject({ ok: true, unitMs: 40 })
    expect(calibrate(synthesizeKeying('PARIS', { wpm: 2.5 }), { errorGapUnits })).toMatchObject({ ok: true, unitMs: 400 })
  })

  it('refuses anything that is not PARIS, reporting what it heard', () => {
    expect(calibrate(synthesizeKeying('PARTS', { wpm: 15 }), { errorGapUnits })).toEqual({ ok: false, heard: 'PARTS' })
    expect(calibrate([], { errorGapUnits })).toEqual({ ok: false, heard: '' })
  })

  it('refuses a PARIS tapped on the pad, which has no timing to measure', () => {
    expect(calibrate(synthesizeTapping('PARIS'), { errorGapUnits })).toEqual({ ok: false, heard: 'PARIS' })
  })
})
