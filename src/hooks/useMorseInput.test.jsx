// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { leniencyFor } from '../lib/progress.js'
import { unitMsForWpm } from '../morse/units.js'
import { mockClock } from '../testing/dom.js'
import { useMorseInput } from './useMorseInput.js'

const { errorGapUnits } = leniencyFor(1)

let clock
let input

beforeEach(() => {
  clock = mockClock()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete document.visibilityState
})

function Harness(options) {
  const live = useMorseInput({ target: 'PARIS', errorGapUnits, ...options })
  useLayoutEffect(() => {
    input = live
  })
  return (
    <>
      <button type="button" data-testid="key" {...live.keyProps} />
      <button type="button" data-testid="dot" {...live.padProps['.']} />
      <button type="button" data-testid="dash" {...live.padProps['-']} />
    </>
  )
}

function setup(options = {}) {
  const view = render(<Harness {...options} />)
  return {
    key: view.getByTestId('key'),
    dot: view.getByTestId('dot'),
    dash: view.getByTestId('dash'),
  }
}

const fire = (...args) => clock.fire(...args)
const down = (target, pointerId, at) => fire(target, 'pointerdown', { pointerId }, at)
const up = (target, pointerId, at) => fire(target, 'pointerup', { pointerId }, at)
// Reaching the page now, stamped at `stampedAt`.
const lateDown = (target, pointerId, stampedAt) => clock.fireLate(target, 'pointerdown', { pointerId }, stampedAt)
const lateUp = (target, pointerId, stampedAt) => clock.fireLate(target, 'pointerup', { pointerId }, stampedAt)

// The presses the keyer recorded, once the run is ended.
function presses(at = clock.now) {
  clock.now = at
  let run
  act(() => {
    run = input.finish()
  })
  return run.marks.map(({ fixedSymbol, start, durationMs }) => ({ pad: fixedSymbol, start, durationMs }))
}

describe('pointer keying', () => {
  it('records a tap from pointerdown to pointerup, using the event timestamps', () => {
    const { key } = setup()
    down(key, 1, 10_000)
    expect(input.isKeyDown).toBe(true)
    up(key, 1, 10_085)
    expect(input.isKeyDown).toBe(false)
    expect(presses(10_500)).toEqual([{ pad: undefined, start: 10_000, durationMs: 85 }])
  })

  it('listens non-passively, so pointerdown can prevent the default', () => {
    const { key, dot } = setup()
    expect(down(key, 1, 10_000).defaultPrevented).toBe(true)
    expect(down(dot, 2, 10_010).defaultPrevented).toBe(true)
  })

  it('releases where the pointer ends up, even off the key', () => {
    const { key } = setup()
    down(key, 1, 10_000)
    up(document.body, 1, 10_240)
    expect(input.isKeyDown).toBe(false)
    expect(presses()).toEqual([{ pad: undefined, start: 10_000, durationMs: 240 }])
  })
})

describe('releases', () => {
  it('pointercancel releases the held key and commits the press at the cancel', () => {
    const { key } = setup()
    down(key, 7, 10_000)
    fire(key, 'pointercancel', { pointerId: 7 }, 10_090)
    expect(input.isKeyDown).toBe(false)
    // The pointer's own late release changes nothing.
    up(key, 7, 10_600)
    expect(presses(10_700)).toEqual([{ pad: undefined, start: 10_000, durationMs: 90 }])
  })

  it('window blur releases the held key and commits the press at the blur', () => {
    const { key } = setup()
    down(key, 1, 10_000)
    fire(window, 'blur', {}, 10_400)
    expect(input.isKeyDown).toBe(false)
    up(key, 1, 11_000)
    expect(presses(11_100)).toEqual([{ pad: undefined, start: 10_000, durationMs: 400 }])
  })

  it('window blur releases a key held on the keyboard', () => {
    setup()
    fire(window, 'keydown', { code: 'Space', key: ' ' }, 10_000)
    expect(input.isKeyDown).toBe(true)
    fire(window, 'blur', {}, 10_130)
    expect(input.isKeyDown).toBe(false)
    expect(presses(10_500)).toEqual([{ pad: undefined, start: 10_000, durationMs: 130 }])
  })

  it('hiding the page releases the held key and commits the press at the visibilitychange', () => {
    const { key } = setup()
    down(key, 1, 10_000)
    fire(document, 'visibilitychange', {}, 10_050) // still visible: nothing happens
    expect(input.isKeyDown).toBe(true)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    fire(document, 'visibilitychange', {}, 10_310)
    expect(input.isKeyDown).toBe(false)
    expect(presses(10_900)).toEqual([{ pad: undefined, start: 10_000, durationMs: 310 }])
  })

  it('hiding the page releases both pads at once, each with its own duration', () => {
    const { dot, dash } = setup({ mode: 'pad' })
    down(dot, 1, 10_000)
    down(dash, 2, 10_100)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    fire(document, 'visibilitychange', {}, 10_250)
    expect(input.padsDown).toEqual({ '.': false, '-': false })
    expect(presses(10_900)).toEqual([
      { pad: '.', start: 10_000, durationMs: 250 },
      { pad: '-', start: 10_100, durationMs: 150 },
    ])
  })

  it('a key can be pressed again straight after a forced release', () => {
    const { key } = setup()
    down(key, 1, 10_000)
    fire(key, 'pointercancel', { pointerId: 1 }, 10_080)
    down(key, 2, 10_200)
    up(key, 2, 10_270)
    expect(presses(10_600).map(p => p.durationMs)).toEqual([80, 70])
  })
})

describe('several pointers', () => {
  it('holds the two pads independently: overlapping presses keep their own start and end', () => {
    const { dot, dash } = setup({ mode: 'pad' })
    down(dot, 1, 10_000)
    down(dash, 2, 10_050)
    expect(input.padsDown).toEqual({ '.': true, '-': true })
    // The dash finger lifting doesn't release the dot, and vice versa.
    up(dash, 2, 10_120)
    expect(input.padsDown).toEqual({ '.': true, '-': false })
    up(dot, 1, 10_200)
    expect(presses(10_600)).toEqual([
      { pad: '-', start: 10_050, durationMs: 70 },
      { pad: '.', start: 10_000, durationMs: 200 },
    ])
  })

  it('ignores a second finger on a held key, including its release', () => {
    const { key } = setup()
    down(key, 1, 10_000)
    expect(down(key, 2, 10_040).defaultPrevented).toBe(true)
    up(key, 2, 10_060)
    expect(input.isKeyDown).toBe(true)
    up(key, 1, 10_300)
    expect(presses(10_700)).toEqual([{ pad: undefined, start: 10_000, durationMs: 300 }])
  })

  it('ignores a second finger on a held pad while the other pad works normally', () => {
    const { dot, dash } = setup({ mode: 'pad' })
    down(dot, 1, 10_000)
    down(dot, 2, 10_020) // ignored
    down(dash, 3, 10_030)
    up(dot, 2, 10_060) // ignored
    up(dash, 3, 10_110)
    expect(input.padsDown).toEqual({ '.': true, '-': false })
    up(dot, 1, 10_150)
    expect(presses(10_600)).toEqual([
      { pad: '-', start: 10_030, durationMs: 80 },
      { pad: '.', start: 10_000, durationMs: 150 },
    ])
  })

  it('a mouse button other than the main one is not a press', () => {
    const { key } = setup()
    fire(key, 'pointerdown', { pointerId: 1, button: 2, pointerType: 'mouse' }, 10_000)
    expect(input.isKeyDown).toBe(false)
  })
})

describe('iambic pad', () => {
  const WPM = 20
  const u = unitMsForWpm(WPM) // 60 ms

  // Iambic elements come off the keyer's own timer: fake timers, driven with the mocked clock.
  function setupIambic() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    return setup({ mode: 'pad', keyerMode: 'iambic', keyerWpm: WPM })
  }

  const elements = () => presses(clock.now + 5000).map(({ pad, start, durationMs }) => ({ pad, start, durationMs }))

  it('generates perfectly timed elements while a paddle is held, and shows the paddle held', () => {
    const { dot } = setupIambic()
    down(dot, 1, 10_000)
    expect(input.padsDown).toEqual({ '.': true, '-': false })
    clock.run(5 * 2 * u - 20) // part way into the fifth period
    up(dot, 1, clock.now)
    expect(input.padsDown).toEqual({ '.': false, '-': false })
    clock.run(10 * u)
    expect(elements()).toEqual([0, 1, 2, 3, 4].map(i => ({ pad: '.', start: 10_000 + i * 2 * u, durationMs: u })))
  })

  it('feeds a squeeze through as alternating elements', () => {
    const { dot, dash } = setupIambic()
    down(dot, 1, 10_000)
    down(dash, 2, 10_010)
    clock.run(9 * u)
    up(dot, 1, clock.now)
    up(dash, 2, clock.now)
    clock.run(10 * u)
    expect(elements().map(element => element.pad).join('')).toMatch(/^\.-\.-/)
  })

  for (const [how, letGo] of [
    ['a paddle release', ({ dot }) => up(dot, 1, clock.now)],
    ['a pointercancel', ({ dot }) => fire(dot, 'pointercancel', { pointerId: 1 }, clock.now)],
    ['window blur', () => fire(window, 'blur', {}, clock.now)],
    [
      'a hidden page',
      () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        fire(document, 'visibilitychange', {}, clock.now)
      },
    ],
  ]) {
    it(`stops generating within one element period of ${how}`, () => {
      const keys = setupIambic()
      down(keys.dot, 1, 10_000)
      clock.run(3 * 2 * u + u / 2) // half way through the fourth dot
      const stoppedAt = clock.now
      letGo(keys)
      clock.run(20 * u)
      const sent = elements()
      expect(sent.at(-1).start).toBeLessThanOrEqual(stoppedAt)
      expect(sent.at(-1).start + 2 * u).toBeGreaterThan(stoppedAt)
      expect(input.padsDown).toEqual({ '.': false, '-': false })
    })
  }

  describe('holds that send more than one element', () => {
    // 20 WPM: a dot period (dot plus its space) is 2u = 120 ms. The keyer decides at the end of each period.
    const holdDot = ms => {
      const { dot } = setupIambic()
      down(dot, 1, 10_000)
      clock.run(ms)
      up(dot, 1, clock.now)
      clock.run(10 * u)
      let run
      act(() => {
        run = input.finish()
      })
      return run
    }
    const repeats = run => run.anomalies.filter(anomaly => anomaly.type === 'hold-repeat')

    it('records a 396 ms dot hold at 20 WPM as one anomaly: four elements, its length and the period', () => {
      const run = holdDot(396)
      expect(run.marks).toHaveLength(4)
      expect(repeats(run)).toEqual([{ type: 'hold-repeat', t: 10_000, durationMs: 396, elements: 4, periodMs: 120 }])
    })

    it('records nothing for a 92 ms tap, which sends one element', () => {
      const run = holdDot(92)
      expect(run.marks).toHaveLength(1)
      expect(repeats(run)).toEqual([])
    })

    it('reports the anomaly to onFinalize too, when silence ends the run', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const onFinalize = vi.fn()
      const { dash } = setup({ mode: 'pad', keyerMode: 'iambic', keyerWpm: WPM, target: 'E', onFinalize })
      down(dash, 1, 10_000)
      clock.run(4 * u * 2 + 10) // two dash periods (4u each) and a little
      up(dash, 1, clock.now)
      clock.wait(70_000) // silence, nothing held: one jump is fine
      expect(onFinalize).toHaveBeenCalledTimes(1)
      expect(repeats(onFinalize.mock.calls[0][0])).toEqual([{ type: 'hold-repeat', t: 10_000, durationMs: 490, elements: 3, periodMs: 240 }])
    })

    it('does not report a squeeze, which alternates by design', () => {
      const { dot, dash } = setupIambic()
      down(dot, 1, 10_000)
      down(dash, 2, 10_010)
      clock.run(9 * u)
      up(dot, 1, clock.now)
      up(dash, 2, clock.now)
      clock.run(10 * u)
      let run
      act(() => {
        run = input.finish()
      })
      expect(run.marks.length).toBeGreaterThan(2)
      expect(repeats(run)).toEqual([])
    })
  })

  describe('when the page falls behind', () => {
    const finishRun = () => {
      let run
      act(() => {
        run = input.finish()
      })
      return run
    }
    const ofType = (run, type) => run.anomalies.filter(anomaly => anomaly.type === type)
    // A main-thread stall: `ms` pass with nothing running, then the keyer's timer fires late.
    const stall = ms => {
      clock.now += ms
      act(() => {
        vi.advanceTimersByTime(ms)
      })
    }

    it('a 2 s stall mid-hold sends nothing after the stall and records one keyer-stall', () => {
      const { dot } = setupIambic()
      down(dot, 1, 10_000)
      clock.run(130) // dots at 10_000 and 10_120; the next is due at 10_240
      stall(2000) // the timer for 10_240 fires at 12_130
      lateUp(dot, 1, 10_150) // the release, stamped during the stall, is handled after the timer
      clock.run(40 * u)
      const run = finishRun()
      expect(run.marks.map(mark => mark.start)).toEqual([10_000, 10_120])
      // Everything the keyer had decided on by 12_130 went unsent: dots due at 10_240, 10_360 … 12_040.
      expect(ofType(run, 'keyer-stall')).toEqual([{ type: 'keyer-stall', t: 10_240, driftMs: 1890, suppressed: 16 }])
      expect(ofType(run, 'hold-repeat')).toEqual([])
      expect(input.pulses).toEqual({ '.': 2, '-': 0 })
      expect(input.padsDown).toEqual({ '.': false, '-': false })
    })

    it('treats the paddle as released after a stall: a paddle still down sends nothing more, the next press works at once', () => {
      const { dot, dash } = setupIambic()
      down(dot, 1, 10_000)
      clock.run(130)
      stall(2000)
      clock.run(1000) // the finger never lifted, but the keyer has let go
      down(dash, 2, clock.now)
      clock.run(100)
      up(dash, 2, clock.now)
      clock.run(10 * u)
      const run = finishRun()
      expect(run.marks.map(mark => mark.fixedSymbol).join('')).toBe('..-')
      expect(run.marks.at(-1).start).toBe(13_130)
      expect(ofType(run, 'keyer-stall')).toHaveLength(1)
    })

    it('drops dot memory queued before a stall instead of sending it late', () => {
      const { dot, dash } = setupIambic()
      down(dash, 1, 10_000) // a dash 10_000 to 10_180; its period ends at 10_240
      down(dot, 2, 10_050) // dot memory: a dot is owed at 10_240
      up(dot, 2, 10_070)
      clock.run(100) // 10_170: still in the dash
      stall(2000)
      lateUp(dash, 1, 10_300)
      clock.run(20 * u)
      const run = finishRun()
      expect(run.marks.map(mark => mark.fixedSymbol).join('')).toBe('-')
      expect(ofType(run, 'keyer-stall')).toEqual([expect.objectContaining({ t: 10_240 })])
    })

    it('still sends the element a late press starts, at its stamp, and guesses no repeats while its release is on the way', () => {
      const { dot } = setupIambic()
      clock.now = 10_400
      lateDown(dot, 1, 10_000) // stamped 10_000, reaching the page 400 ms late: three dot periods have passed
      expect(input.pulses).toEqual({ '.': 1, '-': 0 })
      clock.run(50)
      lateUp(dot, 1, 10_050) // its release, just as late
      clock.run(20 * u)
      const run = finishRun()
      expect(run.marks.map(({ start, durationMs }) => ({ start, durationMs }))).toEqual([{ start: 10_000, durationMs: u }])
      expect(ofType(run, 'keyer-stall')).toEqual([])
    })

    it('past the longest it can wait for a release, sends only what presses start and records the stall', () => {
      const { dot } = setupIambic()
      clock.now = 10_700
      lateDown(dot, 1, 10_000) // 700 ms late: longer than any decision delay
      clock.run(50)
      lateUp(dot, 1, 10_050)
      clock.run(20 * u)
      const run = finishRun()
      expect(run.marks.map(mark => mark.start)).toEqual([10_000])
      expect(ofType(run, 'keyer-stall')).toEqual([{ type: 'keyer-stall', t: 10_120, driftMs: 700, suppressed: 1 }])
    })

    it('waits for releases as late as recent paddle events have been before deciding a repeat', () => {
      const { dot } = setupIambic()
      // Input is reaching the page 150 ms late while the keyer's own timer runs on time.
      clock.now = 10_150
      lateDown(dot, 1, 10_000)
      clock.run(30)
      lateUp(dot, 1, 10_030)
      clock.run(400)
      const second = clock.now // 10_580
      clock.run(150)
      lateDown(dot, 2, second) // 150 ms late again
      clock.run(30)
      lateUp(dot, 2, second + 30) // stamped well before this dot's period ends at second + 120, handled at second + 180
      clock.run(20 * u)
      const run = finishRun()
      expect(run.marks.map(mark => mark.start)).toEqual([10_000, second])
      expect(ofType(run, 'keyer-stall')).toEqual([])
    })

    it('never sends more than 8 elements for one hold, and reports the hold as capped rather than as a stall', () => {
      const { dot } = setupIambic()
      down(dot, 1, 10_000)
      clock.run(2000) // held, page keeping up: 16 dot periods
      expect(input.padsDown).toEqual({ '.': false, '-': false })
      up(dot, 1, clock.now)
      clock.run(10 * u)
      const run = finishRun()
      expect(run.marks).toHaveLength(8)
      expect(ofType(run, 'hold-repeat')).toEqual([{ type: 'hold-repeat', t: 10_000, durationMs: 960, elements: 8, periodMs: 120, capped: true }])
      expect(ofType(run, 'keyer-stall')).toEqual([])
    })
  })

  it('pulses once per generated element, never for the paddle press itself', () => {
    const { dot, dash } = setupIambic()
    expect(input.pulses).toEqual({ '.': 0, '-': 0 })
    down(dash, 1, 10_000) // a dash: 3u, then its space
    expect(input.pulses).toEqual({ '.': 0, '-': 1 })
    // The dot paddle tapped during the dash: dot memory, so the dot goes out only after the dash's space.
    down(dot, 2, 10_060)
    up(dot, 2, 10_080)
    up(dash, 1, 10_100)
    expect(input.pulses).toEqual({ '.': 0, '-': 1 })
    clock.run(4 * u - 100 - 1) // just before the dash's period ends
    expect(input.pulses).toEqual({ '.': 0, '-': 1 })
    clock.run(1)
    expect(input.pulses).toEqual({ '.': 1, '-': 1 })
    // A held paddle: one pulse per element it sends, and none on the press or release.
    down(dot, 3, clock.now + 5 * u)
    expect(input.pulses).toEqual({ '.': 2, '-': 1 })
    clock.run(2 * u * 3 - 10) // two more periods begin while held
    up(dot, 3, clock.now)
    clock.run(10 * u)
    expect(input.pulses).toEqual({ '.': 4, '-': 1 })
    expect(presses(clock.now).length).toBe(5)
  })

  it('lets a squeeze released with a pointercancel end without a Mode B element', () => {
    const { dot, dash } = setupIambic()
    down(dot, 1, 10_000)
    down(dash, 2, 10_010)
    clock.run(3 * u) // in the dash (2u..5u)
    fire(dot, 'pointercancel', { pointerId: 1 }, clock.now)
    fire(dash, 'pointercancel', { pointerId: 2 }, clock.now)
    clock.run(20 * u)
    expect(elements().map(element => element.pad).join('')).toBe('.-')
  })
})

describe('iambic is the pad only', () => {
  it('reads a straight-key run from real press durations even with the iambic keyer set', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { key } = setup({ mode: 'key', keyerMode: 'iambic', keyerWpm: 20 })
    // Durations no 20 WPM keyer would generate (its unit is 60 ms).
    down(key, 1, 10_000)
    up(key, 1, 10_037)
    down(key, 1, 10_300)
    up(key, 1, 10_551)
    fire(window, 'keydown', { key: ' ', code: 'Space' }, 11_000)
    clock.wait(500) // anything a keyer would generate has had time to appear
    fire(window, 'keyup', { key: ' ', code: 'Space' }, 11_133)
    clock.wait(2000)
    expect(presses()).toEqual([
      { pad: undefined, start: 10_000, durationMs: 37 },
      { pad: undefined, start: 10_300, durationMs: 251 },
      { pad: undefined, start: 11_000, durationMs: 133 },
    ])
  })

  it('stops routing presses through the keyer the moment the mode switches to straight key', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const view = render(<Harness mode="pad" keyerMode="iambic" keyerWpm={20} />)
    const dot = view.getByTestId('dot')
    down(dot, 1, 10_000)
    clock.run(3 * 120 - 10) // three generated dots
    up(dot, 1, clock.now)
    clock.wait(1000)
    view.rerender(<Harness mode="key" keyerMode="iambic" keyerWpm={20} />)
    const key = view.getByTestId('key')
    down(key, 2, 20_000)
    up(key, 2, 20_410)
    clock.wait(2000)
    const marks = presses()
    expect(marks.slice(0, 3).every(mark => mark.pad === '.' && mark.durationMs === 60)).toBe(true)
    expect(marks.slice(3)).toEqual([{ pad: undefined, start: 20_000, durationMs: 410 }])
  })
})

describe('Enter', () => {
  it('has no binding of its own in pad mode: it neither ends a letter nor undoes', () => {
    setup({ mode: 'pad', undoEnabled: true })
    fire(window, 'keydown', { key: '.', code: 'Period' }, 10_000)
    fire(window, 'keyup', { key: '.', code: 'Period' }, 10_060)
    const before = input.strip
    const enter = fire(window, 'keydown', { key: 'Enter', code: 'Enter' }, 10_200)
    fire(window, 'keyup', { key: 'Enter', code: 'Enter' }, 10_260)
    expect(enter.defaultPrevented).toBe(false)
    expect(input.strip).toBe(before)
    const run = input.finish()
    expect(run.log.map(event => event.type)).toEqual(['down', 'up', 'finish'])
  })
})
