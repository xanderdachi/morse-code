// Target-anchored segmentation.
//
// We know the passage, so at every moment we know which letter the operator
// should be sending and its code. Marks accumulate in a buffer:
//   buffer == expected code          commit that letter now; timing plays no part
//   buffer is a prefix of the code   wait, however long the pause
//   buffer diverges                  the boundary is unknown: fall back to timing
//
// On the error path the letter is segmented by timing (a gap of the leniency
// table's errorGapUnits), and a small beam of hypotheses about what the wrong
// letter was (a substitution, an omission of the expected letter, or an
// insertion) keeps decoding in parallel until one resyncs with two exact
// matches in a row.
//
// Two facts about Morse itself apply on the error path, whatever the passage:
//   - After every symbol the buffer must still be a prefix of some code
//     (trie.js). The moment it isn't, it commits as #, and any symbols that
//     follow without a letter gap belong to that same garbled character.
//   - Eight dots in one buffer is the error prosign: the buffer is discarded
//     and the letter before it is taken back, cursor and all. Symbols run on
//     after it without a letter gap are part of the prosign.
//
// Past the end of the passage there is nothing left to anchor to: every
// further letter is overrun, and the cursor and the beam stay where they are.
//
// Anchoring decides boundaries only. A letter is always decoded from the marks
// actually sent, so a wrong symbol always produces a wrong letter.

import { fromMorse, toMorse } from './alphabet.js'
import { UNKNOWN_CHAR } from './decode.js'
import { CONFIG, errorGapMs, requireErrorGapUnits } from './timing.js'
import { ERROR_PROSIGN, isCodePrefix } from './trie.js'

const BEAM_WIDTH = 3
const RESYNC_STREAK = 2 // consecutive exact matches that end the error path
const CLEAR_LEAD = 2 // a hypothesis this much cheaper than the next wins outright

/**
 * Segment a run's marks into letters against a target.
 *
 *   steps          the run in order: { type: 'mark', id } | { type: 'boundary' } | { type: 'undo' }
 *   marks          by id: { id, symbol, gapBeforeMs, gapUnitMs, end }
 *   target         the passage with spaces removed, uppercase
 *   errorGapUnits  the error path's letter gap, from the tier's leniency table (required)
 *   final          the run is over: any pending buffer commits as sent
 *   silenceMs      how long it has been silent since the last mark (live runs)
 *   unitMs         the unit governing that silence
 *   lastEnd        when the last mark ended, for nextCheckAt
 *
 * Returns { letters, pendingIds, cursor, complete, nextCheckAt, beamWidth, scrubs }.
 * letters: [{ code, char, markIds, kind: 'match' | 'error' | 'overrun' }] in order.
 * scrubs: [{ markIds, letter }] for each error prosign, with the letter it took back (or null).
 */
export function anchorLetters(
  steps,
  marks,
  { target, errorGapUnits, final = false, silenceMs = null, unitMs, lastEnd = null, config = CONFIG },
) {
  requireErrorGapUnits(errorGapUnits)
  const ctx = {
    target,
    marks,
    config,
    codeAt: i => (i < target.length ? toMorse(target[i]) : undefined),
    // A gap long enough to end a letter on the error path.
    endsLetter: mark => mark.gapBeforeMs !== null && mark.gapBeforeMs >= errorGapMs(mark.gapUnitMs, errorGapUnits),
  }
  let beam = [
    { cursor: 0, buffer: '', bufferIds: [], mode: 'anchored', absorb: null, streak: 0, cost: 0, letters: null, before: null, scrubs: [] },
  ]

  for (const step of steps) {
    if (step.type === 'mark') beam = settle(beam.flatMap(h => advance(h, marks[step.id], ctx)))
    else if (step.type === 'boundary') beam = settle(beam.flatMap(h => closeLetter(h, ctx)))
    else if (step.type === 'undo') beam = [undo(beam[0])]
  }

  let nextCheckAt = null
  if (final) {
    beam = settle(beam.flatMap(h => closeLetter(h, ctx)))
  } else if (silenceMs !== null && beam.some(h => h.mode === 'error' && h.buffer)) {
    // Only the error path listens to silence; an anchored buffer waits indefinitely.
    const limit = errorGapMs(unitMs, errorGapUnits)
    if (silenceMs >= limit) beam = settle(beam.flatMap(h => (h.mode === 'error' ? closeLetter(h, ctx) : [h])))
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
    scrubs: best.scrubs,
  }
}

function advance(h, mark, ctx) {
  if (h.absorb) {
    if (!ctx.endsLetter(mark)) return [absorb(h, mark)]
    h = { ...h, absorb: null }
  }
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

  // Diverged (or past the end). Where this letter ends is no longer known, so re-read its marks by timing.
  let hypotheses = [{ ...h, mode: 'error', buffer: '', bufferIds: [], streak: 0 }]
  for (const id of bufferIds) hypotheses = hypotheses.flatMap(x => advance(x, ctx.marks[id], ctx))
  return hypotheses
}

function errorStep(h, mark, ctx) {
  if (h.buffer && ctx.endsLetter(mark)) return branch(h, ctx).flatMap(child => advance(child, mark, ctx))

  const next = { ...h, buffer: h.buffer + mark.symbol, bufferIds: [...h.bufferIds, mark.id] }
  if (next.buffer === ERROR_PROSIGN) return [scrub(next)]
  // No code starts like this: it is a garbled character, decided now rather than at the next gap.
  if (!isCodePrefix(next.buffer)) return branch(next, ctx).map(child => ({ ...child, absorb: 'garbled' }))
  return [next]
}

// End the letter in progress, if any, at a boundary, the end of the run or a long enough silence.
function closeLetter(h, ctx) {
  if (h.buffer) return branch(h, ctx)
  return [h.absorb ? { ...h, absorb: null } : h]
}

// Commit the buffer as sent, in three guesses at how it relates to the target.
function branch(h, ctx) {
  const code = h.buffer
  const char = fromMorse(code) ?? UNKNOWN_CHAR
  const end = ctx.target.length
  // Past the end there is only one guess: an extra letter.
  if (h.cursor >= end) return [commit(h, code, h.bufferIds, { cursor: end, cost: 1, streak: 0, kind: 'overrun' })]
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
    absorb: null,
    streak,
    cost: h.cost + cost,
    letters: { letter: { code, char: fromMorse(code) ?? UNKNOWN_CHAR, markIds, kind }, previous: h.letters },
    // The state just before this letter began, for undo and the error prosign.
    before: { ...h, buffer: '', bufferIds: [], mode: 'anchored', absorb: null, streak: 0 },
    scrubs: h.scrubs,
  }
}

// A symbol sent straight on, with no letter gap, after a garbled character or the error prosign.
function absorb(h, mark) {
  if (h.absorb === 'prosign') {
    const scrubs = h.scrubs.slice(0, -1)
    const last = h.scrubs.at(-1)
    return { ...h, scrubs: [...scrubs, { ...last, markIds: [...last.markIds, mark.id] }] }
  }
  const { letter, previous } = h.letters
  const garbled = { ...letter, code: letter.code + mark.symbol, markIds: [...letter.markIds, mark.id] }
  return { ...h, letters: { letter: garbled, previous } }
}

// The error prosign: drop the buffer, and take back the letter before it along with its cursor and cost.
function scrub(h) {
  const letter = h.letters?.letter ?? null
  const base = letter ? h.before : h
  return {
    ...base,
    buffer: '',
    bufferIds: [],
    mode: 'anchored',
    absorb: 'prosign',
    streak: 0,
    scrubs: [...h.scrubs, { markIds: h.bufferIds, letter }],
  }
}

// Undo drops the letter in progress, or else the last committed letter. Prosigns already sent stay sent.
function undo(h) {
  if (h.buffer) return { ...h, buffer: '', bufferIds: [], mode: 'anchored', absorb: null, streak: 0 }
  return h.before ? { ...h.before, scrubs: h.scrubs } : { ...h, absorb: null }
}

function settle(hypotheses) {
  const unique = new Map()
  for (const h of hypotheses) {
    const key = `${h.cursor}|${h.mode}|${h.buffer}|${h.absorb}`
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
