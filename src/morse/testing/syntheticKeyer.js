// Synthetic operators for tests: the exact keystroke logs a straight-key or
// pad operator would produce, with speed changes and realistic imperfection.

import { normalize, toMorse } from '../alphabet.js'
import { unitMsForWpm } from '../units.js'

/** Deterministic PRNG (mulberry32), so noisy runs are reproducible from a seed. */
export function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The straight-key log for sending `text` like a real operator: presses of 1
 * or 3 units, gaps of 1 unit inside a letter, 3 between letters and 7 between
 * words. (The decoder ignores word gaps now, but operators still send them.)
 *
 *   wpm             constant speed
 *   wpmAt(p)        speed as a function of progress through the letters, 0 → 1
 *   jitter          every element scaled by a uniform factor in [1 - jitter, 1 + jitter]
 *   pressJitter,    override jitter for presses or gaps only
 *   gapJitter
 *   hesitation      { chance, extraUnits: [min, max] }: a gap inside a letter sometimes
 *                   stretches by a random number of units (thinking mid-letter)
 *   pauses          [{ letter, mark, ms }]: add ms of silence before mark `mark` of
 *                   letter `letter` (letters counted without spaces; mark 0 = before the letter)
 *   codeFor(char, letterIndex)  the code actually keyed for a letter (to send wrong symbols)
 *   seed, startAt
 *   repeatAfterMs,  also emit keyboard auto-repeat: extra 'down' events this long after
 *   repeatEveryMs   a press starts, then at this interval while held
 */
export function synthesizeKeying(
  text,
  {
    wpm = 20,
    wpmAt = null,
    jitter = 0,
    pressJitter = jitter,
    gapJitter = jitter,
    hesitation = null,
    pauses = [],
    codeFor = null,
    seed = 1,
    startAt = 1000,
    repeatAfterMs = null,
    repeatEveryMs = 30,
  } = {},
) {
  const random = seededRandom(seed)
  const vary = (ms, amount) => (amount ? ms * (1 + (random() * 2 - 1) * amount) : ms)
  const chars = [...normalize(text).toUpperCase()]
  const letterCount = chars.filter(char => char !== ' ').length

  const log = []
  let t = startAt
  let gapUnits = null // silence owed before the next letter; null before the first
  let letterIndex = 0

  for (const char of chars) {
    if (char === ' ') {
      if (gapUnits !== null) gapUnits = 7
      continue
    }
    const progress = letterCount > 1 ? letterIndex / (letterCount - 1) : 0
    const unit = unitMsForWpm(wpmAt ? wpmAt(progress) : wpm)
    const code = codeFor ? codeFor(char, letterIndex) : toMorse(char)

    for (const [i, mark] of [...code].entries()) {
      if (i > 0) {
        t += vary(unit, gapJitter)
        if (hesitation && random() < hesitation.chance) {
          const [min, max] = hesitation.extraUnits
          t += (min + random() * (max - min)) * unit
        }
      } else if (gapUnits !== null) {
        t += vary(gapUnits * unit, gapJitter)
      }
      for (const pause of pauses) if (pause.letter === letterIndex && pause.mark === i) t += pause.ms

      log.push({ type: 'down', t })
      const hold = vary((mark === '.' ? 1 : 3) * unit, pressJitter)
      if (repeatAfterMs !== null) {
        for (let r = t + repeatAfterMs; r < t + hold; r += repeatEveryMs) log.push({ type: 'down', t: r })
      }
      t += hold
      log.push({ type: 'up', t })
    }

    gapUnits = 3
    letterIndex++
  }

  return log
}

/**
 * The dot/dash pad log for sending `text`. Taps carry the symbol; timing is
 * whatever rhythm the tapper has.
 *
 *   tapMs, innerGapMs       how long each tap is held, and the pause between taps in a letter
 *   letterGapMs, wordGapMs  pauses between letters and words
 *   explicit                press "end letter" after every letter instead of relying on the pause
 */
export function synthesizeTapping(
  text,
  { tapMs = 70, innerGapMs = 150, letterGapMs = 450, wordGapMs = 1200, explicit = false, startAt = 1000 } = {},
) {
  const chars = [...normalize(text).toUpperCase()]
  const log = []
  let t = startAt
  let pending = null // 'letter' | 'word' | null

  for (const char of chars) {
    if (char === ' ') {
      if (pending) pending = 'word'
      continue
    }
    if (pending) t += pending === 'word' ? wordGapMs : letterGapMs
    for (const [i, mark] of [...toMorse(char)].entries()) {
      if (i > 0) t += innerGapMs
      log.push({ type: 'down', t, pad: mark })
      t += tapMs
      log.push({ type: 'up', t, pad: mark })
    }
    if (explicit) log.push({ type: 'letter', t: t + 40 })
    pending = 'letter'
  }

  return log
}
