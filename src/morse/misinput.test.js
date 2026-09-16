import { describe, expect, it } from 'vitest'
import { leniencyFor } from '../lib/progress.js'
import { normalize, toMorse } from './alphabet.js'
import { grade } from './grade.js'
import { createKeyer, interpret } from './keyer.js'
import { synthesizeKeying } from './testing/syntheticKeyer.js'
import { ERROR_PROSIGN, LONGEST_LETTER, isCodePrefix } from './trie.js'
import { CONFIG, settleGapMs } from './timing.js'
import { unitMsForWpm } from './units.js'

const { errorGapUnits } = leniencyFor(1)
const WPM = 12
const U = unitMsForWpm(WPM) // 100 ms
const lettersOf = text => normalize(text).replaceAll(' ', '').toUpperCase()

/** A straight-key log sending `codes` as letters, 3-unit gaps between them. */
const keyCodes = (codes, options = {}) =>
  synthesizeKeying('X'.repeat(codes.length), { wpm: WPM, codeFor: (_, i) => codes[i], ...options })

/** Live state after each release of `log`, the moment it happened. */
function statesAfterEachRelease(log, options) {
  return log.flatMap((event, i) => (event.type === 'up' ? [interpret(log.slice(0, i + 1), { errorGapUnits, unitMs: U, now: event.t, ...options })] : []))
}

// Marks after the last committed letter: the buffer still being decided.
function pendingMarks(state) {
  const lastEnd = state.strip.findLastIndex(mark => mark.endsLetter)
  return state.strip.length - 1 - lastEnd
}

// When silence alone ends a run whose last letter is garbled. Anchored, the cursor knows the passage
// is done: the settle period. Unanchored, a garbled last letter could as well be an extra one with
// more to come, so the run waits for the pause rule (or the Finish control) rather than risk
// ending while the operator is still keying.
function endOfSilence(keyer, lastUp, anchored) {
  if (anchored) return lastUp + settleGapMs(U)
  const state = keyer.state(lastUp)
  expect(state.remaining).toBe(1)
  return lastUp + state.pauseAfterMs + CONFIG.finishPauseAtEndMs
}

function feed(keyer, log) {
  for (const { type, t } of log) {
    if (type === 'down') keyer.keyDown(t)
    else keyer.keyUp(t)
  }
}

describe('trie', () => {
  it('knows every code and its prefixes, the error prosign included, and nothing else', () => {
    expect(isCodePrefix('.-.-.-')).toBe(true)
    expect(isCodePrefix('----')).toBe(true) // on the way to 0 and 9
    expect(isCodePrefix('------')).toBe(false)
    expect(isCodePrefix('.......')).toBe(true) // on the way to the prosign
    expect(isCodePrefix(ERROR_PROSIGN)).toBe(true)
    expect(isCodePrefix('.........')).toBe(false)
    expect(LONGEST_LETTER).toBe(7) // $ is ...-..-
  })
})

describe('bug A: a buffer that can no longer be a letter commits at once', () => {
  for (const anchored of [true, false]) {
    it(`commits nine consecutive dashes as # within 6 symbols, without waiting for a gap (${anchored ? 'anchored error path' : 'unanchored'})`, () => {
      // T, then nine dashes where E is expected, then nothing.
      const log = synthesizeKeying('TX', { wpm: WPM, codeFor: (char, i) => (i === 1 ? '-'.repeat(9) : toMorse(char)) })
      const states = statesAfterEachRelease(log, { target: 'TE', anchored })

      // After the fifth dash (0, which could still be 0), nothing about the dashes is decided...
      expect(states[5].text).toBe('T')
      // ...and the sixth, which no code allows, decides it on its own release.
      expect(states[6].text).toBe('T#')
      expect(states[6].letters[1].markIds).toHaveLength(6)
      // The rest of the run belongs to the same garbled character; the buffer never holds more than it can.
      expect(states[9].text).toBe('T#')
      expect(states[9].letters[1].markIds).toHaveLength(9)
      for (const state of states) expect(pendingMarks(state)).toBeLessThanOrEqual(LONGEST_LETTER)
    })

    it(`does not stall: nine dashes as the last letter still finalize on silence (${anchored ? 'anchored' : 'unanchored'})`, () => {
      const keyer = createKeyer({ errorGapUnits, target: 'TE', unitMs: U, anchored })
      const log = synthesizeKeying('TX', { wpm: WPM, codeFor: (char, i) => (i === 1 ? '-'.repeat(9) : toMorse(char)) })
      feed(keyer, log)
      const lastUp = log.at(-1).t
      const endsAt = endOfSilence(keyer, lastUp, anchored)
      expect(keyer.tick(endsAt)).toBe(true)
      expect(keyer.state(endsAt)).toMatchObject({ text: 'T#', finishReason: anchored ? 'settle' : 'pause' })
    })
  }

  it('commits a complete 6-symbol code normally, at the letter gap', () => {
    // ? is ..--.. : a code, and no longer code starts with it. Sent where T is expected (the error path).
    const log = keyCodes(['..--..'])
    const upAt = log.at(-1).t
    const waiting = interpret(log, { errorGapUnits, target: 'T', unitMs: U, now: upAt })
    expect(waiting.letters).toEqual([])
    expect(pendingMarks(waiting)).toBe(6)
    const closed = interpret(log, { errorGapUnits, target: 'T', unitMs: U, now: upAt + errorGapUnits * U })
    expect(closed.text).toBe('?')

    expect(interpret(log, { errorGapUnits, target: 'T', unitMs: U, anchored: false, final: true }).text).toBe('?')
  })

  it('decodes the 7-symbol $ from timing alone', () => {
    expect(interpret(keyCodes(['...-..-', '.']), { errorGapUnits, target: '$E', unitMs: U, anchored: false, final: true }).text).toBe('$E')
  })
})

describe('bug B: the cursor stops at the end of the passage', () => {
  const target = 'TO'
  const log = keyCodes(['-', '---', '.', '..', '...', '-', '.-'])

  it('never moves the cursor past the end; letters past it are overrun, with no extra hypotheses', () => {
    for (const state of statesAfterEachRelease(log, { target })) {
      expect(state.cursor).toBeLessThanOrEqual(target.length)
      expect(state.lettersSent).toBeLessThanOrEqual(target.length)
    }
    const run = interpret(log, { errorGapUnits, target, unitMs: U, final: true })
    expect(run.text).toBe('TOEISTA')
    expect(run.cursor).toBe(2)
    expect(run.letters.slice(2).every(letter => letter.kind === 'overrun')).toBe(true)
    expect(run.beamWidth).toBe(1)
  })

  it('grades overrun as insertions', () => {
    const run = interpret(log, { errorGapUnits, target, unitMs: U, final: true })
    expect(grade({ target, sent: run.text }).counts).toEqual({ match: 2, substitute: 0, insert: 5, delete: 0 })
  })

  it('never shows more letters sent than the passage has, anchored or not', () => {
    for (const anchored of [true, false]) {
      for (const state of statesAfterEachRelease(log, { target, anchored })) {
        expect(state.lettersSent).toBeLessThanOrEqual(lettersOf(target).length)
      }
    }
  })

  it('keeps restarting the settle period through overrun', () => {
    const keyer = createKeyer({ errorGapUnits, target, unitMs: U })
    feed(keyer, log)
    const lastUp = log.at(-1).t
    const settle = settleGapMs(U)
    expect(keyer.state(lastUp).finalizeAt).toBe(lastUp + settle)
    expect(keyer.tick(lastUp + settle - 1)).toBe(false)
    expect(keyer.tick(lastUp + settle)).toBe(true)
  })
})

describe('the error prosign', () => {
  // T, then M where E is expected, then the prosign, then E and A.
  const codes = ['-', '--', ERROR_PROSIGN, '.', '.-']
  const log = keyCodes(codes)
  const target = 'TEA'
  const prosignLastUp = log.filter(event => event.type === 'up')[1 + 2 + 8 - 1].t

  for (const anchored of [true, false]) {
    it(`takes back the letter before it and rewinds the cursor (${anchored ? 'anchored' : 'unanchored'})`, () => {
      expect(interpret(keyCodes(['-', '--']), { errorGapUnits, target, unitMs: U, anchored, final: true }).text).toBe('TM')

      const cut = log.findIndex(event => event.t === prosignLastUp)
      const now = prosignLastUp + 1
      const after = interpret(log.slice(0, cut + 1), { errorGapUnits, target, unitMs: U, anchored, now })
      expect(after).toMatchObject({ text: 'T', lettersSent: 1, scrubbedLetters: 1, prosignHeard: true })
      if (anchored) expect(after.cursor).toBe(1)
      expect(after.scrubs).toHaveLength(1)
      expect(after.scrubs[0].letter.char).toBe('M')
      // Neither the prosign's dots nor the letter it took back stay on the strip.
      expect(after.strip.map(mark => mark.symbol).join('')).toBe('-')

      const run = interpret(log, { errorGapUnits, target, unitMs: U, anchored, final: true })
      expect(run.text).toBe('TEA')
      expect(grade({ target, sent: run.text }).accuracy).toBe(100)
    })
  }

  it('acknowledges the prosign for a moment, then lets it go', () => {
    const cut = log.findIndex(event => event.t === prosignLastUp)
    const partial = log.slice(0, cut + 1)
    const state = interpret(partial, { errorGapUnits, target, unitMs: U, now: prosignLastUp + 10 })
    expect(state.prosignHeard).toBe(true)
    expect(state.nextCheckAt).toBeLessThanOrEqual(prosignLastUp + 2500)
    expect(interpret(partial, { errorGapUnits, target, unitMs: U, now: prosignLastUp + 2500 }).prosignHeard).toBe(false)
  })

  it('does not fire for seven dots and a dash: that is a garbled letter, not a prosign', () => {
    for (const anchored of [true, false]) {
      // After T the passage expects O (---), so the dots are on the error path from the first.
      const run = interpret(keyCodes(['-', '.......-']), { errorGapUnits, target: 'TO', unitMs: U, anchored, final: true })
      expect(run.scrubs).toEqual([])
      expect(run.text).toBe('T#')
    }
  })

  it('swallows extra dots run on after the eighth', () => {
    const run = interpret(keyCodes(['-', '--', '.'.repeat(11), '.', '.-']), { errorGapUnits, target, unitMs: U, final: true })
    expect(run.text).toBe('TEA')
    expect(run.scrubs).toHaveLength(1)
  })

  it('discards just the prosign when there is no letter to take back', () => {
    const run = interpret(keyCodes([ERROR_PROSIGN, '-', '.', '.-']), { errorGapUnits, target, unitMs: U, final: true })
    expect(run).toMatchObject({ text: 'TEA', scrubbedLetters: 0 })
    expect(run.scrubs).toHaveLength(1)
  })

  it('knows nothing about the passage: the same keying scrubs the same letter whatever the target', () => {
    for (const other of ['TMA', 'XYZ', 'TEAPOT']) {
      const run = interpret(log, { errorGapUnits, target: other, unitMs: U, final: true })
      expect(run.scrubs.map(scrub => scrub.letter?.char)).toEqual(['M'])
    }
  })
})

describe('the screenshot case', () => {
  const target = 'TO BE, OR NOT TO BE.'
  const last = lettersOf(target).length - 1

  for (const anchored of [true, false]) {
    it(`finalizes on silence and grades exactly one error when the final period is keyed as nine dashes (${anchored ? 'anchored' : 'unanchored'})`, () => {
      const log = synthesizeKeying(target, { wpm: WPM, codeFor: (char, i) => (i === last ? '-'.repeat(9) : toMorse(char)) })
      const keyer = createKeyer({ errorGapUnits, target, unitMs: U, anchored })
      feed(keyer, log)
      const lastUp = log.at(-1).t
      const during = keyer.state(lastUp)
      expect(during.lettersSent).toBeLessThanOrEqual(lettersOf(target).length)

      const endsAt = endOfSilence(keyer, lastUp, anchored)
      expect(keyer.tick(endsAt - 1)).toBe(false)
      expect(keyer.tick(endsAt)).toBe(true)
      const run = keyer.state(endsAt)
      expect(run.finishReason).toBe(anchored ? 'settle' : 'pause')
      expect(run.text).toBe(`${lettersOf(target).slice(0, -1)}#`)
      const { counts } = grade({ target, sent: run.text, elapsedMs: run.elapsedMs, letterUnits: run.letterUnits })
      expect(counts).toEqual({ match: last, substitute: 1, insert: 0, delete: 0 })
    })
  }
})

describe('undo shows what it removed', () => {
  const tap = (keyer, pad, t) => {
    keyer.padDown(pad, t)
    keyer.padUp(pad, t + 60)
  }

  it('reports the marks each undo took back, for a moment, including when there was nothing to take', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'AHE', unitMs: U })
    tap(keyer, '.', 0)
    tap(keyer, '-', 150) // A, committed
    tap(keyer, '.', 600)
    tap(keyer, '.', 750) // two dots of H, in progress
    keyer.undo(1000)
    expect(keyer.state(1010)).toMatchObject({ tookBack: '..', text: 'A' })
    keyer.undo(1200)
    expect(keyer.state(1210)).toMatchObject({ tookBack: '.-', text: '' })
    keyer.undo(1400)
    expect(keyer.state(1410)).toMatchObject({ tookBack: '', text: '' })
    expect(keyer.state(1410).nextCheckAt).toBeLessThanOrEqual(1400 + CONFIG.undoAckMs)
    expect(keyer.state(1400 + CONFIG.undoAckMs).tookBack).toBeNull()
  })

  it('mashing undo removes committed letters one per press, each shown', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'TEA', unitMs: U })
    tap(keyer, '-', 0)
    tap(keyer, '.', 300)
    tap(keyer, '.', 600)
    tap(keyer, '-', 750)
    const shown = []
    for (let i = 0; i < 4; i++) {
      keyer.undo(2000 + i * 100)
      shown.push(keyer.state(2000 + i * 100 + 5).tookBack)
    }
    expect(shown).toEqual(['.-', '.', '-', ''])
  })
})
