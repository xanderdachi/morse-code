// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClock } from '../testing/dom.js'
import { useMorseInput } from './useMorseInput.js'

let clock
let input

beforeEach(() => {
  clock = mockClock()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete document.visibilityState
})

function Harness(options) {
  const live = useMorseInput({ target: 'PARIS', ...options })
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
