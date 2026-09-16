// @vitest-environment jsdom
// The character review renders for every beginner stress case's result.
import { cleanup, render, screen } from '@testing-library/react'
import { MotionGlobalConfig } from 'framer-motion'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultProgress, leniencyFor } from '../lib/progress.js'
import { scoreRun } from '../lib/results.js'
import { STRESS_TEXT, STRESS_WPMS, beginnerLog } from '../morse/testing/stressCases.js'
import { playLive } from '../morse/testing/liveRun.js'
import { BEGINNER_SCENARIOS } from '../morse/testing/syntheticKeyer.js'
import { CONFIG } from '../morse/timing.js'
import ResultsModal from './ResultsModal.jsx'

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true
})

afterEach(cleanup)

const passage = { id: 'tsar', title: 'Russian folk tale', author: 'Oral tradition', culture: 'Russia', era: null, blurb: null, text: STRESS_TEXT }

// Each case plays a whole run live first: a few seconds apiece in jsdom under a parallel run.
describe('stress: the character review renders for every result', { timeout: 30_000 }, () => {
  for (const wpm of STRESS_WPMS) {
    for (const scenario of BEGINNER_SCENARIOS) {
      for (const anchored of [true, false]) {
        it(`${scenario} at ${wpm} WPM, ${anchored ? 'anchored' : 'unanchored'}`, () => {
          const tier = anchored ? 1 : 5
          const { run } = playLive(beginnerLog(scenario, wpm), {
            target: STRESS_TEXT,
            anchored,
            errorGapUnits: leniencyFor(tier).errorGapUnits,
            unitMs: CONFIG.defaultUnitMs,
          })
          const result = {
            ...scoreRun({ run, target: STRESS_TEXT, progress: { ...defaultProgress(), tier, anchoredInput: anchored }, mode: 'key' }),
            passage,
            passageNumber: 1,
          }
          expect(() =>
            render(<ResultsModal open result={result} onClose={() => {}} onNext={() => {}} onRetry={() => {}} />),
          ).not.toThrow()
          expect(screen.getByText('Character review')).toBeTruthy()
          const cells = document.querySelectorAll('[title]')
          expect(cells).toHaveLength(result.ops.length)
          expect(screen.getByText(`${Math.round(result.accuracy)}%`)).toBeTruthy()
        })
      }
    }
  }
})
