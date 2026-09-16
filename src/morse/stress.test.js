// Beginner input, played live, with nothing keyed after it ends: the engine must
// degrade gracefully. Every case checks the same invariants; a summary table of
// what each run did is printed at the end.

import { afterAll, describe, expect, it } from 'vitest'
import { defaultProgress, leniencyFor } from '../lib/progress.js'
import { scoreRun } from '../lib/results.js'
import { playLive } from './testing/liveRun.js'
import { STRESS_TEXT, STRESS_WPMS, beginnerLog } from './testing/stressCases.js'
import { BEGINNER_SCENARIOS } from './testing/syntheticKeyer.js'
import { CONFIG } from './timing.js'

// The error prosign sets the bound: seven dots are still on the way to its eight, so a buffer
// can hold eight symbols. No letter is longer than seven ($).
const MAX_BUFFER = 8

// The longest a silence can go on before the run ends: a pause at the widest unit, then the mid-passage limit.
const FINALIZE_BOUND_MS = CONFIG.pauseMinMs + CONFIG.maxUnitMs * CONFIG.pauseUnits + CONFIG.finishPauseMidMs

const summary = []

// Each case plays a whole run live, waking at every deadline: a few seconds apiece under a parallel run.
describe('stress: beginner input degrades gracefully', { timeout: 30_000 }, () => {
  for (const wpm of STRESS_WPMS) {
    for (const scenario of BEGINNER_SCENARIOS) {
      for (const anchored of [true, false]) {
        const name = `${scenario} at ${wpm} WPM, ${anchored ? 'anchored' : 'unanchored'}`
        it(name, () => {
          const tier = anchored ? 1 : 5
          const { errorGapUnits } = leniencyFor(tier)
          const log = beginnerLog(scenario, wpm)
          const live = playLive(log, { target: STRESS_TEXT, anchored, errorGapUnits, unitMs: CONFIG.defaultUnitMs })
          const { run, observations } = live

          // It finalizes on silence alone.
          expect.soft(live.finalized, 'finalized with no further input').toBe(true)
          if (!run) return
          expect.soft(['settle', 'pause']).toContain(run.finishReason)
          expect.soft(live.finalizedAt - live.lastReleaseAt, 'silence from the last accepted release to the end').toBeLessThanOrEqual(FINALIZE_BOUND_MS)
          // Never while the operator is still keying: nothing they sent is thrown away.
          expect.soft(observations.inputAfterFinalize, 'presses discarded because the run had already ended').toBe(0)

          // Grading completes, with no NaN, and accuracy in range.
          const progress = { ...defaultProgress(), tier, anchoredInput: anchored }
          let result = null
          expect.soft(() => {
            result = scoreRun({ run, target: STRESS_TEXT, progress, mode: 'key' })
          }).not.toThrow()
          if (result) {
            for (const [key, value] of Object.entries({
              accuracy: result.accuracy,
              wpm: result.wpm,
              effectiveWpm: result.effectiveWpm,
              elapsedMs: result.elapsedMs,
              pausedMs: result.pausedMs,
              unitsSent: result.unitsSent,
              ...result.counts,
            })) {
              expect.soft(Number.isFinite(value), `${key} is a number (${value})`).toBe(true)
            }
            expect.soft(result.accuracy).toBeGreaterThanOrEqual(0)
            expect.soft(result.accuracy).toBeLessThanOrEqual(100)
          }

          // SENT never shows more letters than the passage has.
          expect.soft(observations.maxLettersSent, 'SENT numerator').toBeLessThanOrEqual(observations.targetLetters)
          expect.soft(run.lettersSent).toBeLessThanOrEqual(observations.targetLetters)

          // The letter being decided never holds more symbols than the prosign has.
          expect.soft(observations.maxPending, 'largest buffer').toBeLessThanOrEqual(MAX_BUFFER)

          // Sending time: never negative, never counting paused time or the settle silence.
          expect.soft(observations.negativeElapsed, 'live states with negative elapsed time').toBe(0)
          expect.soft(run.elapsedMs).toBeGreaterThanOrEqual(0)
          expect.soft(run.elapsedMs).toBe(run.endedAt - run.startedAt - run.pausedMs)
          expect.soft(run.endedAt, 'the clock stops at the last release, not at the end of the silence').toBeLessThanOrEqual(live.lastReleaseAt)
          // Independently of the engine's pause threshold: silence beyond the widest possible
          // threshold (10 × the largest unit) can never be sending time.
          const widest = CONFIG.pauseUnits * CONFIG.maxUnitMs
          const firstPress = log.find(event => event.type === 'down').t
          let silenceBeyond = 0
          let lastUp = null
          for (const event of log) {
            if (event.t > live.lastReleaseAt) break // discarded after the run ended
            if (event.type === 'down' && lastUp !== null) silenceBeyond += Math.max(0, event.t - lastUp - widest)
            if (event.type === 'up') lastUp = event.t
          }
          expect.soft(run.elapsedMs).toBeLessThanOrEqual(live.lastReleaseAt - firstPress - silenceBeyond + 1e-6)
          expect.soft(observations.pastDeadlines, 'deadlines that fired without resolving').toBe(0)

          summary.push({
            case: name,
            reason: run.finishReason,
            endsAfterS: +((live.finalizedAt - live.lastReleaseAt) / 1000).toFixed(1),
            ignoredInputs: observations.inputAfterFinalize,
            accuracy: result ? Math.round(result.accuracy) : null,
            sent: `${run.lettersSent}/${observations.targetLetters}`,
            letters: run.letters.length,
            maxBuffer: observations.maxPending,
            scrubbed: run.scrubbedLetters,
            elapsedS: +(run.elapsedMs / 1000).toFixed(1),
            pausedS: +(run.pausedMs / 1000).toFixed(1),
          })
        })
      }
    }
  }
})

afterAll(() => {
  if (summary.length) console.table(summary)
})
