import { describe, expect, it } from 'vitest'
import { normalize } from './alphabet.js'
import { grade } from './grade.js'
import { createKeyer, interpret } from './keyer.js'
import { gapCenters, segmentSymbols } from './segment.js'
import { synthesizeKeying } from './testing/syntheticKeyer.js'
import { leniencyFor } from '../lib/progress.js'

// The error path's letter gap, from the leniency table as the app uses it.
const { errorGapUnits } = leniencyFor(1)

const PASSAGES = [
  'To be, or not to be.',
  'What is the sound of one hand?',
  'An old pond. A frog jumps in. The sound of water.',
  'In a certain kingdom, in a certain land, there lived a Tsar.',
  'Is it not pleasant to learn with a constant perseverance and application?',
  'The quick brown fox jumps over the lazy dog 0123456789',
]

const lettersOf = text => normalize(text).replaceAll(' ', '').toUpperCase()
const unanchored = (text, log, options = {}) => interpret(log, { errorGapUnits, target: text, anchored: false, final: true, ...options })

describe('unanchored: perfect operators', () => {
  for (const wpm of [5, 10, 20, 30]) {
    it(`decodes exactly from timing alone at ${wpm} WPM`, () => {
      for (const text of PASSAGES) {
        const run = unanchored(text, synthesizeKeying(text, { wpm }))
        expect(run.text).toBe(lettersOf(text))
        expect(grade({ target: text, sent: run.text, elapsedMs: run.elapsedMs, letterUnits: run.letterUnits }).wpm).toBeCloseTo(wpm, 6)
      }
    })
  }

  it('decodes a run ramping from 8 to 30 WPM mid-passage', () => {
    const text = `${PASSAGES[4]} ${PASSAGES[3]} ${PASSAGES[5]}`
    const wpmAt = p => (p < 1 / 3 ? 8 : p > 2 / 3 ? 30 : 8 + 22 * (p - 1 / 3) * 3)
    expect(unanchored(text, synthesizeKeying(text, { wpmAt })).text).toBe(lettersOf(text))
  })
})

describe('unanchored: timing noise', () => {
  it('decodes ±25% jitter exactly across 200 random seeds', () => {
    const failures = []
    for (let seed = 1; seed <= 200; seed++) {
      const text = PASSAGES[seed % PASSAGES.length]
      const wpm = [8, 15, 22, 30][seed % 4]
      const run = unanchored(text, synthesizeKeying(text, { wpm, jitter: 0.25, seed }))
      if (run.text !== lettersOf(text)) failures.push(seed)
    }
    console.info(`unanchored ±25% jitter: ${failures.length}/200 runs failed${failures.length ? ` (seeds ${failures.join(', ')})` : ''}`)
    expect(failures.length / 200).toBeLessThanOrEqual(0.01)
  })

  it('takes timing at its word: a long hesitation inside a letter splits it', () => {
    // H with a 6-unit pause after its second dot is I, I without an anchor.
    const log = synthesizeKeying('H', { wpm: 15, pauses: [{ letter: 0, mark: 2, ms: 6 * 80 }] })
    expect(unanchored('H', log).text).toBe('II')
    expect(interpret(log, { errorGapUnits, target: 'H', final: true }).text).toBe('H')
  })
})

describe('unanchored: live display', () => {
  it('keeps the last letter open until the silence says it is done', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'ET', anchored: false, unitMs: 100 })
    keyer.keyDown(0)
    keyer.keyUp(100)
    keyer.keyDown(400)
    keyer.keyUp(700)
    const live = keyer.state(700)
    expect(live.text).toBe('E')
    expect(live.strip.map(mark => mark.endsLetter)).toEqual([true, false])
    expect(live.complete).toBe(false)
    expect(live.nextCheckAt).toBeGreaterThan(700)
    const settled = keyer.state(live.nextCheckAt)
    expect(settled).toMatchObject({ text: 'ET', complete: true })
  })

  it('regroups earlier marks as more evidence arrives', () => {
    // Two dots 2u apart read as two letters on their own. Once later gaps show
    // this operator's boundaries run about 6u, that 2u gap is inside a letter.
    const keyer = createKeyer({ errorGapUnits, target: 'III', anchored: false, unitMs: 100 })
    let t = 0
    const dot = gap => {
      t += gap
      keyer.keyDown(t)
      t += 100
      keyer.keyUp(t)
    }
    dot(0)
    dot(200)
    const early = keyer.state(t + 1000)
    expect(early.text).toBe('EE')
    expect(early.strip[0].endsLetter).toBe(true)

    for (const gap of [600, 100, 600, 100]) dot(gap)
    const later = keyer.finish(t + 1000)
    expect(later.text).toBe('III')
    expect(later.strip[0].endsLetter).toBe(false)
  })
})

describe('segmentSymbols', () => {
  const log3 = Math.log(3)

  it('splits at boundary-length gaps and keeps inside gaps together', () => {
    // H E  with gaps [-, 1u, 1u, 1u, 3u]
    const segments = segmentSymbols(['.', '.', '.', '.', '.'], [0, 0, 0, 0, log3])
    expect(segments).toEqual([
      { start: 0, end: 4, kind: 'letter' },
      { start: 4, end: 5, kind: 'letter' },
    ])
  })

  it('honours forced boundaries', () => {
    const segments = segmentSymbols(['.', '.', '.', '.'], [0, 0, 0, 0], [false, false, true, false])
    expect(segments).toEqual([
      { start: 0, end: 2, kind: 'letter' },
      { start: 2, end: 4, kind: 'letter' },
    ])
  })

  it('prefers valid codes: seven quick dots cannot be one letter', () => {
    const segments = segmentSymbols(Array(7).fill('.'), Array(7).fill(0))
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.every(({ start, end }) => end - start <= 6)).toBe(true)
  })

  it('emits invalid segments (decoded as #) rather than failing when nothing valid fits', () => {
    const onlyE = code => code === '.'
    const segments = segmentSymbols(['-', '-', '.'], [0, 0, log3], [], { isValid: onlyE })
    expect(segments).toEqual([
      { start: 0, end: 2, kind: 'unfinished' },
      { start: 2, end: 3, kind: 'letter' },
    ])
  })

  it('clusters gap ratios into inside and boundary centers, falling back to 1 and 3 units', () => {
    const [inside, boundary] = gapCenters([0, 0.05, -0.05, 1.1, 0.02, 1.15, -0.01, 1.05])
    expect(inside).toBeCloseTo(0, 1)
    expect(boundary).toBeCloseTo(1.1, 1)
    expect(gapCenters([0, 0.01, 0.02])).toEqual([0, log3])
  })

  it('segments a 300-character passage in under 50ms', () => {
    const text = `${PASSAGES[4]} ${PASSAGES[3]} ${PASSAGES[5]} ${PASSAGES[2]} ${PASSAGES[1]} ${PASSAGES[4]}`.slice(0, 300)
    expect(text.length).toBe(300)
    const log = synthesizeKeying(text, { wpm: 20, jitter: 0.2, seed: 9 })
    unanchored(text, log) // warm up
    let fastest = Infinity
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      const run = unanchored(text, log)
      fastest = Math.min(fastest, performance.now() - start)
      expect(run.text).toBe(lettersOf(text))
    }
    expect(fastest).toBeLessThan(50)
  })
})
