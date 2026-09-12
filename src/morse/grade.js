// Grading a finished transmission against its passage.

const CHARS_PER_WORD = 5

/**
 * Compare what was sent with the target text, ignoring case.
 *
 * Both strings are compared as given, so pass the target through normalize()
 * first. Returns:
 *   accuracy  0–1: correct characters ÷ the longer of target and sent
 *   wpm       gross words per minute (five characters, spaces included, per word)
 *   chars     one entry per aligned position, in reading order:
 *             { kind: 'correct' | 'wrong' | 'missed' | 'extra', expected, actual }
 *             where expected or actual is null for missed / extra characters
 *   counts    how many of each kind
 */
export function grade({ target, sent, elapsedMs }) {
  const chars = align(target, sent)
  const counts = { correct: 0, wrong: 0, missed: 0, extra: 0 }
  for (const { kind } of chars) counts[kind]++

  const longest = Math.max(target.length, sent.length)
  const accuracy = longest === 0 ? 1 : counts.correct / longest
  const wpm = elapsedMs > 0 ? sent.length / CHARS_PER_WORD / (elapsedMs / 60_000) : 0

  return { accuracy, wpm, chars, counts }
}

const same = (a, b) => a.toUpperCase() === b.toUpperCase()

// Levenshtein alignment. cost[i][j] is the edit distance between target[i:]
// and sent[j:]; walking it forward from the start resolves ties in reading
// order, preferring a paired character, then a missed one, then an extra one.
function align(target, sent) {
  const rows = target.length
  const cols = sent.length
  const cost = Array.from({ length: rows + 1 }, (_, i) =>
    Array.from({ length: cols + 1 }, (_, j) => (i === rows ? cols - j : j === cols ? rows - i : 0)),
  )

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      cost[i][j] = Math.min(
        cost[i + 1][j + 1] + (same(target[i], sent[j]) ? 0 : 1),
        cost[i + 1][j] + 1,
        cost[i][j + 1] + 1,
      )
    }
  }

  const chars = []
  let i = 0
  let j = 0
  while (i < rows || j < cols) {
    if (i < rows && j < cols) {
      const match = same(target[i], sent[j])
      if (cost[i][j] === cost[i + 1][j + 1] + (match ? 0 : 1)) {
        chars.push({ kind: match ? 'correct' : 'wrong', expected: target[i], actual: sent[j] })
        i++
        j++
        continue
      }
    }
    if (i < rows && cost[i][j] === cost[i + 1][j] + 1) {
      chars.push({ kind: 'missed', expected: target[i], actual: null })
      i++
    } else {
      chars.push({ kind: 'extra', expected: null, actual: sent[j] })
      j++
    }
  }

  return chars
}
