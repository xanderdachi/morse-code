// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MotionGlobalConfig } from 'framer-motion'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { leniencyFor } from '../lib/progress.js'
import { mockClock } from '../testing/dom.js'
import OnboardingModal from './OnboardingModal.jsx'

let clock

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'queueMicrotask'] })
  clock = mockClock()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderIntro(props = {}) {
  const onClose = vi.fn()
  const view = render(<OnboardingModal open onClose={onClose} touch={false} mode="key" errorGapUnits={leniencyFor(1).errorGapUnits} {...props} />)
  return { ...view, onClose }
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))
const pipSays = text => screen.getByText(text, { exact: false })

function toTryStep() {
  next()
  next()
  pipSays('send me an E')
}

function expectFinalCard() {
  pipSays('Mistakes only show up after the run')
  expect(screen.getByRole('heading', { name: 'Nice E!' })).toBeTruthy()
}

describe('intro cards', () => {
  it('walks through four cards from Pip, ending on what happens after a run', () => {
    renderIntro()
    pipSays('passages of world literature')
    next()
    pipSays('spacebar is the telegraph key')
    next()
    pipSays('send me an E')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    pipSays('pausing to think costs you nothing')
    expect(screen.getByText(/Eight quick dots/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Welcome to Morse Club' })).toBeTruthy()
  })

  it('shows the controls this device will use', () => {
    const cases = [
      [{ touch: true, mode: 'key' }, 'round key at the bottom of your screen', 'Morse key: hold briefly for a dot, longer for a dash'],
      [{ touch: true, mode: 'pad' }, 'dot on the left and dash on the right', 'Dot'],
      [{ touch: false, mode: 'key' }, 'spacebar is the telegraph key', null],
      [{ touch: false, mode: 'pad' }, 'full stop for a dot and the hyphen for a dash', null],
    ]
    for (const [props, line, keyLabel] of cases) {
      const { container, unmount } = renderIntro(props)
      next()
      pipSays(line)
      // The picture of the touch keys is only on touch devices.
      expect(document.querySelector('[data-touch-keys]') !== null).toBe(keyLabel !== null)
      unmount()
      expect(container.textContent).toBe('')
    }
  })

  it('can be closed at every step, by the close button or Escape', () => {
    for (let step = 0; step < 4; step++) {
      for (const how of ['button', 'escape']) {
        const { onClose, unmount } = renderIntro()
        for (let i = 0; i < step; i++) {
          fireEvent.click(screen.getByRole('button', { name: i === 2 ? 'Skip' : 'Next' }))
        }
        if (how === 'button') fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        else fireEvent.keyDown(window, { key: 'Escape' })
        expect(onClose, `step ${step + 1} by ${how}`).toHaveBeenCalledTimes(1)
        unmount()
      }
    }
  })
})

describe('try it', () => {
  it('accepts an E from the spacebar in straight key mode', () => {
    renderIntro({ touch: false, mode: 'key' })
    toTryStep()
    clock.press(' ', { durationMs: 70 })
    expectFinalCard()
  })

  it('accepts an E from the full stop in pad mode', () => {
    renderIntro({ touch: false, mode: 'pad' })
    toTryStep()
    clock.press('.')
    expectFinalCard()
  })

  it('accepts an E tapped on the touch key in straight key mode', () => {
    renderIntro({ touch: true, mode: 'key' })
    toTryStep()
    clock.tap(screen.getByRole('button', { name: /Morse key/ }), { durationMs: 90 })
    expectFinalCard()
  })

  it('accepts an E tapped on the dot key in pad mode', () => {
    renderIntro({ touch: true, mode: 'pad' })
    toTryStep()
    clock.tap(screen.getByRole('button', { name: 'Dot' }))
    expectFinalCard()
  })

  it('accepts a click on the spacebar keycap too', () => {
    renderIntro({ touch: false, mode: 'key' })
    toTryStep()
    clock.tap(screen.getByRole('button', { name: 'Spacebar' }), { pointerType: 'mouse' })
    expectFinalCard()
  })

  it('asks again after a wrong letter, then moves on with an E', () => {
    renderIntro({ touch: false, mode: 'key' })
    toTryStep()
    clock.press(' ', { durationMs: 420 }) // a dash: T
    clock.wait(1000)
    pipSays('Not quite')
    expect(screen.getByText('nothing yet')).toBeTruthy() // the wire is cleared for another go

    clock.press(' ', { at: clock.now + 500, durationMs: 80 })
    expectFinalCard()
  })

  it('ignores keying on the other cards', () => {
    renderIntro({ touch: false, mode: 'key' })
    clock.press(' ')
    next()
    clock.press(' ')
    pipSays('spacebar is the telegraph key')
    next()
    // Nothing sent earlier carried over to the live card.
    expect(screen.getByText('nothing yet')).toBeTruthy()
  })
})
