import { describe, expect, it } from 'vitest'
import { normalize, toMorse } from './alphabet.js'
import { grade } from './grade.js'
import { createKeyer, interpret } from './keyer.js'
import { synthesizeKeying } from './testing/syntheticKeyer.js'
import { CONFIG, pauseGapMs, settleGapMs } from './timing.js'
import { unitMsForWpm } from './units.js'

const TEXT = 'In a certain kingdom, in a certain land, there lived a Tsar.' // ends with "."
const WPM = 18
const U = unitMsForWpm(WPM)

const lettersOf = text => normalize(text).replaceAll(' ', '').toUpperCase()

function feed(keyer, log) {
  for (const { type, t, pad } of log) {
    if (type === 'letter') keyer.commitLetter(t)
    else if (type === 'undo') keyer.undo(t)
    else if (pad && type === 'down') keyer.padDown(pad, t)
    else if (pad) keyer.padUp(pad, t)
    else if (type === 'down') keyer.keyDown(t)
    else keyer.keyUp(t)
  }
}

/**
 * Let time pass the way the hook does: sleep until the keyer's next check,
 * wake `lateMs` late, recompute. Never touches the keys. Stops at `until`.
 */
function waitInSilence(keyer, from, until, { lateMs = 0 } = {}) {
  let now = from
  for (let i = 0; i < 100 && !keyer.finalized; i++) {
    const next = keyer.state(now).nextCheckAt
    if (next === null || next + lateMs > until) break
    now = Math.max(now, next + lateMs)
    keyer.tick(now)
  }
  return { finalized: keyer.finalized, now }
}

function runOf(keyedText, { target = TEXT, codeFor, wpm = WPM, anchored = true } = {}) {
  const keyer = createKeyer({ target, anchored, unitMs: unitMsForWpm(wpm) })
  const log = synthesizeKeying(keyedText, { wpm, codeFor })
  feed(keyer, log)
  return { keyer, log, lastUp: log.at(-1).t }
}

const gradeOf = (run, target = TEXT) =>
  grade({ target, sent: run.text, elapsedMs: run.elapsedMs, letterUnits: run.letterUnits })

describe('finalize on silence, whatever was sent', () => {
  it('ends a run whose last letter is wrong and diverges, after the settle period, grading exactly one error', () => {
    const last = lettersOf(TEXT).length - 1
    const { keyer, lastUp } = runOf(TEXT, { codeFor: (char, i) => (i === last ? '--..--' : toMorse(char)) })

    const settle = settleGapMs(U)
    expect(waitInSilence(keyer, lastUp, lastUp + settle - 50).finalized).toBe(false)
    const { finalized, now } = waitInSilence(keyer, lastUp, lastUp + 60_000)
    expect(finalized).toBe(true)
    expect(now - lastUp).toBeLessThan(settle + 5)

    const run = keyer.state(now)
    expect(run.finishReason).toBe('settle')
    expect(run.text).toBe(`${lettersOf(TEXT).slice(0, -1)},`)
    expect(gradeOf(run).counts).toEqual({ match: lettersOf(TEXT).length - 1, substitute: 1, insert: 0, delete: 0 })
  })

  it('ends a run whose last letter is wrong but could still grow into the right one, after the 10s pause', () => {
    // "." is .-.-.- ; R (.-.) is its prefix, so the anchor waits for more.
    const last = lettersOf(TEXT).length - 1
    const { keyer, lastUp } = runOf(TEXT, { codeFor: (char, i) => (i === last ? '.-.' : toMorse(char)) })

    const endPause = pauseGapMs(U) + CONFIG.finishPauseAtEndMs
    expect(waitInSilence(keyer, lastUp, lastUp + endPause - 50).finalized).toBe(false)
    const { finalized, now } = waitInSilence(keyer, lastUp, lastUp + 120_000)
    expect(finalized).toBe(true)

    const run = keyer.state(now)
    expect(run.finishReason).toBe('pause')
    expect(run.text.at(-1)).toBe('R')
    expect(gradeOf(run).counts).toEqual({ match: lettersOf(TEXT).length - 1, substitute: 1, insert: 0, delete: 0 })
  })

  it('ends a run whose last letter was never sent, grading one deletion', () => {
    const { keyer, lastUp } = runOf(TEXT.slice(0, -1))
    const { finalized, now } = waitInSilence(keyer, lastUp, lastUp + 120_000)
    expect(finalized).toBe(true)
    const run = keyer.state(now)
    expect(run.finishReason).toBe('pause')
    expect(now - lastUp).toBeGreaterThanOrEqual(pauseGapMs(U) + CONFIG.finishPauseAtEndMs)
    expect(gradeOf(run).counts).toEqual({ match: lettersOf(TEXT).length - 1, substitute: 0, insert: 0, delete: 1 })
  })

  it('ends a run abandoned halfway through the pause rule, grading the rest as deletions', () => {
    const half = TEXT.slice(0, 26) // "In a certain kingdom, in a"
    const { keyer, lastUp } = runOf(half)
    const midPause = pauseGapMs(U) + CONFIG.finishPauseMidMs

    // A long think mid-passage is still free.
    expect(waitInSilence(keyer, lastUp, lastUp + midPause - 50).finalized).toBe(false)
    const { finalized, now } = waitInSilence(keyer, lastUp, lastUp + 600_000)
    expect(finalized).toBe(true)

    const run = keyer.state(now)
    const sentLetters = lettersOf(half).length
    expect(run.text).toBe(lettersOf(half))
    expect(gradeOf(run).counts).toEqual({
      match: sentLetters,
      substitute: 0,
      insert: 0,
      delete: lettersOf(TEXT).length - sentLetters,
    })
  })

  it('decides from real elapsed time: an early timer does nothing, a very late one still finalizes correctly', () => {
    const { keyer, lastUp } = runOf(TEXT)
    const due = keyer.state(lastUp + 1).finalizeAt
    expect(due).toBe(lastUp + settleGapMs(U))
    expect(keyer.tick(due - 1)).toBe(false)
    expect(keyer.finalized).toBe(false)
    expect(keyer.tick(due + 30_000)).toBe(true)
    expect(keyer.state(due + 30_000).elapsedMs).toBe(interpret(synthesizeKeying(TEXT, { wpm: WPM }), { target: TEXT, final: true }).elapsedMs)
  })
})

describe('after finalize', () => {
  it('discards all further keying: the grade and elapsed time do not change', () => {
    const { keyer, lastUp } = runOf(TEXT)
    const { now } = waitInSilence(keyer, lastUp, lastUp + 10_000)
    const before = keyer.state(now)
    const beforeGrade = gradeOf(before)
    const logLength = keyer.log.length

    expect(keyer.keyDown(now + 100)).toBe(false)
    expect(keyer.keyUp(now + 400)).toBe(false)
    expect(keyer.padDown('.', now + 500)).toBe(false)
    expect(keyer.commitLetter(now + 600)).toBe(false)
    expect(keyer.undo(now + 700)).toBe(false)
    expect(keyer.tick(now + 800)).toBe(false)
    expect(keyer.finish(now + 900)).toBe(before)

    const after = keyer.state(now + 5000)
    expect(keyer.log).toHaveLength(logLength)
    expect(after.text).toBe(before.text)
    expect(after.elapsedMs).toBe(before.elapsedMs)
    expect(gradeOf(after)).toEqual(beforeGrade)
  })

  it('ignores anything after a finish event when a saved log is replayed', () => {
    const { keyer, lastUp } = runOf(TEXT)
    const run = keyer.finish(lastUp + 100)
    const tampered = [...run.log, { type: 'down', t: lastUp + 500 }, { type: 'up', t: lastUp + 800 }]
    const replayed = interpret(tampered, { target: TEXT })
    expect(replayed.finalized).toBe(true)
    expect(replayed.text).toBe(run.text)
    expect(replayed.elapsedMs).toBe(run.elapsedMs)
  })
})

describe('the silence that ends a run never counts', () => {
  it('gives a perfect run the same WPM whether it settles at once or waits five seconds for Finish', () => {
    const stopDead = runOf(TEXT)
    const settled = waitInSilence(stopDead.keyer, stopDead.lastUp, stopDead.lastUp + 60_000)
    const quick = stopDead.keyer.state(settled.now)

    const lingering = createKeyer({ target: TEXT, unitMs: U })
    const log = synthesizeKeying(TEXT, { wpm: WPM })
    feed(lingering, log)
    const slow = lingering.finish(log.at(-1).t + 5000)

    expect(quick.finishReason).toBe('settle')
    expect(slow.finishReason).toBe('finish')
    expect(slow.elapsedMs).toBe(quick.elapsedMs)
    expect(gradeOf(slow).wpm).toBe(gradeOf(quick).wpm)
    expect(gradeOf(quick).wpm).toBeCloseTo(WPM, 6)
  })

  it('excludes a long pause at the end from elapsed time', () => {
    const { keyer, lastUp } = runOf(TEXT.slice(0, -1))
    const { now } = waitInSilence(keyer, lastUp, lastUp + 120_000)
    const run = keyer.state(now)
    expect(run.elapsedMs).toBe(run.endedAt - run.startedAt - run.pausedMs)
    expect(run.pausedMs).toBe(0)
  })
})

describe('overrun', () => {
  it('commits extra letters past the end by timing, grades them as insertions, and still finalizes', () => {
    const { keyer, lastUp } = runOf(`${TEXT} EE`)
    const { finalized, now } = waitInSilence(keyer, lastUp, lastUp + 60_000)
    expect(finalized).toBe(true)
    const run = keyer.state(now)
    expect(run.finishReason).toBe('settle')
    expect(run.text).toBe(`${lettersOf(TEXT)}EE`)
    expect(gradeOf(run).counts).toMatchObject({ match: lettersOf(TEXT).length, insert: 2, delete: 0 })
  })

  it('keeps restarting the settle period while the operator keeps keying', () => {
    const { keyer, lastUp } = runOf(TEXT)
    const settle = settleGapMs(U)
    keyer.tick(lastUp + settle / 2)
    keyer.keyDown(lastUp + settle / 2)
    keyer.keyUp(lastUp + settle / 2 + U)
    expect(keyer.tick(lastUp + settle + 10)).toBe(false)
    expect(keyer.tick(lastUp + settle / 2 + U + settle)).toBe(true)
  })
})

describe('Finish control', () => {
  it('ends the run immediately, committing a letter in progress as sent, # if it is no code', () => {
    // "..--" is on the way to ? (..--..) but is not a letter itself.
    const keyer = createKeyer({ target: '?', unitMs: 100 })
    feed(keyer, synthesizeKeying('?', { wpm: 12, codeFor: () => '..--' }))
    expect(keyer.state(3000).letters).toEqual([])
    const run = keyer.finish(3000)
    expect(run.text).toBe('#')
    expect(run.finishReason).toBe('finish')
  })

  it('reports how many letters remain, for showing the control near the end', () => {
    const { keyer } = runOf(TEXT.slice(0, -3))
    expect(keyer.state(10_000_000).remaining).toBe(3)
  })
})

describe('unanchored', () => {
  it('finalizes on the settle period once every letter has been sent', () => {
    const { keyer, lastUp } = runOf(TEXT, { anchored: false })
    const { finalized, now } = waitInSilence(keyer, lastUp, lastUp + 60_000)
    expect(finalized).toBe(true)
    const run = keyer.state(now)
    expect(run.text).toBe(lettersOf(TEXT))
    expect(gradeOf(run).wpm).toBeCloseTo(WPM, 6)
  })
})
