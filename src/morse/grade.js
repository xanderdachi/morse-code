// Grading a finished transmission against its passage.

import { normalize } from './alphabet.js'
import { UNKNOWN_CHAR } from './decode.js'
import { WORD_SPACE_UNITS, characterUnits, textUnits, wordsPerMinute } from './units.js'

/**
 * Compare the letters sent with the passage.
 *
 * Spaces are never keyed, so they are never scored: the target is normalized
 * and stripped of spaces (compareTarget) and aligned against the sent letters
 * with Levenshtein edit distance, case-insensitively. A 40-character target
 * with 8 spaces is scored out of 32. Word breaks come back only in `review`,
 * for display.
 *
 *   target       the passage text (text_morse_safe)
 *   sent         the letters decoded (spaces, if any, are ignored)
 *   elapsedMs    sending time: first press to last release, pauses excluded
 *   letterUnits  PARIS units of the letters actually keyed; estimated from
 *                `sent` if omitted
 *   extraDeletions  letters to grade as missed on top of the alignment (a letter
 *                the operator took back where the tier makes that cost)
 *
 * Returns:
 *   accuracy      matches ÷ compareTarget length × 100, in [0, 100]
 *   wpm           PARIS words per minute of what was keyed, crediting the
 *                 passage's word spaces up to where the sending reached
 *   effectiveWpm  the same, counting only letters that came through correctly
 *   ops           [{ op: 'match' | 'substitute' | 'insert' | 'delete', expected, actual }]
 *   review        ops grouped into the passage's words, for the character review
 *   counts        how many of each op, extra deletions included
 */
export function grade({ target, sent, elapsedMs = 0, letterUnits, extraDeletions = 0 }) {
  const spaced = normalize(target)
  const compareTarget = spaced.replaceAll(' ', '')
  const received = normalize(sent, { keep: UNKNOWN_CHAR }).replaceAll(' ', '')
  const ops = align(compareTarget, received)

  const counts = { match: 0, substitute: 0, insert: 0, delete: 0 }
  for (const { op } of ops) counts[op]++
  const penalty = Math.max(0, Math.floor(extraDeletions) || 0)
  counts.delete += penalty

  const accuracy =
    compareTarget.length === 0
      ? received.length === 0
        ? 100
        : 0
      : Math.min(100, Math.max(0, (100 * (counts.match - penalty)) / compareTarget.length))

  // Word breaks: which target letters start a new word, and how many spaces the sending passed.
  const startsWord = []
  for (let i = 0, letter = 0; i < spaced.length; i++) {
    if (spaced[i] === ' ') continue
    startsWord[letter++] = i > 0 && spaced[i - 1] === ' '
  }
  const review = [[]]
  let targetIndex = 0
  let spacesReached = 0
  let spacesSeen = 0
  for (const entry of ops) {
    if (entry.expected !== null) {
      if (startsWord[targetIndex]) {
        review.push([])
        spacesSeen++
      }
      targetIndex++
      if (entry.actual !== null) spacesReached = spacesSeen
    }
    review.at(-1).push(entry)
  }

  const keyed = Number.isFinite(letterUnits) ? letterUnits : textUnits(received)
  const units = keyed > 0 ? keyed + WORD_SPACE_UNITS * spacesReached : 0
  const credited = creditedUnits(ops) + (counts.match > 0 ? WORD_SPACE_UNITS * spacesReached : 0)

  return {
    accuracy,
    wpm: wordsPerMinute(units, elapsedMs),
    effectiveWpm: wordsPerMinute(Math.min(credited, units), elapsedMs),
    ops,
    review: review.filter(word => word.length > 0),
    counts,
    extraDeletions: penalty,
    target: compareTarget,
    sent: received,
    unitsSent: units,
  }
}

const same = (a, b) => a.toUpperCase() === b.toUpperCase()

// cost[i][j] is the edit distance between target[i:] and sent[j:]. Walking it
// forward from the start resolves ties in reading order: pair the characters
// if that's optimal, otherwise prefer a delete, then an insert.
function align(target, sent) {
  const rows = target.length
  const cols = sent.length
  const cost = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1))
  for (let j = 0; j <= cols; j++) cost[rows][j] = cols - j
  for (let i = 0; i <= rows; i++) cost[i][cols] = rows - i

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      cost[i][j] = Math.min(
        cost[i + 1][j + 1] + (same(target[i], sent[j]) ? 0 : 1),
        cost[i + 1][j] + 1,
        cost[i][j + 1] + 1,
      )
    }
  }

  const ops = []
  let i = 0
  let j = 0
  while (i < rows || j < cols) {
    if (i < rows && j < cols) {
      const match = same(target[i], sent[j])
      if (cost[i][j] === cost[i + 1][j + 1] + (match ? 0 : 1)) {
        ops.push({ op: match ? 'match' : 'substitute', expected: target[i], actual: sent[j] })
        i++
        j++
        continue
      }
    }
    if (i < rows && cost[i][j] === cost[i + 1][j] + 1) {
      ops.push({ op: 'delete', expected: target[i], actual: null })
      i++
    } else {
      ops.push({ op: 'insert', expected: null, actual: sent[j] })
      j++
    }
  }
  return ops
}

// PARIS units of the target letters that were received correctly.
function creditedUnits(ops) {
  let units = 0
  for (const entry of ops) if (entry.op === 'match') units += characterUnits(entry.expected)
  // Nothing is sent after the last correct letter, so its trailing letter gap doesn't count.
  return Math.max(0, units - 3)
}
