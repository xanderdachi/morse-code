// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MotionGlobalConfig } from 'framer-motion'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubCanvas } from './testing/canvas.js'
import { fakeFrames, mockClock } from './testing/dom.js'
import { fakeMatchMedia } from './testing/fakeMatchMedia.js'
import { IAMBIC_ENABLED } from './lib/features.js'

// No network: the board comes from the bundled passages.
vi.mock('./lib/supabase.js', () => ({ supabase: null }))

const STORAGE_KEY = 'morse-club-v1'

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true
})

beforeEach(() => {
  // The loading screen draws to a canvas jsdom doesn't implement.
  stubCanvas()
  localStorage.clear()
  // progress.js keeps a copy in memory; each test starts from a fresh page load.
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
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

describe('run dump (?dump)', { timeout: 20_000 }, () => {
  function keyEs(clock, count) {
    for (let i = 0; i < count; i++) {
      clock.fire(window, 'keydown', { key: '.', code: 'Period' }, clock.now + 60)
      clock.fire(window, 'keyup', { key: '.', code: 'Period' }, clock.now + 60)
      clock.fire(window, 'keydown', { key: ' ', code: 'Space' }, clock.now + 60)
      clock.fire(window, 'keyup', { key: ' ', code: 'Space' }, clock.now + 10)
    }
  }

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('keeps each finished run with its keystroke log and raw events', async () => {
    window.history.replaceState(null, '', '/?dump')
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp()
    expect(screen.getByText('Run dump: 0 saved')).toBeTruthy()
    const clock = mockClock(50_000)
    keyEs(clock, 15)
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }))

    const [run] = JSON.parse(localStorage.getItem('morse-club-run-dump'))
    expect(run.sent).toBe('EEEEEEEEEEEEEEE')
    expect(run.log.filter(entry => entry.type === 'down' && entry.pad === '.')).toHaveLength(15)
    // The log's times are the events' stamps, and the trace has every one of them.
    const stamps = new Set(run.events.map(event => event.stamp))
    expect(run.log.every(entry => stamps.has(entry.t))).toBe(true)
    expect(screen.getByText('Run dump: 1 saved')).toBeTruthy()
  })

  it('keeps nothing and shows nothing without ?dump', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp()
    const clock = mockClock(50_000)
    keyEs(clock, 15)
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }))
    expect(localStorage.getItem('morse-club-run-dump')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Run dump' })).toBeNull()
  })
})

// The keyer's own controls. Skipped while IAMBIC_ENABLED is false, and must pass again the moment it is true.
// The shipping state: the keyer is written and tested, and no player can reach it.
describe.skipIf(IAMBIC_ENABLED)('the iambic keyer is off for launch', () => {
  const marks = () =>
    [...document.querySelectorAll('section[aria-label=Transmission] span.rounded-full')].filter(
      node => !String(node.className).includes('animate-caret'),
    )

  it('offers no keyer controls in settings, on the pad where they would otherwise be', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp()
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))

    // Gone, not disabled: a greyed-out control only raises the question of what it would have done.
    expect(screen.queryByRole('group', { name: 'Pad keyer' })).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Iambic' })).toBeNull()
    // Nor is the mode named anywhere in the settings copy.
    expect(screen.getByRole('dialog').textContent).not.toMatch(/iambic/i)
  })

  it('moves a player stored in iambic back to the manual pad, keeping their speed', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad', keyerMode: 'iambic', keyerWpm: 27, touchControls: 'off' })
    await loadApp()

    // No readout, and the speed tile measures the operator again instead of reporting a chosen speed.
    expect(screen.queryByText(/Iambic keyer ·/)).toBeNull()
    expect(screen.getByText('Pace')).toBeTruthy()
    expect(screen.queryByText('Keyer')).toBeNull()

    // And the pad really is manual: one press is one element however long it is held,
    // where the keyer would have repeated it for as long as the pad stayed down.
    const clock = mockClock(50_000)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    clock.fire(window, 'keydown', { key: '.', code: 'Period' }, clock.now + 50)
    clock.run(480)
    clock.fire(window, 'keyup', { key: '.', code: 'Period' }, clock.now)
    clock.run(200)
    expect(marks()).toHaveLength(1)
  })

  it('does not leave iambic in storage once the app has saved anything', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad', keyerMode: 'iambic', keyerWpm: 27 })
    await loadApp()
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    fireEvent.click(within(screen.getAllByRole('group', { name: 'Input mode' }).at(-1)).getByRole('button', { name: 'Straight key' }))
    expect(stored()).toMatchObject({ keyerMode: 'manual', keyerWpm: 27 })
  })

  it('never names the keyer in the first-visit intro', async () => {
    // onboardingSeen is explicit: sanitize() treats progress without it as a returning player's.
    seed({ onboardingSeen: false, inputMode: 'pad', keyerMode: 'iambic', keyerWpm: 20 })
    await loadApp()
    expect(intro()).not.toBeNull()
    expect(intro().textContent).not.toMatch(/iambic/i)
  })
})

describe.skipIf(!IAMBIC_ENABLED)('iambic keyer settings', () => {
  it('switches the pad to iambic, persists its speed, and shows the speed near the mode toggle', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp()
    expect(screen.queryByText(/Iambic keyer ·/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Pad keyer' })).getByRole('button', { name: 'Iambic' }))
    // The slider's range is the keyer's: 5 to 30 WPM, the ceiling the runaway fix brought it down to.
    const speed = screen.getByRole('slider')
    expect([speed.getAttribute('min'), speed.getAttribute('max')]).toEqual(['5', '30'])
    expect(screen.getByRole('dialog').textContent).toContain('from 5 to 30 wpm')
    fireEvent.change(speed, { target: { value: '28' } })
    expect(stored()).toMatchObject({ keyerMode: 'iambic', keyerWpm: 28 })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.getByText('Iambic keyer · 28 wpm')).toBeTruthy())
    // The live speed tile reports the keyer's chosen speed, not a measured one.
    expect(screen.getByText('Keyer')).toBeTruthy()
    expect(screen.queryByText('Pace')).toBeNull()
  })

  // The keyer's own line in the intro: with the mode on, the first visit must teach a tap per
  // element, not the manual pad's "one tap is one dot".
  it('teaches the keyer in the first-visit intro when the mode is on', async () => {
    // onboardingSeen is explicit: sanitize() treats progress without it as a returning player's.
    seed({ onboardingSeen: false, inputMode: 'pad', keyerMode: 'iambic', keyerWpm: 20, touchControls: 'off' })
    await loadApp()
    expect(intro()).not.toBeNull()
    fireEvent.click(within(intro()).getByRole('button', { name: 'Next' }))
    expect(within(intro()).getByText(/Tap the full stop once for each dot and the hyphen once for each dash/)).toBeTruthy()
    expect(within(intro()).getByText(/Hold a key only to repeat it/)).toBeTruthy()
  })
})

describe.skipIf(!IAMBIC_ENABLED)('iambic is the pad only (app)', () => {
  it('hides the pad keyer settings for the straight key, and reads a straight-key run from presses with iambic persisted', async () => {
    seed({ onboardingSeen: true, inputMode: 'key', keyerMode: 'iambic', keyerWpm: 20 })
    await loadApp()
    expect(screen.queryByText(/Iambic keyer ·/)).toBeNull()
    expect(screen.getByText('Pace')).toBeTruthy()

    const clock = mockClock(50_000)
    clock.fire(window, 'keydown', { key: ' ', code: 'Space' }, 50_000)
    clock.fire(window, 'keyup', { key: ' ', code: 'Space' }, 50_410) // one long press: a single dash
    const marks = [...document.querySelectorAll('section[aria-label=Transmission] span.rounded-full')].filter(
      node => !String(node.className).includes('animate-caret'),
    )
    expect(marks).toHaveLength(1)
    expect(String(marks[0].className)).toContain('w-10')

    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    expect(screen.queryByRole('group', { name: 'Pad keyer' })).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('drops the iambic readout and settings when the player switches to the straight key', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad', keyerMode: 'iambic', keyerWpm: 20 })
    await loadApp()
    expect(screen.getByText('Iambic keyer · 20 wpm')).toBeTruthy()
    fireEvent.click(within(screen.getAllByRole('group', { name: 'Input mode' })[0]).getByRole('button', { name: 'Straight key' }))
    expect(screen.queryByText(/Iambic keyer ·/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    expect(screen.queryByRole('group', { name: 'Pad keyer' })).toBeNull()
    // Switching back brings the saved choice back.
    fireEvent.click(within(screen.getAllByRole('group', { name: 'Input mode' }).at(-1)).getByRole('button', { name: 'Dot / dash pad' }))
    expect(within(screen.getByRole('group', { name: 'Pad keyer' })).getByRole('button', { name: 'Iambic' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('undo and start over after a click', () => {
  function keyT(clock) {
    clock.fire(window, 'keydown', { key: '-', code: 'Minus' }, clock.now + 60)
    clock.fire(window, 'keyup', { key: '-', code: 'Minus' }, clock.now + 60)
    clock.fire(window, 'keydown', { key: ' ', code: 'Space' }, clock.now + 60)
    clock.fire(window, 'keyup', { key: ' ', code: 'Space' }, clock.now + 10)
  }

  it('Undo lets go of focus when clicked, so Enter afterwards does nothing, and shows what it took back', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp()
    const clock = mockClock(50_000)
    keyT(clock)
    keyT(clock)
    const undo = screen.getByRole('button', { name: 'Undo' })
    undo.focus()
    fireEvent.click(undo)
    expect(document.activeElement).not.toBe(undo)
    expect(screen.getByText('Took back')).toBeTruthy()
    expect(screen.getByText('dash')).toBeTruthy()
    const strip = () => document.querySelectorAll('section[aria-label=Transmission] span.w-10').length
    const before = strip()
    clock.fire(document.activeElement ?? document.body, 'keydown', { key: 'Enter', code: 'Enter' }, clock.now + 100)
    clock.fire(document.activeElement ?? document.body, 'keyup', { key: 'Enter', code: 'Enter' }, clock.now + 50)
    expect(strip()).toBe(before)
  })

  it('Start over lets go of focus when clicked, so Enter cannot trigger it again', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp()
    const clock = mockClock(50_000)
    const startOver = screen.getByRole('button', { name: 'Start over' })
    startOver.focus()
    fireEvent.click(startOver, { detail: 1 })
    expect(document.activeElement).not.toBe(startOver)
    // A run under way, then Enter wherever focus is: nothing is wiped.
    keyT(clock)
    keyT(clock)
    const strip = () => document.querySelectorAll('section[aria-label=Transmission] span.w-10').length
    expect(strip()).toBe(2)
    clock.fire(document.activeElement ?? document.body, 'keydown', { key: 'Enter', code: 'Enter' }, clock.now + 100)
    clock.fire(document.activeElement ?? document.body, 'keyup', { key: 'Enter', code: 'Enter' }, clock.now + 50)
    expect(strip()).toBe(2)
  })

  it('no control on the practice screen keeps focus after a pointer click; keyboard activation keeps it', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp()
    const clock = mockClock(50_000)
    keyT(clock)
    for (const name of ['Dot / dash pad', 'end letter', 'Undo', 'Start over']) {
      const control = screen.getByRole('button', { name })
      control.focus()
      expect(document.activeElement).toBe(control)
      fireEvent.click(control, { detail: 1 })
      expect(document.activeElement, name).not.toBe(control)
    }
    // Enter or Space on a focused control clicks it with detail 0: a keyboard user's focus stays put.
    const mode = screen.getByRole('button', { name: 'Dot / dash pad' })
    mode.focus()
    fireEvent.click(mode, { detail: 0 })
    expect(document.activeElement).toBe(mode)
  })
})

describe('straight key hint for the pad keys', () => {
  it('after two presses of . or - on the straight key, says they work in pad mode; a real press clears it', async () => {
    seed({ onboardingSeen: true, inputMode: 'key' })
    await loadApp()
    const clock = mockClock(50_000)
    const hint = () => screen.queryByText('The . and - keys work in pad mode. On the straight key, hold Space.')
    clock.fire(window, 'keydown', { key: '.', code: 'Period' }, clock.now + 50)
    clock.fire(window, 'keyup', { key: '.', code: 'Period' }, clock.now + 50)
    expect(hint()).toBeNull()
    clock.fire(window, 'keydown', { key: '-', code: 'Minus' }, clock.now + 50)
    clock.fire(window, 'keyup', { key: '-', code: 'Minus' }, clock.now + 50)
    expect(hint()).not.toBeNull()
    clock.fire(window, 'keydown', { key: ' ', code: 'Space' }, clock.now + 50)
    clock.fire(window, 'keyup', { key: ' ', code: 'Space' }, clock.now + 60)
    expect(hint()).toBeNull()
  })

  it('never shows in pad mode, where those keys are the pads', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad' })
    await loadApp()
    const clock = mockClock(50_000)
    for (const key of ['.', '-', '.']) {
      clock.fire(window, 'keydown', { key, code: key === '.' ? 'Period' : 'Minus' }, clock.now + 50)
      clock.fire(window, 'keyup', { key, code: key === '.' ? 'Period' : 'Minus' }, clock.now + 50)
    }
    expect(screen.queryByText(/work in pad mode/)).toBeNull()
  })
})

describe.skipIf(!IAMBIC_ENABLED)('iambic feedback on a desktop', () => {
  it('has the sidetone on by default, sounding while the keyer sends, and it can still be turned off', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad', keyerMode: 'iambic', keyerWpm: 20, touchControls: 'off' })
    const { sidetone } = await import('./lib/sidetone.js')
    const hold = vi.spyOn(sidetone, 'hold').mockImplementation(() => {})
    vi.spyOn(sidetone, 'unlock').mockImplementation(() => {})
    await loadApp()
    const clock = mockClock(50_000)
    clock.fire(window, 'keydown', { key: '.', code: 'Period' }, clock.now + 50)
    expect(hold.mock.calls.some(([, on]) => on === true)).toBe(true)
    clock.fire(window, 'keyup', { key: '.', code: 'Period' }, clock.now + 30)

    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    const choice = within(await screen.findByRole('group', { name: 'Sidetone' }))
    expect(choice.getByRole('button', { name: 'On' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(choice.getByRole('button', { name: 'Off' }))
    expect(stored().sidetone).toBe(false)
    expect(choice.getByRole('button', { name: 'Off' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('flashes the pad once per element the keyer sends, not on the press', async () => {
    seed({ onboardingSeen: true, inputMode: 'pad', keyerMode: 'iambic', keyerWpm: 20, touchControls: 'off' })
    await loadApp()
    const clock = mockClock(50_000)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pulse = label => Number(screen.getByRole('button', { name: label }).querySelector('[data-pulse]').dataset.pulse)
    expect([pulse('Dot'), pulse('Dash')]).toEqual([0, 0])
    // 20 WPM: a dot period is 120 ms. Held 396 ms: elements at 0, 120, 240 and 360 ms.
    clock.fire(window, 'keydown', { key: '.', code: 'Period' }, clock.now + 50)
    expect(pulse('Dot')).toBe(1)
    clock.run(396)
    clock.fire(window, 'keyup', { key: '.', code: 'Period' }, clock.now)
    clock.run(600)
    expect([pulse('Dot'), pulse('Dash')]).toEqual([4, 0])
    // The flash is the strip's own mark pop, and nothing pops before the first element.
    const glyph = screen.getByRole('button', { name: 'Dot' }).querySelector('[data-pulse]')
    expect(glyph.className).toMatch(/animate-mark-pop/)
    expect(screen.getByRole('button', { name: 'Dash' }).querySelector('[data-pulse]').className).not.toMatch(/animate-mark-pop/)
  })
})

describe('the loading screen', () => {
  it('hands over at the hard timeout, so a fetch that never answers cannot trap anyone behind it', async () => {
    const { default: App } = await import('./App.jsx')
    // A board request that never settles, and never rejects either. A spy, not a
    // module mock, so afterEach's restoreAllMocks undoes it before the next test.
    const passages = await import('./lib/passages.js')
    vi.spyOn(passages, 'loadBoard').mockReturnValue(new Promise(() => {}))
    const clock = mockClock(0)
    const frames = fakeFrames(clock)
    vi.useFakeTimers()

    render(<App />)
    const loader = () => screen.queryByText('Loading Morse Club')
    expect(loader()).not.toBeNull()

    // Nearly ten seconds in and the board still hasn't come: the loader holds.
    act(() => {
      vi.advanceTimersByTime(9_900)
    })
    frames.step(9_900)
    expect(loader()).not.toBeNull()

    // Then the timeout releases it, and the resolve plays out a frame at a time.
    for (let elapsed = 0; elapsed < 3_000 && loader() !== null; elapsed += 16) {
      act(() => {
        vi.advanceTimersByTime(16)
      })
      frames.step(16)
    }

    expect(loader()).toBeNull()
    expect(clock.now).toBeGreaterThanOrEqual(10_000)
    // The app is on screen even though the board never arrived.
    expect(screen.getByRole('button', { name: 'Setup' })).toBeTruthy()
    expect(passages.loadBoard).toHaveBeenCalled()
  })

  it('does not come back once it has handed over', async () => {
    const clock = mockClock(0)
    const frames = fakeFrames(clock)
    seed({ onboardingSeen: true })
    await loadApp()

    const loader = () => screen.queryByText('Loading Morse Club')
    // Ready before the entry finishes, so it resolves straight out of it.
    for (let elapsed = 0; elapsed < 4000 && loader() !== null; elapsed += 16) frames.step(16)
    expect(loader()).toBeNull()
    expect(clock.now).toBeLessThan(2200)

    // Nothing brings it back: not switching passages, not opening a modal.
    fireEvent.click(screen.getByRole('button', { name: /NO\./ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Passage 2:/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(loader()).toBeNull()
    expect(frames.queued).toBe(0)
  })
})
