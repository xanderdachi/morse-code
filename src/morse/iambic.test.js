import { afterEach, describe, expect, it, vi } from 'vitest'
import { leniencyFor } from '../lib/progress.js'
import { normalize, toMorse } from './alphabet.js'
import { IAMBIC_MODE, IAMBIC_MODES, createIambicKeyer } from './iambic.js'
import { createKeyer, interpret } from './keyer.js'
import { DASH, DOT } from './symbols.js'
import { unitMsForWpm } from './units.js'

const { errorGapUnits } = leniencyFor(1)
const lettersOf = text => normalize(text).replaceAll(' ', '').toUpperCase()

// The elements a keyer sent, from its events: [{ symbol, start, length }].
function elements(events) {
  const out = []
  for (const event of events) {
    if (event.type === 'down') out.push({ symbol: event.pad, start: event.t })
    else out.at(-1).length = event.t - out.at(-1).start
  }
  return out
}

// Run a script of paddle changes, [t, 'press' | 'release' | 'stop', pad], then let time run to `until`.
function play(script, { wpm = 20, mode = IAMBIC_MODE, until } = {}) {
  const keyer = createIambicKeyer({ wpm, mode })
  const events = []
  for (const [t, action, pad] of script) {
    keyer[action](pad, t)
    if (action === 'stop') keyer.stop(t)
    events.push(...keyer.advance(t))
  }
  events.push(...keyer.advance(until ?? script.at(-1)[0] + 5000))
  return { keyer, events, sent: elements(events) }
}

const symbols = sent => sent.map(element => element.symbol).join('')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('iambic keyer: one paddle', () => {
  it('sends exactly five dots, perfectly spaced, for a dot paddle held five dot periods', () => {
    const u = unitMsForWpm(20) // 60 ms
    const { sent } = play([
      [1000, 'press', DOT],
      [1000 + 5 * 2 * u, 'release', DOT],
    ])
    expect(sent).toEqual([0, 1, 2, 3, 4].map(i => ({ symbol: DOT, start: 1000 + i * 2 * u, length: u })))
  })

  it('repeats dashes at 3 units on, 1 off', () => {
    const u = unitMsForWpm(20)
    const { sent } = play([
      [0, 'press', DASH],
      [3 * 4 * u - 1, 'release', DASH],
    ])
    expect(sent).toEqual([0, 1, 2].map(i => ({ symbol: DASH, start: i * 4 * u, length: 3 * u })))
  })

  it('finishes an element whose paddle is let go early, and sends nothing after it', () => {
    const u = unitMsForWpm(20)
    const { sent } = play([
      [0, 'press', DASH],
      [u, 'release', DASH],
    ])
    expect(sent).toEqual([{ symbol: DASH, start: 0, length: 3 * u }])
  })
})

describe('iambic keyer: squeeze', () => {
  const u = unitMsForWpm(20)

  it('alternates from whichever paddle came first: dot-dash-dot-dash', () => {
    const { sent } = play(
      [
        [0, 'press', DOT],
        [10, 'press', DASH],
        [10 * u, 'release', DOT], // during the fourth element (a dash, 8u..11u)
        [10 * u, 'release', DASH],
      ],
      { mode: IAMBIC_MODES.A },
    )
    expect(symbols(sent)).toBe('.-.-')
    expect(sent.map(element => element.start)).toEqual([0, 2 * u, 6 * u, 8 * u])
  })

  it('and dash-dot-dash-dot from the dash paddle', () => {
    const { sent } = play(
      [
        [0, 'press', DASH],
        [10, 'press', DOT],
        [11 * u, 'release', DASH], // as the fourth element (a dot, 10u..11u) ends
        [11 * u, 'release', DOT],
      ],
      { mode: IAMBIC_MODES.A },
    )
    expect(symbols(sent)).toBe('-.-.')
  })
})

describe('iambic keyer: memory and modes', () => {
  const u = unitMsForWpm(20)

  it('dot memory: a dot tapped and let go mid-dash is sent next, exactly once', () => {
    const { sent } = play([
      [0, 'press', DASH],
      [u, 'press', DOT],
      [1.5 * u, 'release', DOT],
      [2 * u, 'release', DASH],
    ])
    expect(symbols(sent)).toBe('-.')
    expect(sent[1]).toEqual({ symbol: DOT, start: 4 * u, length: u })
  })

  it('dot memory with the dash still held: dash, dot, then dashes again', () => {
    const { sent } = play([
      [0, 'press', DASH],
      [u, 'press', DOT],
      [1.5 * u, 'release', DOT],
      [9 * u, 'release', DASH], // during the third element
    ])
    expect(symbols(sent)).toBe('-.-')
  })

  it('Mode B sends one trailing element, opposite the last, when a squeeze is let go; Mode A sends none', () => {
    const script = [
      [0, 'press', DOT],
      [30, 'press', DASH],
      [5.5 * u, 'release', DOT], // in the space after the dash (2u..5u, space to 6u)
      [5.5 * u, 'release', DASH],
    ]
    expect(symbols(play(script, { mode: IAMBIC_MODES.A }).sent)).toBe('.-')
    const b = play(script, { mode: IAMBIC_MODES.B }).sent
    expect(symbols(b)).toBe('.-.')
    expect(b[2]).toEqual({ symbol: DOT, start: 6 * u, length: u })
    expect(IAMBIC_MODE).toBe(IAMBIC_MODES.B)
  })
})

describe('iambic keyer: stopping', () => {
  const u = unitMsForWpm(20)

  it('stops within one element period of a paddle being let go', () => {
    for (const releaseAt of [0.2 * u, u, 1.9 * u, 7 * u]) {
      const { sent } = play([
        [0, 'press', DOT],
        [releaseAt, 'release', DOT],
      ])
      const lastStart = sent.at(-1).start
      expect(lastStart).toBeLessThanOrEqual(releaseAt)
      expect(lastStart + 2 * u).toBeGreaterThan(releaseAt)
    }
  })

  it('stop() (blur, pointercancel, a hidden page) cuts the element short and sends nothing more, memory and squeeze included', () => {
    const keyer = createIambicKeyer({ wpm: 20 })
    keyer.press(DOT, 0)
    keyer.press(DASH, 10) // a squeeze with dash memory
    const events = [...keyer.advance(3 * u)]
    keyer.stop(3 * u) // mid-dash (2u..5u)
    events.push(...keyer.advance(3 * u), ...keyer.advance(60_000))
    expect(elements(events)).toEqual([
      { symbol: DOT, start: 0, length: u },
      { symbol: DASH, start: 2 * u, length: u },
    ])
    expect(keyer.nextEventAt === null || keyer.nextEventAt <= 4 * u).toBe(true)
    expect(keyer.advance(60_000)).toEqual([])
    expect(keyer.nextEventAt).toBeNull()
  })

  it('runs only on the clock it is given: no real timers, and nothing happens between calls', () => {
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const keyer = createIambicKeyer({ wpm: 20 })
    keyer.press(DOT, 0)
    expect(keyer.advance(0)).toEqual([{ type: 'down', t: 0, pad: DOT }])
    expect(keyer.nextEventAt).toBe(u)
    expect(keyer.advance(u - 1)).toEqual([])
    expect(keyer.advance(u)).toEqual([{ type: 'up', t: u, pad: DOT }])
    expect(keyer.nextEventAt).toBe(2 * u)
    // A late wake-up still stamps each element at its exact time.
    keyer.release(DOT, 5 * u + 1)
    expect(keyer.advance(10 * u).map(event => event.t)).toEqual([2 * u, 3 * u, 4 * u, 5 * u])
    expect(timers).not.toHaveBeenCalled()
  })
})

// An operator keying `text` on paddles: each element's paddle pressed as the keyer is ready for it and let go
// half a unit later, 3 units between letters and 7 between words.
function paddleText(text, wpm) {
  const u = unitMsForWpm(wpm)
  const keyer = createIambicKeyer({ wpm })
  const events = []
  let t = 1000
  let gap = null
  for (const char of normalize(text).toUpperCase()) {
    if (char === ' ') {
      gap = 7
      continue
    }
    if (gap !== null) t += (gap - 1) * u // the keyer's own 1-unit space has already passed
    for (const symbol of toMorse(char)) {
      keyer.press(symbol, t)
      events.push(...keyer.advance(t))
      keyer.release(symbol, t + u / 2)
      events.push(...keyer.advance(t + u / 2))
      t += (symbol === DOT ? 1 : 3) * u + u
    }
    gap = 3
  }
  events.push(...keyer.advance(t + 10 * u))
  return events
}

describe('iambic keyer: decoding what it sends', () => {
  const text = 'The quick brown fox, 0123456789.'
  for (const wpm of [5, 15, 25, 40]) {
    it(`decodes to the intended letters at ${wpm} WPM, anchored and unanchored`, () => {
      const log = paddleText(text, wpm)
      for (const anchored of [true, false]) {
        const run = interpret(log, { errorGapUnits, target: text, anchored, unitMs: unitMsForWpm(wpm), final: true })
        expect(run.text, `${wpm} WPM, ${anchored ? 'anchored' : 'unanchored'}`).toBe(lettersOf(text))
        expect(run.marks.every(mark => mark.durationMs === (mark.symbol === DOT ? 1 : 3) * unitMsForWpm(wpm))).toBe(true)
      }
    })
  }

  it('feeds the same pad entries the manual path uses', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'EA', unitMs: unitMsForWpm(15) })
    for (const { type, t, pad } of paddleText('EA', 15)) {
      if (type === 'down') keyer.padDown(pad, t)
      else keyer.padUp(pad, t)
    }
    expect(keyer.finish(60_000).text).toBe('EA')
  })
})
