// The sidetone: a sine tone while the key is down, so the operator hears their
// own rhythm. One AudioContext serves the whole app. A running oscillator is
// gated by a gain node rather than started per press, so a press sounds with
// no oscillator start-up, and every change of level is ramped: an instant step
// in a sine wave clicks audibly.
//
// Browsers start an AudioContext suspended until the page has a user gesture,
// iOS most strictly, so unlock() must run inside a gesture handler (pointerup,
// keydown, click), never on page load, or the whole first run is silent.

export const SIDETONE = {
  frequencyHz: 600,
  rampMs: 5,
  level: 0.2,
}

export function createSidetone({
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  config = SIDETONE,
} = {}) {
  let context = null
  let gain = null
  const holders = new Set()

  function ensureContext() {
    if (context || !AudioContextClass) return context
    try {
      context = new AudioContextClass({ latencyHint: 'interactive' })
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.value = config.frequencyHz
      gain = context.createGain()
      gain.gain.value = 0
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
    } catch {
      context = null
      gain = null
    }
    return context
  }

  function rampTo(level) {
    const now = context.currentTime
    const param = gain.gain
    // Hold the level wherever an unfinished ramp has got to, then ramp from there.
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now)
    } else {
      param.cancelScheduledValues(now)
      param.setValueAtTime(param.value, now)
    }
    param.linearRampToValueAtTime(level, now + config.rampMs / 1000)
  }

  function unlock() {
    const ctx = ensureContext()
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
      try {
        ctx.resume()?.catch?.(() => {})
      } catch {
        // Not allowed yet; the next gesture tries again.
      }
    }
  }

  return {
    /** Create the context if needed and resume it. Call from inside a user gesture. Never throws. */
    unlock,

    /** Sound while any holder is holding (two inputs can share the one tone). */
    hold(holder, on) {
      const wasOn = holders.size > 0
      if (on) holders.add(holder)
      else holders.delete(holder)
      const isOn = holders.size > 0
      if (isOn === wasOn) return
      if (isOn) unlock()
      if (!context || !gain) return
      try {
        rampTo(isOn ? config.level : 0)
      } catch {
        // A context closed underneath us: stay silent.
      }
    },

    /** Seconds between scheduling a sound and hearing it, where the browser reports it. */
    get outputLatency() {
      return context ? (context.outputLatency ?? 0) + (context.baseLatency ?? 0) : null
    },
  }
}

/** The app's one sidetone. */
export const sidetone = createSidetone()

/** A short buzz on press where the Vibration API exists (Android). iOS has none; nothing may depend on it. */
export function hapticTap(ms = 10) {
  try {
    globalThis.navigator?.vibrate?.(ms)
  } catch {
    // Unsupported or blocked: no haptics.
  }
}
