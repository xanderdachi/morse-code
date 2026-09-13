// Target-anchored segmentation.
//
// We know the passage, so at every moment we know which letter the operator
// should be sending and its code. Marks accumulate in a buffer:
//   buffer == expected code          commit that letter now; timing plays no part
//   buffer is a prefix of the code   wait, however long the pause
//   buffer diverges                  the boundary is unknown: fall back to timing
//
// On the error path the letter is segmented by timing (a generous min(3u,
// u + 250ms) gap, or as soon as no longer code could follow), and a small beam
// of hypotheses about what the wrong letter was (a substitution, an omission
// of the expected letter, or an insertion) keeps decoding in parallel until one
// resyncs with two exact matches in a row.
//
// Anchoring decides boundaries only. A letter is always decoded from the marks
// actually sent, so a wrong symbol always produces a wrong letter.

import { CHAR_TO_MORSE, fromMorse, toMorse } from './alphabet.js'
import { UNKNOWN_CHAR } from './decode.js'
import { CONFIG, errorGapMs } from './timing.js'

const BEAM_WIDTH = 3
const RESYNC_STREAK = 2 // consecutive exact matches that end the error path
const CLEAR_LEAD = 2 // a hypothesis this much cheaper than the next wins outright

const CODES = Object.values(CHAR_TO_MORSE)
const PREFIXES = new Set(CODES.flatMap(code => [...code].map((_, i) => code.slice(0, i + 1))))
const PROPER_PREFIXES = new Set(CODES.flatMap(code => [...code].slice(0, -1).map((_, i) => code.slice(0, i + 1))))

/** A valid code that no longer valid code extends: nothing more can belong to this letter. */
const isTerminal = code => fromMorse(code) !== undefined && !PROPER_PREFIXES.has(code)

/**
 * Segment a run's marks into letters against a target.
 *
 *   steps     the run in order: { type: 'mark', id } | { type: 'boundary' } | { type: 'undo' }
 *   marks     by id: { id, symbol, gapBeforeMs, gapUnitMs }
 *   target    the passage with spaces removed, uppercase
 *   final     the run is over: any pending buffer commits as sent
 *   silenceMs how long it has been silent since the last mark (live runs)
 *   unitMs    the unit governing that silence
 *   lastEnd   when the last mark ended, for nextCheckAt
 *
 * Returns { letters, pendingIds, cursor, complete, nextCheckAt, beamWidth }.
 * letters: [{ code, char, markIds, kind: 'match' | 'error' }] in order.
 */
export function anchorLetters(steps, marks, { target, final = false, silenceMs = null, unitMs, lastEnd = null, config = CONFIG }) {
  const ctx = { target, marks, config, codeAt: i => (i < target.length ? toMorse(target[i]) : undefined) }
  let beam = [{ cursor: 0, buffer: '', bufferIds: [], mode: 'anchored', streak: 0, cost: 0, letters: null, before: null }]

  for (const step of steps) {
    if (step.type === 'mark') beam = settle(beam.flatMap(h => advance(h, marks[step.id], ctx)))
    else if (step.type === 'boundary') beam = settle(beam.flatMap(h => (h.buffer ? branch(h, ctx) : [h])))
    else if (step.type === 'undo') beam = [undo(beam[0])]
  }

  let nextCheckAt = null
  if (final) {
    beam = settle(beam.flatMap(h => (h.buffer ? branch(h, ctx) : [h])))
  } else if (silenceMs !== null && beam.some(h => h.mode === 'error' && h.buffer)) {
    // Only the error path listens to silence; an anchored buffer waits indefinitely.
    const limit = errorGapMs(unitMs, config)
    if (silenceMs >= limit) beam = settle(beam.flatMap(h => (h.mode === 'error' && h.buffer ? branch(h, ctx) : [h])))
    else if (lastEnd !== null) nextCheckAt = lastEnd + limit
  }

  const best = beam[0]
  return {
    letters: toArray(best.letters),
    pendingIds: best.bufferIds,
    cursor: best.cursor,
    complete: target.length > 0 && best.cursor >= target.length && best.buffer === '',
    nextCheckAt,
    beamWidth: beam.length,
  }
}

function advance(h, mark, ctx) {
  return h.mode === 'error' ? errorStep(h, mark, ctx) : anchoredStep(h, mark, ctx)
}

function anchoredStep(h, mark, ctx) {
  const expected = ctx.codeAt(h.cursor)
  const buffer = h.buffer + mark.symbol
  const bufferIds = [...h.bufferIds, mark.id]

  if (buffer === expected) {
    return [commit(h, buffer, bufferIds, { cursor: h.cursor + 1, cost: 0, streak: h.streak + 1, kind: 'match' })]
  }
  if (expected?.startsWith(buffer)) return [{ ...h, buffer, bufferIds }]

  // Diverged. Where this letter ends is no longer known, so re-read its marks by timing.
  let hypotheses = [{ ...h, mode: 'error', buffer: '', bufferIds: [], streak: 0 }]
  for (const id of bufferIds) hypotheses = hypotheses.flatMap(x => advance(x, ctx.marks[id], ctx))
  return hypotheses
}

function errorStep(h, mark, ctx) {
  if (h.buffer) {
    const boundary = mark.gapBeforeMs !== null && mark.gapBeforeMs >= errorGapMs(mark.gapUnitMs, ctx.config)
    if (boundary || !PREFIXES.has(h.buffer + mark.symbol)) {
      return branch(h, ctx).flatMap(child => advance(child, mark, ctx))
    }
  }
  const next = { ...h, buffer: h.buffer + mark.symbol, bufferIds: [...h.bufferIds, mark.id] }
  return isTerminal(next.buffer) ? branch(next, ctx) : [next]
}

// Commit the buffer as sent, in three guesses at how it relates to the target.
function branch(h, ctx) {
  const code = h.buffer
  const char = fromMorse(code) ?? UNKNOWN_CHAR
  const end = ctx.target.length
  const guesses = [
    { cursor: h.cursor + 1, cost: char === ctx.target[h.cursor] ? 0 : 1 }, // substituted for the expected letter
    { cursor: h.cursor + 2, cost: 1 + (char === ctx.target[h.cursor + 1] ? 0 : 1) }, // the expected letter was skipped
    { cursor: h.cursor, cost: 1 }, // an extra letter
  ]
  return guesses.map(guess =>
    commit(h, code, h.bufferIds, { cursor: Math.min(guess.cursor, end), cost: guess.cost, streak: 0, kind: 'error' }),
  )
}

function commit(h, code, markIds, { cursor, cost, streak, kind }) {
  return {
    cursor,
    buffer: '',
    bufferIds: [],
    mode: 'anchored',
    streak,
    cost: h.cost + cost,
    letters: { letter: { code, char: fromMorse(code) ?? UNKNOWN_CHAR, markIds, kind }, previous: h.letters },
    // The state just before this letter began, for undo.
    before: { ...h, buffer: '', bufferIds: [], mode: 'anchored', streak: 0 },
  }
}

// Undo drops the letter in progress, or else the last committed letter.
function undo(h) {
  if (h.buffer) return { ...h, buffer: '', bufferIds: [], mode: 'anchored', streak: 0 }
  return h.before ?? h
}

function settle(hypotheses) {
  const unique = new Map()
  for (const h of hypotheses) {
    const key = `${h.cursor}|${h.mode}|${h.buffer}`
    const existing = unique.get(key)
    if (!existing || h.cost < existing.cost) unique.set(key, h)
  }
  // Stable sort: equal costs keep generation order (substitution, omission, insertion).
  const beam = [...unique.values()].sort((a, b) => a.cost - b.cost).slice(0, BEAM_WIDTH)
  if (beam.length > 1 && (beam[0].streak >= RESYNC_STREAK || beam[0].cost + CLEAR_LEAD <= beam[1].cost)) return [beam[0]]
  return beam
}

function toArray(node) {
  const letters = []
  for (let n = node; n; n = n.previous) letters.push(n.letter)
  return letters.reverse()
}
