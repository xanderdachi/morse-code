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

/**
 * A straight-key log from a script of what the operator does, for input no
 * tidy passage describes. Steps, in order:
 *
 *   { code, holds, gaps, undoAfter }  a letter of any symbols, valid or not.
 *        holds[i]   units mark i is held, instead of 1 or 3
 *        gaps[i]    units of silence before mark i (i > 0), instead of 1
 *        undoAfter  { mark, count }: undo pressed `count` times after that mark, mid-letter
 *   { undo: count }                  undo pressed `count` times, 150 ms apart
 *   { word: true }                   the next letter follows a 7-unit word gap
 *   { pause: ms }                    silence before the next letter, on top of its gap
 *
 * Letters follow each other after 3 units. Options:
 *   wpm, seed, startAt
 *   jitter      every press and gap scaled by a random factor in [1 - jitter, 1 + jitter]
 *   hesitation  { chance, extraUnits: [min, max] }: a gap inside a letter sometimes stretches
 *   thinking    { chance, ms: [min, max] }: a letter is sometimes preceded by a long think
 */
export function synthesizeScript(steps, { wpm = 20, jitter = 0, hesitation = null, thinking = null, seed = 1, startAt = 1000 } = {}) {
  const random = seededRandom(seed)
  const unit = unitMsForWpm(wpm)
  const vary = ms => (jitter ? ms * (1 + (random() * 2 - 1) * jitter) : ms)
  const log = []
  let t = startAt
  let first = true
  let gapUnits = 3
  let extraMs = 0

  const undo = count => {
    for (let i = 0; i < count; i++) {
      t += 150
      log.push({ type: 'undo', t })
    }
  }

  for (const step of steps) {
    if (step.undo) {
      undo(step.undo)
      continue
    }
    if (step.word) {
      gapUnits = 7
      continue
    }
    if (step.pause) {
      extraMs += step.pause
      continue
    }
    if (!first) t += vary(gapUnits * unit)
    if (thinking && !first && random() < thinking.chance) t += thinking.ms[0] + random() * (thinking.ms[1] - thinking.ms[0])
    t += extraMs
    for (const [i, mark] of [...step.code].entries()) {
      if (i > 0) {
        t += vary((step.gaps?.[i] ?? 1) * unit)
        if (hesitation && random() < hesitation.chance) {
          t += (hesitation.extraUnits[0] + random() * (hesitation.extraUnits[1] - hesitation.extraUnits[0])) * unit
        }
      }
      log.push({ type: 'down', t })
      t += vary((step.holds?.[i] ?? (mark === '.' ? 1 : 3)) * unit)
      log.push({ type: 'up', t })
      if (step.undoAfter?.mark === i) {
        undo(step.undoAfter.count)
        t += unit
      }
    }
    first = false
    gapUnits = 3
    extraMs = 0
  }
  return log
}

const SYMBOLS = ['.', '-']
const PROSIGN = '........'

/** A wrong code a beginner might send for `code`: a flipped, dropped or extra symbol, or another letter. */
export function beginnerMistake(code, random) {
  const kind = Math.floor(random() * 4)
  const i = Math.floor(random() * code.length)
  let wrong
  if (kind === 0) wrong = code.slice(0, i) + (code[i] === '.' ? '-' : '.') + code.slice(i + 1)
  else if (kind === 1 && code.length > 1) wrong = code.slice(0, i) + code.slice(i + 1)
  else if (kind === 2) wrong = code.slice(0, i) + SYMBOLS[Math.floor(random() * 2)] + code.slice(i)
  else wrong = toMorse('ETIANMSURWDKGOHVFLPJBXCYZQ'[Math.floor(random() * 26)])
  return wrong === code ? beginnerMistake(code, random) : wrong
}

const randomCode = (random, min, max) =>
  Array.from({ length: min + Math.floor(random() * (max - min + 1)) }, () => SYMBOLS[Math.floor(random() * 2)]).join('')

/** The scenarios beginnerScript() builds, by name. */
export const BEGINNER_SCENARIOS = [
  'wrong-30%',
  'random-symbols',
  'long-presses',
  'long-runs',
  'overflow',
  'alternating',
  'stops-at-20%',
  'stops-at-50%',
  'stops-at-90%',
  'prosigns',
  'undo-spam',
]

/**
 * A script (for synthesizeScript) of a beginner sending `text` badly, in one of
 * BEGINNER_SCENARIOS. Word gaps are kept where the passage has them.
 */
export function beginnerScript(text, scenario, { seed = 1 } = {}) {
  const random = seededRandom(seed * 7919 + 17)
  const letters = []
  for (const char of normalize(text).toUpperCase()) {
    if (char === ' ') letters.push({ word: true })
    else letters.push({ char, code: toMorse(char) })
  }
  const real = letters.filter(step => step.code)
  const steps = []
  const letter = (step, overrides) => steps.push({ code: step.code, ...overrides })
  let n = 0 // letters seen

  const stopAt = { 'stops-at-20%': 0.2, 'stops-at-50%': 0.5, 'stops-at-90%': 0.9 }[scenario]
  const last = real.length - 1

  if (scenario === 'random-symbols') {
    for (let i = 0; i < real.length; i++) steps.push({ code: randomCode(random, 1, 6) })
    return steps
  }
  if (scenario === 'prosigns') steps.push({ code: PROSIGN }) // at the very first character

  for (const step of letters) {
    if (step.word) {
      steps.push(step)
      continue
    }
    const index = n++
    if (stopAt !== undefined && index >= Math.round(real.length * stopAt)) break
    switch (scenario) {
      case 'wrong-30%':
        letter(step, random() < 0.3 ? { code: beginnerMistake(step.code, random) } : {})
        break
      case 'alternating':
        letter(step, index % 2 === 1 ? { code: beginnerMistake(step.code, random) } : {})
        break
      case 'long-presses':
        // Now and then one press of a letter is held 10 to 20 units.
        letter(step, index % 4 === 1 ? { holds: [...step.code].map((_, i) => (i === 0 ? 10 + random() * 10 : undefined)) } : {})
        break
      case 'long-runs':
        if (index % 9 === 4) steps.push({ code: (random() < 0.5 ? '.' : '-').repeat(12 + Math.floor(random() * 19)) })
        letter(step)
        break
      case 'overflow':
        if (index % 8 === 3) steps.push({ code: randomCode(random, 20, 30) })
        letter(step)
        break
      case 'prosigns':
        if (index === 5) {
          // A wrong letter, then the prosign twice in a row, then carrying on.
          steps.push({ code: beginnerMistake(step.code, random) }, { code: PROSIGN }, { code: PROSIGN })
        } else if (index % 7 === 3) {
          steps.push({ code: beginnerMistake(step.code, random) }, { code: PROSIGN })
        }
        letter(step)
        break
      case 'undo-spam':
        if (index === 0) steps.push({ undo: 5 })
        letter(step, index % 5 === 2 && step.code.length > 1 ? { undoAfter: { mark: 0, count: 3 } } : {})
        if (index === last) steps.push({ undo: 5 })
        break
      default:
        letter(step)
    }
  }
  return steps
}
