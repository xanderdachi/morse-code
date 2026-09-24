// The passage highlight and the SENT count follow the live keyer's displayCursor. While
// the error path weighs a wrong letter, the decoder's cursor steps back and forth; the
// display never follows it back. Only the operator taking a letter back moves it back.
//
// Every case is played live, the way the app sees it: each input at its moment, and a
// wake at each deadline in between. Letters are sent at 15 WPM with no jitter, so a
// letter gap (3 units) always outlasts the error path's gap (2 units): a wrong letter
// closes on silence, then opens again when the next press starts.

import { describe, expect, it } from 'vitest'
import { leniencyFor } from '../lib/progress.js'
import { normalize, toMorse } from './alphabet.js'
import { createKeyer } from './keyer.js'
import { playLive } from './testing/liveRun.js'
import { synthesizeScript } from './testing/syntheticKeyer.js'
import { unitMsForWpm } from './units.js'

const TEXT = 'The quick brown fox jumps over the lazy dog'
const LETTERS = normalize(TEXT).replaceAll(' ', '').toUpperCase()
const WPM = 15
// N (-.), mid-passage: after it come F (..-.) and O (---).
const N = 12

const { errorGapUnits } = leniencyFor(1)
const correct = [...LETTERS].map(char => ({ code: toMorse(char) }))

// `steps` (see synthesizeScript) played live. starts[i]: when step i's first mark went down.
function play(steps) {
  const log = synthesizeScript(steps, { wpm: WPM })
  const { frames, run } = playLive(log, { target: TEXT, errorGapUnits, unitMs: unitMsForWpm(WPM) })
  const downs = log.filter(event => event.type === 'down').map(event => event.t)
  let marks = 0
  const starts = steps.map(step => {
    const start = step.code ? downs[marks] : null
    marks += step.code?.length ?? 0
    return start
  })
  return { frames, run, starts }
}

// The frames from time `from` up to but not including `to`, and the display just before a moment.
const between = (frames, from, to) => frames.filter(frame => frame.at >= from && frame.at < to)
const displayBefore = (frames, t) => frames.findLast(frame => frame.at < t).displayCursor
const pressAt = (frames, t) => frames.find(frame => frame.at === t && frame.cause === 'down')

function expectNeverBack(frames) {
  frames.forEach((frame, i) => {
    if (i > 0 && !frame.tookBack) expect(frame.displayCursor, `frame ${i} at ${frame.at}`).toBeGreaterThanOrEqual(frames[i - 1].displayCursor)
  })
}

describe('display cursor: the three outcomes of a wrong letter', () => {
  it('a substitution mid-passage advances it by exactly one', () => {
    // K (-.-) for N (-.): its first two marks match N, the third makes it K, and the next press reopens it.
    const steps = correct.map((step, i) => (i === N ? { code: '-.-' } : step))
    const { frames, run, starts } = play(steps)

    expect(displayBefore(frames, starts[N])).toBe(N)
    const deciding = between(frames, starts[N], starts[N + 1] + 1)
    const onByOne = deciding.findIndex(frame => frame.displayCursor === N + 1)
    expect(onByOne).toBeGreaterThan(0)
    // Once the display is on by one, the decoder's cursor still goes back to N while the letter is decided...
    expect(deciding.slice(onByOne).some(frame => frame.cursor === N)).toBe(true)
    // ...last of all when the next press reopens it. The display stays on by one throughout, and no further.
    const next = pressAt(frames, starts[N + 1])
    expect(next.cursor).toBe(N)
    expect(next.displayCursor).toBe(N + 1)
    expect(deciding.slice(onByOne).every(frame => frame.displayCursor === N + 1)).toBe(true)

    expectNeverBack(frames)
    expect(run.text).toBe(`${LETTERS.slice(0, N)}K${LETTERS.slice(N + 1)}`)
  })

  it('an omission advances it by two', () => {
    // N left out: F comes where N belongs, and only the O after it shows that N was skipped.
    const steps = correct.filter((_, i) => i !== N)
    const { frames, run, starts } = play(steps)
    const [f, o, x] = [starts[N], starts[N + 1], starts[N + 2]]

    // F first reads as a substitution for N: one on.
    expect(displayBefore(frames, f)).toBe(N)
    expect(displayBefore(frames, o)).toBe(N + 1)
    // Once O settles it as a skip, the display moves two at once: N, and F where it really belongs.
    const settling = between(frames, o, x)
    expect(settling.some((frame, i) => i > 0 && frame.displayCursor - settling[i - 1].displayCursor === 2)).toBe(true)
    expect(displayBefore(frames, x)).toBe(N + 3)

    expectNeverBack(frames)
    // The skipped letter is counted: the display reaches the end with one letter fewer sent.
    expect(run.letters).toHaveLength(LETTERS.length - 1)
    expect(run.displayCursor).toBe(LETTERS.length)
  })

  it('an insertion leaves it unmoved, not rewound', () => {
    // An extra E before N. It first reads as a substitution for N; only N itself shows it was extra.
    const steps = [...correct.slice(0, N), { code: '.' }, ...correct.slice(N)]
    const { frames, run, starts } = play(steps)
    const [extra, n, f] = [starts[N], starts[N + 1], starts[N + 2]]

    expect(displayBefore(frames, extra)).toBe(N)
    // While N is sent the display holds at one on, though the cursor goes back to N...
    const settling = between(frames, n, f)
    expect(settling.some(frame => frame.cursor === N)).toBe(true)
    expect(settling.every(frame => frame.displayCursor === N + 1)).toBe(true)
    // ...and N, now at its place, leaves it there: the extra letter moved it nowhere.
    expect(settling.at(-1).cursor).toBe(N + 1)
    expect(displayBefore(frames, f)).toBe(N + 1)

    expectNeverBack(frames)
    expect(run.letters).toHaveLength(LETTERS.length + 1)
    expect(run.displayCursor).toBe(LETTERS.length)
  })

  it('a hard resync landing 3 letters behind leaves it where it was', () => {
    // After the last letter, eight more from a few words back. Past the end nothing can match, so
    // after the eighth the hard resync puts the cursor where the last five line up: 3 before the end.
    // (Mid-passage the beam's insertions catch a repeat long before eight letters go by, and the resync
    // only reaches 6 letters back, so the end is where a short backward resync can happen.)
    const end = LETTERS.length
    const again = [...LETTERS.slice(end - 11, end - 3)].map(char => ({ code: toMorse(char) }))
    const { frames, run } = play([...correct, ...again])

    const landed = frames.findIndex(frame => frame.cursor < end && frame.lettersSent === end)
    expect(landed).toBeGreaterThan(0)
    const [before, after] = [frames[landed - 1], frames[landed]]
    expect(after.kinds.slice(-8)).toBe('oooooooo')
    expect(after.cursor).toBe(end - 3)
    expect(before.displayCursor).toBe(end)
    expect(after.displayCursor).toBe(end)

    expectNeverBack(frames)
    expect(run.cursor).toBe(end - 3)
    expect(run.displayCursor).toBe(end)
  })
})

describe('display cursor: taking a letter back', () => {
  it('follows an undo back to where the decoder lands', () => {
    const steps = [...correct.slice(0, 5), { undo: 1 }, ...correct.slice(4, 8)]
    const { frames, starts } = play(steps)

    const undo = frames.find(frame => frame.cause === 'undo')
    expect(undo.tookBack).toBe(true)
    expect(displayBefore(frames, undo.at)).toBe(5)
    expect(undo.displayCursor).toBe(4)
    expect(undo.cursor).toBe(4)
    // Sending U again moves it on as usual.
    expect(displayBefore(frames, starts[7])).toBe(5)
    expectNeverBack(frames)
  })

  it('follows the error prosign back to where the decoder lands', () => {
    // K for N, then eight dots to take it back, then N.
    const steps = [...correct.slice(0, N), { code: '-.-' }, { code: '........' }, ...correct.slice(N)]
    const { frames, run, starts } = play(steps)

    const prosign = frames.find(frame => frame.tookBack)
    expect(prosign.at).toBeGreaterThan(starts[N + 1])
    expect(displayBefore(frames, prosign.at)).toBe(N + 1)
    expect(prosign.displayCursor).toBe(N)
    expect(prosign.cursor).toBe(N)
    expect(displayBefore(frames, starts[N + 3])).toBe(N + 1)
    expectNeverBack(frames)
    expect(run.text).toBe(LETTERS)
  })
})

describe('display cursor: the run around it', () => {
  // Six letters keyed live, the run still open.
  function keyedSix() {
    const keyer = createKeyer({ errorGapUnits, target: TEXT, unitMs: unitMsForWpm(WPM) })
    const log = synthesizeScript(correct.slice(0, 6), { wpm: WPM })
    for (const event of log) {
      if (event.type === 'down') keyer.keyDown(event.t)
      else keyer.keyUp(event.t)
    }
    const t = log.at(-1).t
    expect(keyer.state(t).displayCursor).toBe(6)
    return { keyer, t }
  }

  it('starts again from nothing when the run is reset', () => {
    const { keyer, t } = keyedSix()
    keyer.reset()
    expect(keyer.state(t).displayCursor).toBe(0)
  })

  it('starts again from the new passage when the target changes', () => {
    const { keyer, t } = keyedSix()
    keyer.configure({ target: 'Hi' })
    expect(keyer.state(t).displayCursor).toBeLessThanOrEqual(2)
  })
})
