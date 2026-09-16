// Recovery after consecutive wrong letters, measured rather than assumed.
//
// A run is resynced at letter m when, the moment letter m's last mark is
// released, the anchored decoder holds a single hypothesis, its cursor is right
// after m, and it has just committed m as a match. Letters-to-resync counts the
// correct letters sent after the run of mistakes up to and including that one.
//
// "In step" is reported alongside: the first letter at which the best hypothesis
// is in the right place and matching, whether or not the beam has let go of the
// others yet. It is what the operator would see; resync is when it is certain.

import { afterAll, describe, expect, it } from 'vitest'
import { leniencyFor } from '../lib/progress.js'
import { normalize, toMorse } from './alphabet.js'
import { grade } from './grade.js'
import { interpret } from './keyer.js'
import { beginnerMistake, seededRandom, synthesizeScript } from './testing/syntheticKeyer.js'
import { CONFIG } from './timing.js'

const { errorGapUnits } = leniencyFor(1)
const lettersOf = text => normalize(text).replaceAll(' ', '').toUpperCase()

const LONG = lettersOf(
  'Is it not pleasant to learn with a constant perseverance and application? In a certain kingdom, in a certain land, there lived a Tsar.',
)
const WPMS = [5, 15, 25, 35]
const TRIALS = 160
const LOOK_AHEAD = 15
const report = { resync: [], local: [] }

// Send `target` with the letters at `wrongAt` replaced by beginner mistakes. Returns the log and each letter's last release.
function sendWithMistakes(target, wrongAt, { wpm, seed }) {
  const random = seededRandom(seed)
  const steps = [...target].map((char, i) => ({ code: wrongAt.has(i) ? beginnerMistake(toMorse(char), random) : toMorse(char) }))
  const log = synthesizeScript(steps, { wpm, seed, jitter: 0.15 })
  const ups = log.filter(event => event.type === 'up')
  const letterEnds = []
  let marks = 0
  for (const step of steps) {
    marks += step.code.length
    letterEnds.push(ups[marks - 1].t)
  }
  return { log, letterEnds, steps }
}

function lettersToResync(k, trial) {
  const random = seededRandom(1000 * k + trial)
  const wpm = WPMS[trial % WPMS.length]
  const start = 4 + Math.floor(random() * (LONG.length - k - LOOK_AHEAD - 8))
  const wrongAt = new Set(Array.from({ length: k }, (_, i) => start + i))
  const { log, letterEnds } = sendWithMistakes(LONG, wrongAt, { wpm, seed: 7 * k + trial })

  let inStep = Infinity
  for (let m = start + k; m < Math.min(LONG.length, start + k + LOOK_AHEAD); m++) {
    const cut = log.findIndex(event => event.t === letterEnds[m])
    const state = interpret(log.slice(0, cut + 1), { target: LONG, errorGapUnits, unitMs: CONFIG.defaultUnitMs, now: letterEnds[m] })
    const last = state.letters.at(-1)
    const aligned = state.cursor === m + 1 && last?.kind === 'match' && last.char === LONG[m]
    if (aligned && inStep === Infinity) inStep = m - (start + k) + 1
    if (aligned && state.beamWidth === 1) return { wpm, letters: m - (start + k) + 1, inStep }
  }
  return { wpm, letters: Infinity, inStep }
}

const stats = values => {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  const pct = p => finite[Math.min(finite.length - 1, Math.floor(p * finite.length))]
  return {
    mean: +(finite.reduce((a, b) => a + b, 0) / finite.length).toFixed(2),
    median: pct(0.5),
    p90: pct(0.9),
    max: finite.at(-1),
    'within 5': `${((100 * values.filter(v => v <= 5).length) / values.length).toFixed(1)}%`,
    'not in 15': values.filter(v => !Number.isFinite(v)).length,
  }
}

const inStepStats = values => ({
  'in step: mean': +(values.filter(Number.isFinite).reduce((a, b) => a + b, 0) / values.filter(Number.isFinite).length).toFixed(2),
  'in step within 5': `${((100 * values.filter(v => v <= 5).length) / values.length).toFixed(1)}%`,
})

describe('recovery after consecutive wrong letters (anchored)', () => {
  for (const k of [1, 2, 3, 5]) {
    it(`resyncs within 5 letters in at least 95% of runs after ${k} wrong letter${k > 1 ? 's' : ''}`, () => {
      const results = Array.from({ length: TRIALS }, (_, trial) => lettersToResync(k, trial))
      const letters = results.map(r => r.letters)
      report.resync.push({ 'wrong in a row': k, trials: TRIALS, ...stats(letters), ...inStepStats(results.map(r => r.inStep)) })
      for (const wpm of WPMS) {
        const at = results.filter(r => r.wpm === wpm)
        report.resync.push({
          'wrong in a row': `  ${k} @ ${wpm} WPM`,
          trials: at.length,
          ...stats(at.map(r => r.letters)),
          ...inStepStats(at.map(r => r.inStep)),
        })
      }
      expect(letters.filter(v => v <= 5).length / letters.length).toBeGreaterThanOrEqual(0.95)
    })
  }
})

describe('errors stay local', () => {
  const target = LONG.slice(0, 50)

  for (const layout of ['scattered', 'consecutive']) {
    it(`grades 5 wrong letters (${layout}) in a 50-letter passage near 90%`, () => {
      const accuracies = []
      for (let trial = 0; trial < 120; trial++) {
        const random = seededRandom(5000 + trial)
        const wrongAt = new Set()
        if (layout === 'consecutive') {
          const start = 2 + Math.floor(random() * 40)
          for (let i = 0; i < 5; i++) wrongAt.add(start + i)
        } else {
          while (wrongAt.size < 5) wrongAt.add(1 + Math.floor(random() * 48))
        }
        const wpm = WPMS[trial % WPMS.length]
        const { log } = sendWithMistakes(target, wrongAt, { wpm, seed: 9000 + trial })
        const run = interpret(log, { target, errorGapUnits, unitMs: CONFIG.defaultUnitMs, final: true })
        accuracies.push(grade({ target, sent: run.text, elapsedMs: run.elapsedMs, letterUnits: run.letterUnits }).accuracy)
      }
      const sorted = [...accuracies].sort((a, b) => a - b)
      const mean = accuracies.reduce((a, b) => a + b, 0) / accuracies.length
      report.local.push({
        layout,
        trials: accuracies.length,
        mean: +mean.toFixed(1),
        min: sorted[0],
        p10: sorted[Math.floor(sorted.length * 0.1)],
        max: sorted.at(-1),
        'exactly 90%': accuracies.filter(a => a === 90).length,
      })
      expect(Math.abs(mean - 90)).toBeLessThanOrEqual(3)
      expect(sorted[0]).toBeGreaterThanOrEqual(80)
    })
  }
})

afterAll(() => {
  if (report.resync.length) console.table(report.resync)
  if (report.local.length) console.table(report.local)
})
