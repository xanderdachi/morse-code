import { describe, expect, it } from 'vitest'
import { normalize } from './alphabet.js'
import { grade } from './grade.js'
import { createKeyer, interpret } from './keyer.js'
import { seededRandom, synthesizeKeying } from './testing/syntheticKeyer.js'
import { CONFIG } from './timing.js'
import { leniencyFor } from '../lib/progress.js'

// The error path's letter gap, from the leniency table as the app uses it.
const { errorGapUnits } = leniencyFor(1)

const TEXT = 'In a certain kingdom, in a certain land, there lived a Tsar.'
const lettersOf = text => normalize(text).replaceAll(' ', '').toUpperCase()
const finish = (log, options = {}) => interpret(log, { errorGapUnits, target: TEXT, final: true, ...options })
const replay = (keyer, log) => {
  for (const { type, t, pad } of log) {
    if (pad && type === 'down') keyer.padDown(pad, t)
    else if (pad) keyer.padUp(pad, t)
    else if (type === 'down') keyer.keyDown(t)
    else keyer.keyUp(t)
  }
}

describe('raw input hygiene', () => {
  it('ignores held-key auto-repeat downs in a log', () => {
    const clean = synthesizeKeying(TEXT, { wpm: 8 })
    const repeating = synthesizeKeying(TEXT, { wpm: 8, repeatAfterMs: 25, repeatEveryMs: 12 })
    expect(repeating.length).toBeGreaterThan(clean.length * 2)
    for (const anchored of [true, false]) {
      expect(finish(repeating, { anchored }).text).toBe(lettersOf(TEXT))
    }
  })

  it('does not log or act on a repeated down from the live keyer', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'T' })
    expect(keyer.keyDown(0)).toBe(true)
    for (let t = 30; t < 330; t += 30) expect(keyer.keyDown(t)).toBe(false)
    expect(keyer.keyUp(360)).toBe(true)
    const run = keyer.finish(400)
    expect(run.log).toEqual([
      { type: 'down', t: 0 },
      { type: 'up', t: 360 },
      { type: 'finish', t: 400 },
    ])
    expect(run.text).toBe('T')
  })

  it('ignores presses shorter than 20ms as contact bounce', () => {
    const log = [
      { type: 'down', t: 0 },
      { type: 'up', t: 100 },
      { type: 'down', t: 400 },
      { type: 'up', t: 412 },
      { type: 'down', t: 800 },
      { type: 'up', t: 1100 },
    ]
    const run = finish(log, { target: 'ET', unitMs: 100 })
    expect(run.text).toBe('ET')
    expect(run.anomalies).toEqual([{ type: 'bounce', t: 400, durationMs: 12 }])
    expect(run.marks[1].gapBeforeMs).toBe(700)
  })

  it('treats a press over 10u as a dash, flagged', () => {
    const log = [
      { type: 'down', t: 0 },
      { type: 'up', t: 100 },
      { type: 'down', t: 400 },
      { type: 'up', t: 5400 },
    ]
    const run = finish(log, { target: 'ET', unitMs: 100 })
    expect(run.text).toBe('ET')
    expect(run.anomalies).toEqual([{ type: 'long-press', t: 400, durationMs: 5000 }])
  })

  it('treats releasing everything (blur, pointercancel) as a key release', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'T', unitMs: 100 })
    keyer.keyDown(1000)
    expect(keyer.state(1100).isKeyDown).toBe(true)
    expect(keyer.releaseAll(1400)).toBe(true)
    expect(keyer.state(1400)).toMatchObject({ isKeyDown: false, text: 'T' })
    expect(keyer.releaseAll(1500)).toBe(false)
  })

  it('ignores ups with no matching down, and legacy word events', () => {
    const log = [{ type: 'up', t: 5 }, { type: 'up', t: 9, pad: '.' }, { type: 'word', t: 12 }]
    expect(finish(log).letters).toEqual([])
  })
})

describe('live state', () => {
  it('reports a held key becoming a dash, and schedules that check', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'T', unitMs: 100 })
    keyer.keyDown(1000)
    expect(keyer.state(1100)).toMatchObject({ isKeyDown: true, dashFormed: false, nextCheckAt: 1200 })
    expect(keyer.state(1200)).toMatchObject({ dashFormed: true, nextCheckAt: null })
  })

  it('enters and reports a pause after max(10u, 2000ms) of silence, freezing sending time', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'EE', unitMs: 100 })
    keyer.keyDown(0)
    keyer.keyUp(100)
    const quiet = keyer.state(1000)
    expect(quiet).toMatchObject({ paused: false, nextCheckAt: 2100, pauseAfterMs: 2000 })
    expect(keyer.state(2101).paused).toBe(true)
    keyer.keyDown(9100)
    keyer.keyUp(9200)
    const run = keyer.finish(9300)
    expect(run.pausedMs).toBe(7000) // the 9s silence beyond its 2s threshold
    expect(run.elapsedMs).toBe(9200 - 7000)
  })

  it('shows committed letters and the letter in progress, with no word separators', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'AB', unitMs: 100 })
    for (const [down, up] of [[0, 100], [200, 500], [1200, 1500], [1600, 1700]]) {
      keyer.keyDown(down)
      keyer.keyUp(up)
    }
    const state = keyer.state(1700)
    expect(state.strip).toEqual([
      { id: 0, symbol: '.', endsLetter: false },
      { id: 1, symbol: '-', endsLetter: true },
      { id: 2, symbol: '-', endsLetter: false },
      { id: 3, symbol: '.', endsLetter: false },
    ])
  })

  it('agrees with the finished run once the run is over', () => {
    const log = synthesizeKeying(TEXT, { wpm: 22, jitter: 0.15, seed: 4 })
    const live = interpret(log, { errorGapUnits, target: TEXT, now: log.at(-1).t + 10_000 })
    expect(live.text).toBe(finish(log).text)
  })
})

describe('degenerate runs', () => {
  const saneResult = (run, target = TEXT) => {
    const result = grade({ target, sent: run.text, elapsedMs: run.elapsedMs, letterUnits: run.letterUnits })
    for (const key of ['accuracy', 'wpm', 'effectiveWpm']) {
      expect(Number.isFinite(result[key]), key).toBe(true)
      expect(result[key], key).toBeGreaterThanOrEqual(0)
    }
    expect(result.accuracy).toBeLessThanOrEqual(100)
    return result
  }

  it('handles an empty run', () => {
    for (const anchored of [true, false]) {
      const run = createKeyer({ errorGapUnits, target: TEXT, anchored }).finish(5000)
      expect(run).toMatchObject({ letters: [], text: '', log: [{ type: 'finish', t: 5000 }], startedAt: null, elapsedMs: 0, pausedMs: 0 })
      expect(saneResult(run)).toMatchObject({ accuracy: 0, wpm: 0, effectiveWpm: 0 })
    }
  })

  it('handles a run of pure noise', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = seededRandom(seed)
      const log = []
      let t = random() * 1000
      for (let i = 0; i < 300; i++) {
        const roll = random()
        const type = roll < 0.05 ? 'undo' : roll < 0.12 ? 'letter' : random() < 0.5 ? 'down' : 'up'
        const pad = random() < 0.3 ? (random() < 0.5 ? '.' : '-') : undefined
        log.push(pad ? { type, t, pad } : { type, t })
        t += random() < 0.05 ? -random() * 50 : random() * 900
      }
      for (const anchored of [true, false]) {
        const run = finish(log, { anchored })
        saneResult(run)
        expect(run.unitMs).toBeGreaterThanOrEqual(CONFIG.minUnitMs)
        expect(run.unitMs).toBeLessThanOrEqual(CONFIG.maxUnitMs)
      }
    }
  })

  it('handles a run abandoned halfway, reporting speed honestly', () => {
    const full = synthesizeKeying(TEXT, { wpm: 15 })
    for (const anchored of [true, false]) {
      const keyer = createKeyer({ errorGapUnits, target: TEXT, anchored })
      const half = full.slice(0, Math.floor(full.length / 4) * 2)
      replay(keyer, half)
      const run = keyer.finish(half.at(-1).t + 50)
      const result = saneResult(run)
      expect(result.accuracy).toBeGreaterThan(35)
      expect(result.accuracy).toBeLessThan(65)
      expect(result.wpm).toBeGreaterThan(13)
      expect(result.wpm).toBeLessThan(17)
      expect(result.effectiveWpm).toBeLessThanOrEqual(result.wpm + 1e-9)
    }
  })

  it('handles a run abandoned with the key still held', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'EA', unitMs: 100 })
    keyer.keyDown(0)
    keyer.keyUp(100)
    keyer.keyDown(400)
    const run = keyer.finish(700)
    expect(run.text).toBe('ET')
    expect(run.log.slice(-2)).toEqual([
      { type: 'up', t: 700 },
      { type: 'finish', t: 700 },
    ])
  })
})
