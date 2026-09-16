// Speed sweep: decoder accuracy from 5 to 50 WPM with ±20% timing jitter.
//
//   node scripts/measure/speed-sweep.mjs [runsPerSpeed=200] [jitter=0.2]
//
// For every speed, `runs` synthetic straight-key runs over real passages, anchored
// and unanchored, from an uncalibrated start (the app's default unit) and a
// calibrated one (the operator's true unit, clamped as the app stores it).
// Prints accuracy per speed and the bounce filter against each speed's shortest dot.

import { leniencyFor } from '../../src/lib/progress.js'
import { grade } from '../../src/morse/grade.js'
import { bounceThresholdMs, interpret } from '../../src/morse/keyer.js'
import { synthesizeKeying } from '../../src/morse/testing/syntheticKeyer.js'
import { CONFIG } from '../../src/morse/timing.js'
import { unitMsForWpm } from '../../src/morse/units.js'

const RUNS = Number(process.argv[2] ?? 200)
const JITTER_ARG = process.argv[3]
const JITTER = JITTER_ARG === undefined ? 0.2 : Number(JITTER_ARG)
const PASSAGES = [
  'To be, or not to be.',
  'What is the sound of one hand?',
  'An old pond. A frog jumps in. The sound of water.',
  'In a certain kingdom, in a certain land, there lived a Tsar.',
  'Is it not pleasant to learn with a constant perseverance and application?',
  'The quick brown fox jumps over the lazy dog 0123456789',
]
const clampUnit = ms => Math.min(CONFIG.maxUnitMs, Math.max(CONFIG.minUnitMs, ms))

const speeds = []
for (let wpm = 5; wpm <= 50; wpm += 2.5) speeds.push(wpm)

const rows = []
for (const wpm of speeds) {
  const row = { wpm }
  for (const [label, anchored, tier] of [
    ['anchored', true, 1],
    ['unanchored', false, 5],
  ]) {
    for (const [start, unitMs] of [
      ['uncal', CONFIG.defaultUnitMs],
      ['cal', clampUnit(unitMsForWpm(wpm))],
    ]) {
      let sum = 0
      let perfect = 0
      let worst = 100
      let bounces = 0
      let presses = 0
      for (let run = 0; run < RUNS; run++) {
        const text = PASSAGES[run % PASSAGES.length]
        const log = synthesizeKeying(text, { wpm, jitter: JITTER, seed: 1000 + run * 7 + Math.round(wpm * 10) })
        const result = interpret(log, { target: text, anchored, unitMs, errorGapUnits: leniencyFor(tier).errorGapUnits, final: true })
        const { accuracy } = grade({ target: text, sent: result.text })
        sum += accuracy
        if (accuracy === 100) perfect++
        worst = Math.min(worst, accuracy)
        bounces += result.anomalies.filter(anomaly => anomaly.type === 'bounce').length
        presses += log.filter(event => event.type === 'down').length
      }
      row[`${label} ${start} mean`] = +(sum / RUNS).toFixed(2)
      row[`${label} ${start} 100%`] = `${Math.round((100 * perfect) / RUNS)}%`
      row[`${label} ${start} worst`] = Math.round(worst)
      if (label === 'anchored' && start === 'uncal') row['presses dropped as bounce'] = `${((100 * bounces) / presses).toFixed(2)}%`
    }
  }
  rows.push(row)
  process.stderr.write(`${wpm} `)
}
process.stderr.write('\n')

const pick = (keys) => rows.map(row => Object.fromEntries([['wpm', row.wpm], ...keys.map(key => [key, row[key]])]))
console.log('\nUNCALIBRATED START (the default unit, as a new player keys)')
console.table(pick(['anchored uncal mean', 'anchored uncal 100%', 'anchored uncal worst', 'unanchored uncal mean', 'unanchored uncal 100%', 'unanchored uncal worst', 'presses dropped as bounce']))
console.log(`CALIBRATED START (true unit, clamped to ${CONFIG.minUnitMs}-${CONFIG.maxUnitMs} ms as stored)`)
console.table(pick(['anchored cal mean', 'anchored cal 100%', 'anchored cal worst', 'unanchored cal mean', 'unanchored cal 100%', 'unanchored cal worst']))

for (const key of ['anchored uncal mean', 'unanchored uncal mean', 'anchored cal mean', 'unanchored cal mean']) {
  const below = rows.filter(row => row[key] < 98).map(row => row.wpm)
  const clean = rows.filter(row => row[key] >= 98).map(row => row.wpm)
  console.log(`${key}: >= 98% at ${clean.length ? `${clean[0]}-${clean.at(-1)}` : 'none'} WPM; below 98% at ${below.join(', ') || 'none'}`)
}

console.log(`\nBOUNCE FILTER: the limit is ${CONFIG.bounceUnits}u of the run's own short presses, within [${CONFIG.bounceFloorMs}, ${CONFIG.minPressMs}] ms. With the ${Math.round(JITTER * 100)}% jitter above:`)
console.table(
  speeds.map(wpm => {
    const dot = unitMsForWpm(wpm)
    const log = synthesizeKeying(PASSAGES[4], { wpm, jitter: JITTER, seed: 99 })
    const limit = bounceThresholdMs(log, CONFIG.defaultUnitMs)
    return {
      wpm,
      'dot ms': +dot.toFixed(1),
      [`dot -${Math.round(JITTER * 100)}% ms`]: +(dot * (1 - JITTER)).toFixed(1),
      'bounce limit ms (uncalibrated)': +limit.toFixed(1),
      'shortest dot dropped': dot * (1 - JITTER) < limit,
      [`unit below clamp (${CONFIG.minUnitMs}ms)`]: dot < CONFIG.minUnitMs,
    }
  }),
)
