import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { hapticTap, sidetone as sharedSidetone } from '../lib/sidetone.js'
import { createIambicKeyer } from '../morse/iambic.js'
import { createKeyer } from '../morse/keyer.js'
import { DASH, DOT } from '../morse/symbols.js'
import { CONFIG } from '../morse/timing.js'
import { createLatencyProbe } from './pressLatency.js'

/** The two ways to key, by id. */
export const INPUT_MODES = {
  key: 'Straight key',
  pad: 'Dot / dash pad',
}

const PAD_KEYS = { '.': DOT, '-': DASH }

const MEASURE_LATENCY = import.meta.env.DEV && import.meta.env.MODE !== 'test'

// Gestures that let a page start audio. A touch pointerdown doesn't count in
// every browser, so the release and taps on any other control unlock it too.
const AUDIO_GESTURES = ['pointerdown', 'pointerup', 'keydown', 'click']

/**
 * DOM input for one keyer. This hook owns every input event: it timestamps
 * them, feeds them to the keyer in src/morse/keyer.js, and re-reads the keyer
 * whenever its answer could change without a new event (a held key becoming a
 * dash, a pause beginning, the error path closing a wrong letter, silence
 * ending the run). It makes no timing decisions itself; components only render
 * what it returns.
 *
 * Options:
 *   mode         'key' or 'pad': which keyboard bindings are live
 *                  key: hold Space as the key
 *                  pad: . dot, - dash, Space end letter
 *                  both: Backspace undo, when undo is allowed
 *   target       the passage being sent
 *   errorGapUnits the error path's letter gap, from the tier's leniency table (required)
 *   anchored     segment letters against the passage (default) or by timing alone
 *   unitMs       the operator's calibrated dot length, or null for the default
 *   keyerMode    'manual' or 'iambic': in pad mode, whether held pads generate elements
 *   keyerWpm     the iambic keyer's speed
 *   enabled      listen to the keyboard; turning this off releases anything held
 *   undoEnabled  whether Backspace and undo() do anything
 *   sidetone     sound a tone while the key is down (for the iambic keyer, while an element sounds)
 *   haptics      buzz briefly on each touch press (each generated element, iambic), where the device can
 *   beforePress  called before a new press is accepted; return false to refuse it
 *   onUpdate     called with the live state whenever it changes
 *   onFinalize   called once with the fixed result when the run ends, however it ended
 *
 * Returns the live state (strip, letters, cursor, remaining, paused, timing for
 * the clock, what's held), `run` (null until the run is finalized, then the
 * fixed result, whether silence or finish() ended it), props to spread on the
 * key, pad and end-letter buttons, and undo() / finish() / reset(). Once
 * finalized, all input is discarded until reset().
 *
 * Touch: the key and pad props attach non-passive Pointer Event listeners (no
 * touch or mouse listeners, which would double every mark). Each key belongs to
 * one pointer from its pointerdown until that pointer's pointerup or
 * pointercancel, wherever the finger has slid to; a second finger on a held key
 * is ignored, and the two pads are held independently. Losing focus or hiding
 * the page releases everything, timed by that event.
 *
 * Iambic: the pads are paddles. Presses and releases go to the iambic keyer
 * (src/morse/iambic.js) and the elements it generates go into the keyer log at
 * their exact times; `padsDown` shows the paddles held. A pointercancel, blur
 * or hidden page stops it outright: no memory, no Mode B element.
 */
export function useMorseInput({
  mode = 'key',
  target = '',
  errorGapUnits,
  anchored = true,
  unitMs = null,
  keyerMode = 'manual',
  keyerWpm = null,
  enabled = true,
  undoEnabled = false,
  sidetone = false,
  haptics = false,
  beforePress,
  onUpdate,
  onFinalize,
} = {}) {
  const optionsRef = useRef({ beforePress, undoEnabled, sidetone, haptics, onUpdate, onFinalize })
  useLayoutEffect(() => {
    optionsRef.current = { beforePress, undoEnabled, sidetone, haptics, onUpdate, onFinalize }
  })

  const iambic = mode === 'pad' && keyerMode === 'iambic'
  const [store] = useState(() => createKeyerStore({ unitMs, target, anchored, errorGapUnits, iambic, keyerWpm }))
  const [latency] = useState(() => createLatencyProbe({ enabled: MEASURE_LATENCY }))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

  useEffect(
    () =>
      store.delegate({
        update: snapshot => optionsRef.current.onUpdate?.(snapshot),
        finalize: run => optionsRef.current.onFinalize?.(run),
        hold: holding => sharedSidetone.hold(store, holding && optionsRef.current.sidetone),
        element: source => {
          if (optionsRef.current.haptics && source !== 'mouse' && source !== 'keyboard') hapticTap()
        },
      }),
    [store],
  )

  useEffect(
    () => store.configure({ unitMs, target, anchored, errorGapUnits, iambic, keyerWpm }),
    [store, unitMs, target, anchored, errorGapUnits, iambic, keyerWpm],
  )
  useEffect(() => store.dispose, [store])

  // Turning the sidetone off mid-press silences it now; unmounting always does.
  useEffect(() => {
    if (!sidetone) sharedSidetone.hold(store, false)
  }, [store, sidetone])
  useEffect(() => () => sharedSidetone.hold(store, false), [store])

  useEffect(() => {
    if (!sidetone) return
    const unlock = () => sharedSidetone.unlock()
    for (const type of AUDIO_GESTURES) window.addEventListener(type, unlock, { capture: true, passive: true })
    return () => {
      for (const type of AUDIO_GESTURES) window.removeEventListener(type, unlock, { capture: true })
    }
  }, [sidetone])

  const handlers = useMemo(() => {
    const pressAllowed = () => optionsRef.current.beforePress?.() !== false
    const keys = new Set()

    const releaseEverything = t => {
      for (const key of keys) key.forget()
      store.stopPaddles(t)
      store.releaseAll(t)
    }

    // One on-screen key, owned by at most one pointer at a time. The ref
    // attaches its pointerdown listener; releases are matched by pointerId on
    // window, so they arrive wherever the pointer ends up, captured or not.
    // `cancel` is for a pointercancel: the system took the touch, so let go of everything.
    function pointerKey(press, release, cancel = release) {
      let owner = null

      const onPointerDown = event => {
        if (event.button !== 0) return
        // Non-passive: no text selection, focus change or emulated mouse events.
        event.preventDefault()
        if (owner !== null) return // a second finger on a key that's already held
        const t = eventTime(event)
        if (!pressAllowed() || !press(t, event.pointerType)) return
        owner = event.pointerId
        latency.pressed(t, event.pointerType)
        try {
          // Sliding off the key still delivers this pointer's release to it.
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // The pointer is already gone; the window listener still sees its release.
        }
        // The iambic keyer buzzes per element it generates instead.
        if (optionsRef.current.haptics && event.pointerType !== 'mouse' && !store.iambic) hapticTap()
      }

      const key = {
        release(event) {
          if (owner === null || event.pointerId !== owner) return
          owner = null
          ;(event.type === 'pointercancel' ? cancel : release)(eventTime(event))
        },
        forget() {
          owner = null
        },
        ref(node) {
          if (!node) return
          keys.add(key)
          node.addEventListener('pointerdown', onPointerDown, { passive: false })
          node.addEventListener('contextmenu', preventDefault)
          return () => {
            node.removeEventListener('pointerdown', onPointerDown)
            node.removeEventListener('contextmenu', preventDefault)
            keys.delete(key)
            // Unmounted mid-press (a layout or mode switch): let go now.
            if (owner !== null) {
              owner = null
              release(performance.now())
            }
          }
        },
      }
      return key
    }

    const straightKey = pointerKey(store.keyDown, store.keyUp)
    const dotKey = pointerKey(
      (t, source) => store.paddleDown(DOT, t, source),
      t => store.paddleUp(DOT, t),
      t => store.cancelPaddle(DOT, t),
    )
    const dashKey = pointerKey(
      (t, source) => store.paddleDown(DASH, t, source),
      t => store.paddleUp(DASH, t),
      t => store.cancelPaddle(DASH, t),
    )

    return {
      keys,
      releaseEverything,
      keyProps: { ref: straightKey.ref },
      padProps: { [DOT]: { ref: dotKey.ref }, [DASH]: { ref: dashKey.ref } },
      letterProps: { onClick: event => store.commitLetter(eventTime(event)) },
      undo: () => {
        if (optionsRef.current.undoEnabled) store.undo(performance.now())
      },
      reset: () => {
        for (const key of keys) key.forget()
        store.reset()
      },
    }
  }, [store, latency])

  // Pointer releases, and anything that means the finger or the page is gone.
  // These stay on whether or not the keyboard is enabled.
  useEffect(() => {
    const { keys, releaseEverything } = handlers
    const onPointerRelease = event => {
      for (const key of keys) key.release(event)
    }
    const onBlur = event => releaseEverything(eventTime(event))
    const onVisibilityChange = event => {
      if (document.visibilityState === 'hidden') releaseEverything(eventTime(event))
    }

    window.addEventListener('pointerup', onPointerRelease, { passive: false })
    window.addEventListener('pointercancel', onPointerRelease, { passive: false })
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pointerup', onPointerRelease)
      window.removeEventListener('pointercancel', onPointerRelease)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [handlers])

  useEffect(() => {
    if (!enabled) return
    const pressAllowed = () => optionsRef.current.beforePress?.() !== false

    const onKeyDown = event => {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      const t = eventTime(event)
      if (event.key === 'Backspace') {
        if (!optionsRef.current.undoEnabled) return
        event.preventDefault()
        if (!event.repeat) store.undo(t)
        return
      }
      if (mode === 'key') {
        if (event.code !== 'Space') return
        event.preventDefault()
        // Auto-repeat fires keydown continuously while held; only the first is a press.
        if (!event.repeat && pressAllowed() && store.keyDown(t)) latency.pressed(t, 'key')
        return
      }
      const pad = PAD_KEYS[event.key]
      if (pad) {
        event.preventDefault()
        if (!event.repeat && pressAllowed() && store.paddleDown(pad, t, 'keyboard')) latency.pressed(t, 'key')
      } else if (event.code === 'Space') {
        event.preventDefault()
        if (!event.repeat) store.commitLetter(t)
      }
    }

    const onKeyUp = event => {
      if (isTypingTarget(event.target)) return
      const t = eventTime(event)
      if (mode === 'key') {
        if (event.code !== 'Space') return
        event.preventDefault()
        store.keyUp(t)
        return
      }
      const pad = PAD_KEYS[event.key]
      if (pad) store.paddleUp(pad, t)
      else if (event.code === 'Space') event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      handlers.releaseEverything(performance.now())
    }
  }, [enabled, mode, store, handlers, latency])

  useLayoutEffect(() => {
    if (state.isKeyDown || state.padsDown[DOT] || state.padsDown[DASH]) latency.committed()
  }, [latency, state.isKeyDown, state.padsDown])

  const { keyProps, padProps, letterProps, undo, reset } = handlers
  return { ...state, keyProps, padProps, letterProps, undo, finish: store.finish, reset }
}

// The keyer plus a subscription and a re-check timer, shaped for useSyncExternalStore.
// With the iambic keyer on, it also owns that keyer and wakes it for each element.
function createKeyerStore({ unitMs, target, anchored, errorGapUnits, iambic: iambicOn, keyerWpm }) {
  const keyer = createKeyer({ unitMs: unitMs ?? CONFIG.defaultUnitMs, target, anchored, errorGapUnits })
  const listeners = new Set()
  let iambic = iambicOn ? createIambicKeyer({ wpm: keyerWpm }) : null
  let iambicTimer = null
  let paddleSource = null // how the last paddle was pressed, for haptics per element
  let snapshot = toSnapshot(keyer.state(performance.now()), null, iambic?.paddles)
  let timer = null
  let announced = null // the finalized run the finalize handler was last called with
  let holding = false
  let handlers = {}

  // Hand the keyer every element the iambic keyer has made by now, stamped with its exact time.
  function flushIambic() {
    if (!iambic) return
    for (const event of iambic.advance(performance.now())) {
      const accepted = event.type === 'down' ? keyer.padDown(event.pad, event.t) : keyer.padUp(event.pad, event.t)
      if (accepted) syncHolding()
      if (accepted && event.type === 'down') handlers.element?.(paddleSource)
    }
  }

  // Flush, re-read, and sleep until the iambic keyer's next element boundary.
  function pumpIambic() {
    clearTimeout(iambicTimer)
    iambicTimer = null
    flushIambic()
    refresh()
    const next = iambic?.nextEventAt ?? null
    if (next !== null) iambicTimer = setTimeout(pumpIambic, Math.max(0, next - performance.now()))
  }

  // Tell the delegate when the key goes down or comes up, before anything slower runs.
  function syncHolding() {
    if (keyer.holding === holding) return
    holding = keyer.holding
    handlers.hold?.(holding)
  }

  function refresh() {
    clearTimeout(timer)
    timer = null
    const now = performance.now()
    // Silence may have ended the run; the keyer decides from the real time since the last release.
    const result = keyer.update(now)
    syncHolding()
    const previous = snapshot
    snapshot = toSnapshot(result, snapshot, iambic?.paddles)
    if (snapshot !== previous) {
      for (const listener of listeners) listener()
    }
    // The callback doesn't trust its own delay: refresh() re-reads the clock and
    // the keyer decides from the real time since the last mark.
    if (result.nextCheckAt !== null) {
      timer = setTimeout(refresh, Math.max(0, result.nextCheckAt - performance.now()) + 1)
    }
    // Handlers last: they may reset the store, which refreshes again from scratch.
    if (result.finalized && result !== announced) {
      announced = result
      handlers.finalize?.(result)
    }
    if (snapshot !== previous) handlers.update?.(snapshot)
  }

  // Record an input; returns whether the keyer accepted it. Elements already due go in first, in order.
  const act =
    fn =>
    (...args) => {
      flushIambic()
      const accepted = fn(...args)
      if (accepted) {
        syncHolding()
        refresh()
      }
      return accepted
    }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,

    /** Register { update, finalize, hold } handlers. Returns an unregister function. */
    delegate(next) {
      handlers = next
      return () => {
        if (handlers === next) handlers = {}
      }
    },

    keyDown: act(keyer.keyDown),
    keyUp: act(keyer.keyUp),
    commitLetter: act(keyer.commitLetter),
    undo: act(keyer.undo),
    releaseAll: act(keyer.releaseAll),

    get iambic() {
      return iambic !== null
    },

    /** A pad pressed: an element itself (manual), or a paddle for the iambic keyer. */
    paddleDown(pad, t, source) {
      if (!iambic) return act(keyer.padDown)(pad, t)
      if (keyer.finalized || iambic.paddles[pad]) return false
      paddleSource = source
      iambic.press(pad, t)
      pumpIambic()
      return true
    },

    paddleUp(pad, t) {
      if (!iambic) return act(keyer.padUp)(pad, t)
      iambic.release(pad, t)
      pumpIambic()
      return true
    },

    /** A pointercancel on a pad. The iambic keyer stops outright; a manual pad just lets go. */
    cancelPaddle(pad, t) {
      if (!iambic) return act(keyer.padUp)(pad, t)
      iambic.stop(t)
      pumpIambic()
      return true
    },

    /** Blur, a hidden page, input switched off: the iambic keyer stops, sending nothing more. */
    stopPaddles(t) {
      if (!iambic) return
      iambic.stop(t)
      pumpIambic()
    },

    /** The Finish control: end the run now, whatever was sent. Returns the result, including its keystroke log. */
    finish() {
      const now = performance.now()
      iambic?.stop(now)
      flushIambic()
      const run = keyer.finish(now)
      syncHolding()
      refresh()
      return run
    },

    reset() {
      clearTimeout(iambicTimer)
      iambicTimer = null
      iambic?.reset()
      keyer.reset()
      syncHolding()
      refresh()
    },

    configure({ iambic: nextIambic, keyerWpm: wpm, ...options }) {
      if (nextIambic !== (iambic !== null)) {
        iambic?.stop(performance.now())
        flushIambic()
        clearTimeout(iambicTimer)
        iambicTimer = null
        iambic = nextIambic ? createIambicKeyer({ wpm }) : null
      } else if (iambic && wpm) {
        iambic.setWpm(wpm)
      }
      keyer.configure({ ...options, unitMs: options.unitMs ?? CONFIG.defaultUnitMs })
      refresh()
    },

    dispose() {
      clearTimeout(timer)
      clearTimeout(iambicTimer)
      timer = null
      iambicTimer = null
    },
  }
}

// Only what the UI renders, reusing the previous snapshot when nothing it shows changed.
// `paddles`, with the iambic keyer on, stands in for the pads held.
function toSnapshot(result, previous, paddles) {
  const next = {
    run: result.finalized ? result : null,
    strip: result.strip,
    lettersSent: result.lettersSent,
    remaining: result.remaining,
    scrubbedLetters: result.scrubbedLetters,
    prosignHeard: result.prosignHeard,
    text: result.text,
    cursor: result.cursor,
    complete: result.complete,
    paused: result.paused,
    isKeyDown: result.isKeyDown,
    padsDown: paddles ?? result.padsDown,
    dashFormed: result.dashFormed,
    startedAt: result.startedAt,
    lastEnd: result.endedAt,
    pausedMs: result.pausedMs,
    pauseAfterMs: result.pauseAfterMs,
    letterUnits: result.letterUnits,
    unitMs: result.unitMs,
  }
  if (!previous) return next
  if (sameStrip(previous.strip, next.strip)) next.strip = previous.strip
  if (previous.padsDown[DOT] === next.padsDown[DOT] && previous.padsDown[DASH] === next.padsDown[DASH]) {
    next.padsDown = previous.padsDown
  }
  const unchanged = Object.keys(next).every(key => Object.is(next[key], previous[key]))
  return unchanged ? previous : next
}

function sameStrip(a, b) {
  return (
    a.length === b.length &&
    a.every((mark, i) => mark.id === b[i].id && mark.symbol === b[i].symbol && mark.endsLetter === b[i].endsLetter)
  )
}

// An input event's time on the performance.now() clock, when the input happened
// rather than when the handler ran.
function eventTime(event) {
  const now = performance.now()
  const stamp = event?.timeStamp
  return stamp > 0 && stamp <= now ? stamp : now
}

function preventDefault(event) {
  event.preventDefault()
}

function isTypingTarget(target) {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null
}
