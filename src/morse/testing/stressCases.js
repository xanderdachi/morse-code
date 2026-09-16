// The beginner stress cases, shared by the engine and review tests.

import { beginnerScript, synthesizeScript } from './syntheticKeyer.js'

export const STRESS_TEXT = 'In a certain kingdom, in a certain land, there lived a Tsar.'
export const STRESS_WPMS = [5, 35]

// A beginner: uneven timing, the odd hesitation inside a letter, and long thinks between letters.
export function beginnerLog(scenario, wpm, seed = 11) {
  return synthesizeScript(beginnerScript(STRESS_TEXT, scenario, { seed }), {
    wpm,
    seed,
    jitter: 0.2,
    hesitation: { chance: 0.05, extraUnits: [1, 4] },
    thinking: { chance: 0.04, ms: [3000, 9000] },
  })
}
