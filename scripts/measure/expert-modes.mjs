// Expert failure modes: correct symbols sent with an experienced operator's habits.
//
//   node scripts/measure/expert-modes.mjs [runsPerCase=60]
//
// For each case: accuracy, and whether errors stay local or cascade.
//   burst    4 or more consecutive wrong letters in the grading alignment
//   runaway  a burst that never recovers: the passage's last 15 letters are still wrong
//            somewhere (perturbations here end well before that)

import { KEYER_WPM, leniencyFor } from '../../src/lib/progress.js'
import { normalize, toMorse } from '../../src/morse/alphabet.js'
import { grade } from '../../src/morse/grade.js'
import { createIambicKeyer } from '../../src/morse/iambic.js'
import { interpret } from '../../src/morse/keyer.js'
import { seededRandom, synthesizeKeying } from '../../src/morse/testing/syntheticKeyer.js'
import { CONFIG } from '../../src/morse/timing.js'
import { unitMsForWpm } from '../../src/morse/units.js'

const RUNS = Number(process.argv[2] ?? 60)
const TEXT = 'Is it not pleasant to learn with a constant perseverance and application? In a certain kingdom, in a certain land, there lived a Tsar.'
const LETTERS = normalize(TEXT).replaceAll(' ', '').toUpperCase()
const CASCADE_BURST = 4

// Rebuild a clean straight-key log with each press and gap reshaped. `shape(kind, units, random)` returns
// the new length in units: kind is 'dot' | 'dash' for presses, 'inside' | 'letter' | 'word' for gaps.
function reshape(text, { wpm, seed, shape, codeFor }) {
  const random = seededRandom(seed)
  const unit = unitMsForWpm(wpm)
  const clean = synthesizeKeying(text, { wpm, codeFor })
  const log = []
  let t = 1000
  for (let i = 0; i < clean.length; i += 2) {
    if (i > 0) {
      const units = Math.round((clean[i].t - clean[i - 1].t) / unit)
      const kind = units <= 1 ? 'inside' : units <= 3 ? 'letter' : 'word'
      t += shape(kind, units, random) * unit
    }
    const pressUnits = Math.round((clean[i + 1].t - clean[i].t) / unit)
    log.push({ type: 'down', t })
    t += shape(pressUnits === 1 ? 'dot' : 'dash', pressUnits, random) * unit
    log.push({ type: 'up', t })
  }
  return log
}

const jittered = amount => (units, random) => units * (1 + (random() * 2 - 1) * amount)

const TAIL = 15

function profile(sent) {
  const { accuracy, ops } = grade({ target: TEXT, sent })
  let burst = 0
  let longest = 0
  for (const { op } of ops) {
    burst = op === 'match' ? 0 : burst + 1
    longest = Math.max(longest, burst)
  }
  // The tail: the alignment's ops for the passage's last TAIL letters, plus anything after them.
  let seen = 0
  let tailStart = ops.length
  for (let i = ops.length - 1; i >= 0 && seen < TAIL; i--) {
    if (ops[i].expected !== null) seen++
    tailStart = i
  }
  const tailClean = ops.slice(tailStart).every(entry => entry.op === 'match')
  return { accuracy, longest, runaway: longest >= CASCADE_BURST && !tailClean }
}

function measure(name, makeLog, { speeds = [null], unitFor = () => CONFIG.defaultUnitMs } = {}) {
  const rows = []
  for (const wpm of speeds) {
    for (const [mode, anchored, tier] of [
      ['anchored', true, 1],
      ['unanchored', false, 5],
    ]) {
      const results = []
      for (let run = 0; run < RUNS; run++) {
        const log = makeLog({ wpm, seed: 7000 + run * 13 + (wpm ?? 0) })
        const decoded = interpret(log, { target: TEXT, anchored, errorGapUnits: leniencyFor(tier).errorGapUnits, unitMs: unitFor(wpm), final: true })
        results.push(profile(decoded.text))
      }
      const accuracies = results.map(r => r.accuracy).sort((a, b) => a - b)
      const cascades = results.filter(r => r.longest >= CASCADE_BURST).length
      rows.push({
        case: name,
        wpm: wpm ?? '',
        mode,
        mean: +(accuracies.reduce((a, b) => a + b, 0) / accuracies.length).toFixed(1),
        worst: +accuracies[0].toFixed(1),
        perfect: `${Math.round((100 * accuracies.filter(a => a === 100).length) / accuracies.length)}%`,
        'longest burst': Math.max(...results.map(r => r.longest)),
        'burst runs': `${cascades}/${RUNS}`,
        'runaway runs': `${results.filter(r => r.runaway).length}/${RUNS}`,
      })
    }
  }
  console.table(rows)
  return rows
}

const all = []
const speeds = [15, 25, 35]
const soft = jittered(0.1)

console.log('\n1. CORRECT SYMBOLS, SLOPPY SPACING (presses and gaps ±10% on top)')
for (const [name, factors] of [
  ['all gaps 50% long', { inside: 1.5, letter: 1.5, word: 1.5 }],
  ['all gaps 50% short', { inside: 0.5, letter: 0.5, word: 0.5 }],
  ['inside gaps long, letter gaps short', { inside: 1.5, letter: 0.5, word: 0.5 }],
]) {
  all.push(
    ...measure(name, ({ wpm, seed }) =>
      reshape(TEXT, { wpm, seed, shape: (kind, units, random) => soft(units * (factors[kind] ?? 1), random) }),
    { speeds }),
  )
}

console.log('\n2. SPEED CHANGING MID-WORD (±10% jitter)')
all.push(
  ...measure('25 -> 10 -> 25 WPM, switching mid-word', ({ seed }) =>
    synthesizeKeying(TEXT, { wpmAt: p => (p < 1 / 3 || p >= 2 / 3 ? 25 : 10), jitter: 0.1, seed }),
  ),
  ...measure('10 -> 25 -> 10 WPM, switching mid-word', ({ seed }) =>
    synthesizeKeying(TEXT, { wpmAt: p => (p < 1 / 3 || p >= 2 / 3 ? 10 : 25), jitter: 0.1, seed }),
  ),
)

console.log('\n3. FIST DRIFT: A STEADY 30% SPEED CHANGE OVER THE PASSAGE (±10% jitter)')
for (const [from, to] of [
  [20, 26],
  [20, 14],
  [30, 39],
  [30, 21],
]) {
  all.push(...measure(`drift ${from} -> ${to} WPM`, ({ seed }) => synthesizeKeying(TEXT, { wpmAt: p => from + (to - from) * p, jitter: 0.1, seed })))
}

console.log('\n4. WEIGHTING: DASHES LONG RELATIVE TO DOTS (±10% jitter)')
for (const weight of [1.2, 1.4]) {
  all.push(
    ...measure(`dashes ${Math.round((weight - 1) * 100)}% long`, ({ wpm, seed }) =>
      reshape(TEXT, { wpm, seed, shape: (kind, units, random) => soft(kind === 'dash' ? units * weight : units, random) }),
    { speeds: [15, 25, 35] }),
  )
}

console.log('\n5. ONE ERROR AT HIGH SPEED: does a single mistake stay local? (±10% and ±20% jitter)')
for (const jitter of [0.1, 0.2]) {
  all.push(
    ...measure(`one wrong letter mid-passage, ±${jitter * 100}%`, ({ wpm, seed }) =>
      synthesizeKeying(TEXT, { wpm, jitter, seed, codeFor: (char, i) => (i === 50 ? (toMorse(char) === '-' ? '.' : '-') : toMorse(char)) }),
    { speeds: [20, 30, 35, 40, 45] }),
  )
}

console.log(`\n6. IAMBIC AT ${KEYER_WPM.max} WPM (the keyer maximum), PADDLE RELEASES AT THE EDGE OF THE ELEMENT WINDOW`)
// The keyer decides the next element at the end of each element's space. A paddle still held at that
// instant sends another element. Here the operator lets go `delta` ms from that instant on a share of elements.
function iambicEdgeLog({ seed, delta, share }) {
  const random = seededRandom(seed)
  const wpm = KEYER_WPM.max
  const u = unitMsForWpm(wpm)
  const keyer = createIambicKeyer({ wpm })
  const events = []
  let t = 1000
  let gap = null
  for (const char of normalize(TEXT).toUpperCase()) {
    if (char === ' ') {
      gap = 7
      continue
    }
    if (gap !== null) t += (gap - 1) * u
    for (const symbol of toMorse(char)) {
      const length = (symbol === '.' ? 1 : 3) * u
      const release = random() < share ? t + length + u + delta : t + length / 2
      keyer.press(symbol, t)
      events.push(...keyer.advance(t))
      keyer.release(symbol, release)
      events.push(...keyer.advance(Math.max(release, t + length + u)))
      t = Math.max(t + length + u, events.at(-1)?.t ?? t)
      // Whatever the keyer is still sending finishes before the next paddle.
      const pending = keyer.advance(t + 10 * u)
      events.push(...pending)
      if (pending.length) t = pending.at(-1).t + u
    }
    gap = 3
  }
  events.push(...keyer.advance(t + 20 * u))
  return events
}
const iambicRows = []
for (const delta of [-5, -2, -1, 1, 2, 5]) {
  for (const share of [0.05, 0.2]) {
    const results = []
    for (let run = 0; run < RUNS; run++) {
      const log = iambicEdgeLog({ seed: 11_000 + run, delta, share })
      const elements = log.filter(event => event.type === 'down').length
      const unitMs = unitMsForWpm(KEYER_WPM.max)
      const decoded = interpret(log, { target: TEXT, errorGapUnits: leniencyFor(1).errorGapUnits, unitMs, final: true })
      const unanchored = interpret(log, { target: TEXT, anchored: false, errorGapUnits: leniencyFor(5).errorGapUnits, unitMs, final: true })
      results.push({ elements, anchored: profile(decoded.text), unanchored: profile(unanchored.text) })
    }
    const expected = [...LETTERS].reduce((n, char) => n + toMorse(char).length, 0)
    const summarize = key => {
      const a = results.map(r => r[key].accuracy)
      return `${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)}% (worst ${Math.min(...a).toFixed(0)}, bursts ${results.filter(r => r[key].longest >= CASCADE_BURST).length}/${RUNS}, runaway ${results.filter(r => r[key].runaway).length}/${RUNS})`
    }
    iambicRows.push({
      'release vs decision (ms)': delta > 0 ? `+${delta} (late)` : `${delta} (early)`,
      'share of elements': `${share * 100}%`,
      'extra elements per 1000': +((1000 * results.reduce((n, r) => n + r.elements - expected, 0)) / (expected * RUNS)).toFixed(1),
      anchored: summarize('anchored'),
      unanchored: summarize('unanchored'),
    })
  }
}
console.table(iambicRows)

const cascading = all.filter(row => row['burst runs'] !== `0/${RUNS}`)
console.log('\nCASES WITH ANY CASCADE:')
console.table(cascading.length ? cascading : [{ none: true }])
