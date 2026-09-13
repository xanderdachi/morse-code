// Where the lite transmission strip's marks move, worked out from their widths
// rather than by measuring the page.

// Widths in px, matching the classes in TransmissionStrip.jsx.
const WIDTHS = { dot: 15, dash: 40, letter: 2 }
const GAP = 7
const CARET = 3

/**
 * How far the kept marks and the caret moved, in px, going from `previous` to
 * `items` in a right-aligned row `boxWidth` wide. Null unless marks were only
 * dropped from the left and added on the right.
 */
export function rowMoves(previous, items, boxWidth) {
  const kept = new Set(items.map(item => item.key))
  const had = new Set(previous.map(item => item.key))
  const firstKept = previous.findIndex(item => kept.has(item.key))
  if (firstKept === -1) return null
  if (previous.slice(firstKept).some(item => !kept.has(item.key))) return null
  const lastKept = items.findLastIndex(item => had.has(item.key))
  if (items.slice(0, lastKept).some(item => !had.has(item.key))) return null

  // The row is left-aligned until it overflows, then pinned to the right edge.
  const offset = list => Math.min(0, boxWidth - rowWidth(list))
  const shift = offset(items) - offset(previous)
  return {
    marks: shift - span(previous.slice(0, firstKept)),
    caret: shift + rowWidth(items) - rowWidth(previous),
  }
}

const span = list => list.reduce((sum, item) => sum + WIDTHS[item.kind] + GAP, 0)
const rowWidth = list => span(list) + CARET
