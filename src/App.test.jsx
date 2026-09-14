// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MotionGlobalConfig } from 'framer-motion'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClock } from './testing/dom.js'
import { fakeMatchMedia } from './testing/fakeMatchMedia.js'

// No network: the board comes from the bundled passages.
vi.mock('./lib/supabase.js', () => ({ supabase: null }))

const STORAGE_KEY = 'morse-club-v1'

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true
})

beforeEach(() => {
  localStorage.clear()
  // progress.js keeps a copy in memory; each test starts from a fresh page load.
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function loadApp() {
  const { default: App } = await import('./App.jsx')
  const view = render(<App />)
  // Wait for the board: the passage pill shows a title once it has loaded.
  await waitFor(() => expect(screen.queryByText('Loading passages')).toBeNull())
  return { App, ...view }
}

function seed(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
}

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY))
const intro = () => screen.queryByRole('dialog', { name: /Welcome to Morse Club|Nice E!/ })

describe('first-visit intro', () => {
  it('shows on a first visit, persists its dismissal, and stays away after a reload', async () => {
    const { unmount } = await loadApp()
    expect(intro()).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(intro()).toBeNull())
    expect(stored().onboardingSeen).toBe(true)

    unmount()
    vi.resetModules()
    await loadApp()
    expect(intro()).toBeNull()
  })

  it('counts finishing the cards as seen too', async () => {
    await loadApp()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start sending' }))
    await waitFor(() => expect(intro()).toBeNull())
    expect(stored().onboardingSeen).toBe(true)
  })

  it('never shows to a returning player, including one whose progress predates the intro', async () => {
    seed({ tier: 2, clearedPassageIds: ['hamlet'], inputMode: 'pad' })
    await loadApp()
    expect(intro()).toBeNull()
  })

  it('re-opens from settings as "Show intro again"', async () => {
    seed({ onboardingSeen: true })
    await loadApp()
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show intro again' }))
    await waitFor(() => expect(intro()).not.toBeNull())
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })

  it('shows once and moves on when localStorage throws', async () => {
    const fail = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail, clear: fail })
    const { App, unmount } = await loadApp()
    expect(intro()).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(intro()).toBeNull())

    // Settings and back, then the whole app mounting again in the same session: no repeat.
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    unmount()
    render(<App />)
    await waitFor(() => expect(screen.queryByText('Loading passages')).toBeNull())
    expect(intro()).toBeNull()
  })
})

describe('the intro and a run in progress', () => {
  it('cannot be opened mid-run, and never renders over one', async () => {
    seed({ onboardingSeen: true })
    await loadApp()

    // Start a run on the spacebar.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true }))
    })
    await new Promise(resolve => setTimeout(resolve, 60))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', cancelable: true }))
    })
    expect(screen.getByText('Keep it coming.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    const showIntro = screen.getByRole('button', { name: 'Show intro again' })
    expect(showIntro.disabled).toBe(true)
    fireEvent.click(showIntro)
    expect(intro()).toBeNull()
    expect(screen.getByText('Available once this run is over.')).toBeTruthy()

    // Starting over ends the run, and the intro can be opened again.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    expect(screen.getByRole('button', { name: 'Show intro again' }).disabled).toBe(false)
  })

  it('counts a press still held on the touch key as a run in progress', async () => {
    seed({ onboardingSeen: true, touchControls: 'on' })
    await loadApp()
    const clock = mockClock(50_000)
    clock.fire(screen.getByRole('button', { name: /Morse key/ }), 'pointerdown', { pointerId: 1 })
    // A second finger reaches Setup while the first still holds the key.
    clock.now += 300
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    expect(screen.getByRole('button', { name: 'Show intro again' }).disabled).toBe(true)
    expect(intro()).toBeNull()
  })
})

describe('touch controls', () => {
  const docked = () => document.querySelector('[data-touch-keys="docked"]')

  it('switch layout when the pointer changes, without a reload', async () => {
    seed({ onboardingSeen: true })
    const media = fakeMatchMedia(false)
    vi.stubGlobal('matchMedia', media.matchMedia)
    await loadApp()
    expect(docked()).toBeNull()
    expect(screen.getByText(/Keyboard: hold space for the key/)).toBeTruthy()

    act(() => media.setCoarse(true))
    expect(docked()).not.toBeNull()
    expect(screen.queryByText(/Keyboard: hold space for the key/)).toBeNull()
    expect(screen.getAllByRole('button', { name: /Morse key/ })).toHaveLength(1)

    act(() => media.setCoarse(false))
    expect(docked()).toBeNull()
  })

  it('obey the settings override, persisted', async () => {
    seed({ onboardingSeen: true })
    const media = fakeMatchMedia(true)
    vi.stubGlobal('matchMedia', media.matchMedia)
    await loadApp()
    expect(docked()).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Touch controls' })).getByRole('button', { name: 'Off' }))
    expect(stored().touchControls).toBe('off')
    expect(docked()).toBeNull()
  })

  it('dock both pads in pad mode, dot first', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad', touchControls: 'on' })
    await loadApp()
    const keys = [...docked().querySelectorAll('button')].map(button => button.getAttribute('aria-label') ?? button.textContent)
    expect(keys).toEqual(['Dot', 'end letter', 'Dash'])
  })
})

// These key a whole run through the real App, which takes a few seconds in jsdom.
describe('misinput during a run', { timeout: 20_000 }, () => {
  // Pad mode on the keyboard: '.' and '-' are elements, space ends a letter. Every press 60 ms long, 60 ms apart.
  function keyPad(clock, sequence) {
    for (const key of sequence) {
      if (key === ' ') {
        clock.fire(window, 'keydown', { key: ' ', code: 'Space' }, clock.now + 60)
        clock.fire(window, 'keyup', { key: ' ', code: 'Space' }, clock.now + 10)
      } else {
        const code = key === '.' ? 'Period' : 'Minus'
        clock.fire(window, 'keydown', { key, code }, clock.now + 60)
        clock.fire(window, 'keyup', { key, code }, clock.now + 60)
      }
    }
  }

  const sentCounter = () => screen.getByText('Sent').parentElement.lastElementChild.textContent.replace(/\s+/g, ' ').trim()

  it('never shows more letters sent than the passage has', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp() // Hamlet: "To be, or not to be." is 15 letters
    const clock = mockClock(50_000)
    keyPad(clock, '. '.repeat(24))
    expect(sentCounter()).toBe('15 / 15')
  })

  it('acknowledges the error prosign calmly, from Pip', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp()
    const clock = mockClock(50_000)
    keyPad(clock, '- -- ')
    expect(sentCounter()).toBe('2 / 15')
    keyPad(clock, '........')
    expect(screen.getByText('Disregarded. Carry on from there.')).toBeTruthy()
    expect(sentCounter()).toBe('1 / 15')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('iambic keyer settings', () => {
  it('switches the pad to iambic, persists its speed, and shows the speed near the mode toggle', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp()
    expect(screen.queryByText(/Iambic keyer ·/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Pad keyer' })).getByRole('button', { name: 'Iambic' }))
    fireEvent.change(screen.getByRole('slider'), { target: { value: '32' } })
    expect(stored()).toMatchObject({ keyerMode: 'iambic', keyerWpm: 32 })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.getByText('Iambic keyer · 32 wpm')).toBeTruthy())
    // The live speed tile reports the keyer's chosen speed, not a measured one.
    expect(screen.getByText('Keyer')).toBeTruthy()
    expect(screen.queryByText('Pace')).toBeNull()
  })
})
