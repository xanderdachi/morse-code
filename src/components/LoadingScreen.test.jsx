// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENTRY_MS, LOOP_MS, RESOLVE_MS, STRIKE, beatAt, drawBlob, longRamp, resolveStartFor } from '../lib/blob.js'
import { extent, recordingContext, stubCanvas } from '../testing/canvas.js'
import { fakeFrames, mockClock } from '../testing/dom.js'
import LoadingScreen from './LoadingScreen.jsx'

// Kept in step with the component's own constants.
const MIN_ON_SCREEN_MS = 400
const MAX_BEAT_WAIT_MS = 900

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubReducedMotion() {
  vi.stubGlobal('matchMedia', query => ({
    media: query,
    matches: query.includes('prefers-reduced-motion'),
    addEventListener() {},
    removeEventListener() {},
  }))
}

/**
 * Mount the loader, flip `ready` once `readyAt` ms of screen time have passed
 * (never, if null), and run frames until it hands over or `limitMs` is up.
 *
 * Frames are 8ms so the loader observes `ready` within 8ms of it being true;
 * every timing assertion below allows for that.
 */
function drive({ readyAt = null, reduced = false, limitMs = 24_000, stepMs = 8 } = {}) {
  const clock = mockClock(0)
  if (reduced) stubReducedMotion()
  const ctx = stubCanvas()
  const frames = fakeFrames(clock)

  let doneAt = null
  const onDone = vi.fn(() => {
    doneAt = clock.now
  })

  const view = render(<LoadingScreen ready={readyAt === 0} onDone={onDone} />)
  let flipped = readyAt === 0

  while (doneAt === null && clock.now < limitMs) {
    if (!flipped && readyAt !== null && clock.now >= readyAt) {
      act(() => view.rerender(<LoadingScreen ready onDone={onDone} />))
      flipped = true
    }
    frames.step(stepMs)
  }

  return {
    ...view,
    ctx,
    frames,
    clock,
    onDone,
    doneAt,
    wordmarkOpacity: () => Number(view.getByText('Morse Club').style.opacity),
    rootOpacity: () => view.container.firstChild.style.opacity,
  }
}

describe('the loop', () => {
  it('totals 3810ms', () => {
    expect(LOOP_MS).toBe(3810)
  })

  it('contains exactly one strike, and nothing moves the body but it', () => {
    // Count the stretches of loop where the body is anything but round, over
    // two passes so the wrap is covered too.
    const moves = []
    for (let t = 0; t < LOOP_MS * 2; t += 5) {
      const ctx = recordingContext()
      drawBlob(ctx, 800, 600, ENTRY_MS + t)
      const { min, max } = extent(ctx.frames[0])
      const moving = max - min > 1e-9
      if (moving && (moves.length === 0 || moves.at(-1).to !== t - 5)) moves.push({ from: t, to: t })
      else if (moving) moves.at(-1).to = t
    }

    expect(moves).toHaveLength(2)
    // Anticipation, strike and settle, one after another from 1400ms to 2310ms.
    // The anticipation eases out of rest, so the body is still round at 1400.
    expect(moves[0].from).toBe(1405)
    expect(moves[0].to).toBe(2305)
    expect(moves[1].from).toBe(LOOP_MS + 1405)

    const strikes = new Set()
    for (let t = 0; t < LOOP_MS; t += 1) if (beatAt(t).beat.t === 'str') strikes.add(beatAt(t).index)
    expect(strikes.size).toBe(1)
  })

  it('keeps the strike tuning in one place', () => {
    expect(STRIKE).toEqual({ m: 0.85, dk: 3.6, f: 5.6 })
  })
})

describe('handing over', () => {
  // The times the loader has to cope with: inside the entry, just after it,
  // mid-rest, the second rest, and deep into the long wait.
  it.each([100, 700, 2000, 3000, 9000])('ready at %ims resolves cleanly', readyAt => {
    const run = drive({ readyAt })

    expect(run.onDone).toHaveBeenCalledTimes(1)
    expect(run.wordmarkOpacity()).toBe(1)
    // A resolve, not the cross-fade escape: the loader never faded out.
    expect(run.rootOpacity()).toBe('')
    expect(run.doneAt).toBeGreaterThanOrEqual(readyAt + RESOLVE_MS)
    expect(run.doneAt).toBeLessThanOrEqual(readyAt + MAX_BEAT_WAIT_MS + RESOLVE_MS + 2 * 8)
  })

  it('fades the wordmark in last, and only reaches full opacity at the hand-over', () => {
    const run = drive({ readyAt: 2000 })
    const dotted = run.ctx.frames.filter(frame => frame.dots.length > 0)

    // Dots before wordmark: the wordmark is still invisible when they start.
    expect(dotted.length).toBeGreaterThan(0)
    expect(run.wordmarkOpacity()).toBe(1)
    // The body ends orange, having started teal.
    expect(run.ctx.frames[0].stops).toEqual(['#5FD3C4', '#12A594', '#0C8074'])
    expect(run.ctx.frames.at(-1).stops).toEqual(['rgb(255,199,118)', 'rgb(255,159,28)', 'rgb(224,127,8)'])
  })

  it('holds for the minimum on-screen time when the app is ready immediately', () => {
    const run = drive({ readyAt: 0 })

    expect(run.doneAt).toBeGreaterThanOrEqual(MIN_ON_SCREEN_MS)
    // Ready before the entry finishes: finish the entry, then resolve from it. The resolve starts on the first
    // frame at or after the entry's end: 8 ms frames and an 820 ms entry hand over at 824 + 1200 = 2024 ms.
    const FRAME_MS = 8
    expect(run.doneAt).toBe(Math.ceil(ENTRY_MS / FRAME_MS) * FRAME_MS + RESOLVE_MS)
    expect(run.doneAt).toBe(2024)
  })

  // Loop time runs from the end of the entry, so these are offset by ENTRY_MS.
  // Into the loop: anticipation 1400-1500, strike 1500-1670, settle 1670-2310.
  it.each([
    ['mid-anticipation', 1450, 50],
    ['at the top of the strike', 1500, 170],
    ['mid-strike', 1585, 85],
    ['at the top of the settle, the longest beat there is', 1670, 640],
    ['mid-settle', 1990, 320],
  ])('ready %s waits out only the rest of that beat', (_where, intoLoop, restOfBeat) => {
    const readyAt = ENTRY_MS + intoLoop
    const run = drive({ readyAt })

    // Frames are 8ms apart, so the hand-over lands on the first frame after.
    // (The planned wait is exact; the sweep below holds it to 640ms at most.)
    const delay = run.doneAt - readyAt - RESOLVE_MS
    expect(delay).toBeGreaterThanOrEqual(restOfBeat)
    expect(delay).toBeLessThan(restOfBeat + 8)
    expect(run.wordmarkOpacity()).toBe(1)
  })
})

describe('when resolve is allowed to start', () => {
  it('cuts in at once during a rest and waits out any move in progress', () => {
    let worstWait = 0

    for (let t = ENTRY_MS; t < ENTRY_MS + LOOP_MS * 2; t += 5) {
      const { beat } = beatAt(t - ENTRY_MS, longRamp(t))
      const wait = resolveStartFor(t, { floorMs: MIN_ON_SCREEN_MS }) - t

      expect(wait).toBeGreaterThanOrEqual(0)
      if (beat.t === 'rest') expect(wait).toBe(0)
      else worstWait = Math.max(worstWait, wait)
    }

    // One settle, so the cross-fade escape past MAX_BEAT_WAIT_MS stays a guard.
    expect(worstWait).toBeCloseTo(640, 6)
    expect(worstWait).toBeLessThanOrEqual(MAX_BEAT_WAIT_MS)
  })

  it('skips the loop entirely when ready arrives during the entry', () => {
    for (const t of [0, 100, 320, 639]) {
      expect(resolveStartFor(t, { floorMs: MIN_ON_SCREEN_MS })).toBe(ENTRY_MS)
    }
  })
})

describe('the frame loop', () => {
  it('stops on unmount, leaving nothing queued and nothing drawn after', () => {
    const clock = mockClock(0)
    const ctx = stubCanvas()
    const frames = fakeFrames(clock)
    const view = render(<LoadingScreen ready={false} onDone={() => {}} />)

    frames.step()
    frames.step()
    expect(frames.queued).toBe(1)
    const drawn = ctx.frames.length

    act(() => view.unmount())

    expect(frames.queued).toBe(0)
    frames.step()
    expect(ctx.frames.length).toBe(drawn)
  })

  it('stops while the tab is hidden and resumes where it left off', () => {
    const clock = mockClock(0)
    const ctx = stubCanvas()
    const frames = fakeFrames(clock)
    let visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    render(<LoadingScreen ready={false} onDone={() => {}} />)

    frames.step(100) // 100ms in: still falling through the entry.

    visibility = 'hidden'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(frames.queued).toBe(0)

    const drawn = ctx.frames.length
    clock.now += 5000 // Backgrounded for five seconds: no frames, no battery.
    expect(ctx.frames.length).toBe(drawn)

    visibility = 'visible'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(frames.queued).toBe(1)

    // Time off screen didn't age the animation: the next frame is the one 8ms
    // after the last, not the one 5008ms after it (which would be past the
    // entry entirely, with the body sat at the centre of the screen).
    frames.step(8)
    const continuous = recordingContext()
    drawBlob(continuous, 1024, 768, 108, { entry: 108 / ENTRY_MS, long: longRamp(108) })
    expect(ctx.frames.at(-1).origin[1]).toBeCloseTo(continuous.frames[0].origin[1], 6)
    expect(ctx.frames.at(-1).origin[1]).toBeLessThan(768 / 2)
  })
})

describe('reduced motion', () => {
  it('renders no strikes: a breathing circle and nothing else', () => {
    const run = drive({ reduced: true, limitMs: ENTRY_MS + LOOP_MS })

    for (const frame of run.ctx.frames) {
      const { min, max } = extent(frame)
      expect(max - min).toBeLessThan(1e-9) // A circle: no stretch, no squash.
    }

    const radii = run.ctx.frames.map(frame => extent(frame).max)
    // Only the breath moves it, and the breath is +/-1%.
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii))
    expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(1.021)
  })

  it('is measuring something: the full loop does strike', () => {
    const run = drive({ limitMs: ENTRY_MS + LOOP_MS })
    const worst = Math.max(...run.ctx.frames.map(frame => extent(frame).max / extent(frame).min))

    expect(worst).toBeGreaterThan(2)
  })

  it('still resolves to a fully visible wordmark', () => {
    const run = drive({ readyAt: 500, reduced: true })

    expect(run.onDone).toHaveBeenCalledTimes(1)
    expect(run.wordmarkOpacity()).toBe(1)
  })

  it('resolves without the compress', () => {
    // A tenth of the way into the resolve is where the compress is strongest,
    // and 1540ms is a rest beat, so nothing else is distorting the body.
    const shape = restOnly => {
      const ctx = recordingContext()
      drawBlob(ctx, 800, 600, 1540, { resolve: 0.1, restOnly })
      return extent(ctx.frames[0])
    }

    expect(shape(false).max / shape(false).min).toBeGreaterThan(1.7)
    expect(shape(true).max - shape(true).min).toBeLessThan(1e-9)
  })
})

describe('the long wait', () => {
  it('stretches the rest beats to 1.33x and leaves the moves alone', () => {
    expect(beatAt(0, 0).beat.d).toBe(1400)
    expect(beatAt(0, 1).beat.d).toBeCloseTo(1400 * 1.33, 6)
    expect(beatAt(3000, 1).beat.d).toBeCloseTo(1500 * 1.33, 6)
    expect(beatAt(1450, 0).beat.t).toBe('ant')
    expect(beatAt(1450, 0).beat.d).toBe(100)
    // The same anticipation under the stretch, still 100ms: only rests stretch.
    expect(beatAt(1520, 1).beat.t).toBe('ant')
    expect(beatAt(1520, 1).beat.d).toBe(100)
  })

  it('keeps one pass of the loop at LOOP_MS, so rests just take more of it', () => {
    const restShare = long => {
      let rest = 0
      for (let t = 0; t < LOOP_MS; t += 1) if (beatAt(t, long).beat.t === 'rest') rest += 1
      return rest / LOOP_MS
    }

    expect(restShare(0)).toBeCloseTo(2900 / LOOP_MS, 2)
    expect(restShare(1)).toBeGreaterThan(restShare(0))
  })
})
