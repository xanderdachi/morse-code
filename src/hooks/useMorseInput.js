import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  CONFIG,
  DASH,
  DOT,
  LETTER_GAP,
  WORD_GAP,
  appendGap,
  classifyGap,
  classifyPress,
  thresholdsMs,
} from '../morse/timing.js'

/** The two ways to key, by id: 'key' uses pressKey/releaseKey, 'pad' uses pressPad/releasePad. */
export const INPUT_MODES = {
  key: 'Straight key',
  pad: 'Dot / dash pad',
}

const INITIAL_STATE = Object.freeze({
  symbols: [],
  isKeyDown: false, // straight key held
  isPadDown: false, // any pad button held
  dashFormed: false, // straight key held long enough to become a dash
  startedAt: null, // first contact, performance.now() clock
  endedAt: null, // end of the most recent mark
})

/**
 * Keying state machine for both input modes.
 *
 * Straight key: pressKey() / releaseKey(); the hold time decides dot or dash.
 * Dot/dash pad: pressPad(symbol) sends immediately, releasePad() starts the gap clock.
 * Silence after a mark ends the letter, then the word, on timers from CONFIG.
 * Every handler takes an optional timestamp on the performance.now() clock.
 */
export function useMorseInput(config = CONFIG) {
  const [keyer] = useState(() => createKeyer(config))
  const state = useSyncExternalStore(keyer.subscribe, keyer.getState)

  useEffect(() => keyer.setConfig(config), [keyer, config])
  useEffect(() => keyer.dispose, [keyer])

  return { ...state, ...keyer.actions }
}

/** An input event's timestamp on the performance.now() clock. */
export function eventTime(event) {
  const now = performance.now()
  const stamp = event?.timeStamp
  return stamp > 0 && stamp <= now ? stamp : now
}

/** True when a keyboard event is aimed at something the user is typing into. */
export function isTypingTarget(target) {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

function createKeyer(initialConfig) {
  let config = initialConfig
  let state = INITIAL_STATE
  const listeners = new Set()

  let keyPressedAt = null
  let padsHeld = 0
  let lastMarkEnd = null
  let gapTimers = []
  let dashTimer = null

  const set = patch => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  const setSymbols = symbols => {
    if (symbols !== state.symbols) set({ symbols })
  }

  const clearTimers = () => {
    gapTimers.forEach(clearTimeout)
    gapTimers = []
    clearTimeout(dashTimer)
  }

  const holding = () => keyPressedAt !== null || padsHeld > 0

  // A new mark is starting: commit whatever the silence before it meant, in
  // case a gap timer was throttled and hasn't fired yet.
  function beginMark(at) {
    if (holding()) return
    gapTimers.forEach(clearTimeout)
    gapTimers = []
    if (lastMarkEnd !== null) {
      const gap = classifyGap(at - lastMarkEnd, config)
      if (gap) setSymbols(appendGap(state.symbols, gap))
    }
    if (state.startedAt === null) set({ startedAt: at })
  }

  function endMark(at) {
    lastMarkEnd = at
    set({ endedAt: at })
    const { letterGap, wordGap } = thresholdsMs(config)
    const late = performance.now() - at
    gapTimers = [
      setTimeout(() => setSymbols(appendGap(state.symbols, LETTER_GAP)), Math.max(0, letterGap - late)),
      setTimeout(() => setSymbols(appendGap(state.symbols, WORD_GAP)), Math.max(0, wordGap - late)),
    ]
  }

  const actions = {
    pressKey(at = performance.now()) {
      if (keyPressedAt !== null) return
      beginMark(at)
      keyPressedAt = at
      const untilDash = thresholdsMs(config).dash - (performance.now() - at)
      dashTimer = setTimeout(() => set({ dashFormed: true }), Math.max(0, untilDash) + 1)
      set({ isKeyDown: true, dashFormed: false })
    },

    releaseKey(at = performance.now()) {
      if (keyPressedAt === null) return
      const symbol = classifyPress(at - keyPressedAt, config)
      keyPressedAt = null
      clearTimeout(dashTimer)
      set({ symbols: [...state.symbols, symbol], isKeyDown: false, dashFormed: false })
      endMark(at)
    },

    pressPad(symbol, at = performance.now()) {
      if (symbol !== DOT && symbol !== DASH) throw new TypeError(`Not a mark: ${JSON.stringify(symbol)}`)
      beginMark(at)
      padsHeld++
      set({ symbols: [...state.symbols, symbol], isPadDown: true })
    },

    releasePad(at = performance.now()) {
      if (padsHeld === 0) return
      padsHeld--
      if (padsHeld > 0) return
      set({ isPadDown: false })
      endMark(at)
    },

    /** End the current word now instead of waiting for the silence. */
    breakWord() {
      if (holding()) return
      gapTimers.forEach(clearTimeout)
      gapTimers = []
      setSymbols(appendGap(state.symbols, WORD_GAP))
    },

    /** Let go of anything held without sending it (mode switch, window blur). */
    cancel(at = performance.now()) {
      if (!holding()) return
      keyPressedAt = null
      padsHeld = 0
      clearTimeout(dashTimer)
      set({ isKeyDown: false, isPadDown: false, dashFormed: false })
      if (state.symbols.length === 0) set({ startedAt: null })
      else endMark(at)
    },

    /** Close off the transmission, counting anything still held, and return it. */
    finish(at = performance.now()) {
      if (keyPressedAt !== null) actions.releaseKey(at)
      if (padsHeld > 0) {
        padsHeld = 0
        set({ isPadDown: false, endedAt: at })
      }
      clearTimers()
      setSymbols(appendGap(state.symbols, LETTER_GAP))
      return state
    },

    reset() {
      clearTimers()
      keyPressedAt = null
      padsHeld = 0
      lastMarkEnd = null
      set(INITIAL_STATE)
    },
  }

  return {
    actions,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setConfig(next) {
      config = next
    },
    dispose: clearTimers,
  }
}
