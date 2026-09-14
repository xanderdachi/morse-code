import { describe, expect, it } from 'vitest'
import { normalize, toMorse } from './alphabet.js'
import { grade } from './grade.js'
import { createKeyer, interpret } from './keyer.js'
import { synthesizeKeying, synthesizeTapping } from './testing/syntheticKeyer.js'
import { CONFIG, errorGapMs, pauseGapMs } from './timing.js'
import { unitMsForWpm } from './units.js'
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
const LONG = 'In a certain kingdom, in a certain land, there lived a Tsar who had three sons and one clever horse.'

const lettersOf = text => normalize(text).replaceAll(' ', '').toUpperCase()
const finish = (text, log, options = {}) => interpret(log, { errorGapUnits, target: text, final: true, ...options })
const scoreOf = (text, run) => grade({ target: text, sent: run.text, elapsedMs: run.elapsedMs, letterUnits: run.letterUnits })

/** `text` with letter k (counting letters only) removed, replaced or preceded by an extra letter. */
function editLetters(text, edits) {
  const chars = [...normalize(text)]
  const positions = chars.flatMap((char, i) => (char === ' ' ? [] : [i]))
  for (const { at, op, char } of [...edits].sort((a, b) => b.at - a.at)) {
    const i = positions[at]
    if (op === 'delete') chars.splice(i, 1)
    if (op === 'insert') chars.splice(i, 0, char)
    if (op === 'substitute') chars[i] = char
  }
  return chars.join('')
}

/** Live state just after the last mark of letter `letterIndex` (letters of the sent text) was released. */
function stateAfterLetter(text, log, sent, letterIndex) {
  const marksThrough = [...lettersOf(sent)].slice(0, letterIndex + 1).reduce((n, char) => n + toMorse(char).length, 0)
  const ups = log.filter(event => event.type === 'up')
  const cut = log.indexOf(ups[marksThrough - 1])
  return interpret(log.slice(0, cut + 1), { errorGapUnits, target: text, now: log[cut].t })
}

describe('anchored: perfect operators', () => {
  for (const wpm of [5, 10, 20, 30, 40]) {
    it(`decodes and grades 100% at ${wpm} WPM`, () => {
      for (const text of PASSAGES) {
        const run = finish(text, synthesizeKeying(text, { wpm }))
        expect(run.text).toBe(lettersOf(text))
        const result = scoreOf(text, run)
        expect(result.accuracy).toBe(100)
        expect(result.wpm).toBeCloseTo(wpm, 6)
      }
    })
  }

  it('produces letters with no spaces although the operator sends 7-unit word gaps', () => {
    const run = finish(PASSAGES[3], synthesizeKeying(PASSAGES[3], { wpm: 15 }))
    expect(run.text).not.toContain(' ')
    expect(run.strip.every(mark => mark.symbol === '.' || mark.symbol === '-')).toBe(true)
  })
})

describe('anchored: timing no longer decides letters', () => {
  it('survives a 30-second pause mid-letter, with the pause in paused time', () => {
    const text = PASSAGES[3]
    const plain = finish(text, synthesizeKeying(text, { wpm: 20 }))
    const log = synthesizeKeying(text, { wpm: 20, pauses: [{ letter: 5, mark: 1, ms: 30_000 }] })
    const run = finish(text, log)

    expect(run.text).toBe(lettersOf(text))
    expect(scoreOf(text, run).accuracy).toBe(100)
    // Everything past the pause threshold is paused time; the clock stops there.
    const threshold = pauseGapMs(unitMsForWpm(20))
    expect(run.pausedMs).toBeGreaterThan(30_000 - threshold)
    expect(run.pausedMs).toBeLessThanOrEqual(30_000)
    expect(run.elapsedMs).toBeCloseTo(run.endedAt - run.startedAt - run.pausedMs, 6)
    expect(run.elapsedMs).toBeLessThan(plain.elapsedMs + threshold + 1)
  })

  it('keeps an unfinished letter waiting through any silence, then commits it the instant it completes', () => {
    const u = 100
    const keyer = createKeyer({ errorGapUnits, target: 'HE', unitMs: u })
    let t = 0
    for (let dot = 0; dot < 3; dot++) {
      keyer.keyDown(t)
      keyer.keyUp(t + u)
      t += u + 5_000 // five seconds between dots
    }
    const waiting = keyer.state(t + 60_000)
    expect(waiting.letters).toEqual([])
    expect(waiting.strip.map(m => m.endsLetter)).toEqual([false, false, false])

    keyer.keyDown(t)
    keyer.keyUp(t + u)
    const done = keyer.state(t + u)
    expect(done.text).toBe('H')
    expect(done.cursor).toBe(1)
  })

  it('does not merge letters when the operator runs them together at speed', () => {
    const text = PASSAGES[4]
    // Every gap, letter and word gaps included, squeezed to about one unit.
    const log = synthesizeKeying(text.replaceAll(' ', ''), { wpm: 40 })
    const squeezed = []
    let shift = 0
    for (const [i, event] of log.entries()) {
      if (event.type === 'down' && i > 0) {
        const gap = event.t + shift - squeezed.at(-1).t
        shift -= gap - unitMsForWpm(40)
      }
      squeezed.push({ ...event, t: event.t + shift })
    }
    expect(finish(text, squeezed).text).toBe(lettersOf(text))
  })

  it('is untouched by wild gap timing: ±40% on every gap plus mid-letter hesitations', () => {
    for (const [i, text] of PASSAGES.entries()) {
      for (let seed = 1; seed <= 20; seed++) {
        const log = synthesizeKeying(text, {
          wpm: 8 + seed,
          gapJitter: 0.4,
          hesitation: { chance: 0.3, extraUnits: [2, 12] },
          seed: seed * 100 + i,
        })
        expect(finish(text, log).text, `passage ${i}, seed ${seed}`).toBe(lettersOf(text))
      }
    }
  })

  it('grades 100% with ±40% jitter on every element', () => {
    let runs = 0
    for (const wpm of [6, 12, 20, 30]) {
      for (let seed = 1; seed <= 60; seed++) {
        const text = PASSAGES[seed % PASSAGES.length]
        const run = finish(text, synthesizeKeying(text, { wpm, jitter: 0.4, seed: seed * 31 + 7 }))
        expect(scoreOf(text, run).accuracy, `${wpm} WPM, seed ${seed}`).toBe(100)
        runs++
      }
    }
    expect(runs).toBe(240)
  })

  it('reports how often ±40% press jitter defeats the shortest passage', () => {
    // 20 characters is ~42 presses: barely enough to separate 1.4u dots from 1.8u
    // dashes with no speed reference. Gap timing plays no part (see above).
    const text = PASSAGES[0]
    let failures = 0
    const runs = 400
    for (let seed = 1; seed <= runs; seed++) {
      if (finish(text, synthesizeKeying(text, { wpm: 15, jitter: 0.4, seed: seed * 11 + 5 })).text !== lettersOf(text)) failures++
    }
    console.info(`±40% press jitter on a 20-character passage: ${failures}/${runs} runs misread a press`)
    expect(failures / runs).toBeLessThanOrEqual(0.025)
  })

  it('grades 100% through a ramp from 8 to 35 WPM mid-passage', () => {
    const text = `${PASSAGES[4]} ${PASSAGES[3]} ${PASSAGES[5]}`
    const wpmAt = p => (p < 1 / 3 ? 8 : p > 2 / 3 ? 35 : 8 + 27 * (p - 1 / 3) * 3)
    const run = finish(text, synthesizeKeying(text, { wpmAt }))
    expect(scoreOf(text, run).accuracy).toBe(100)
  })
})

describe('anchored: mistakes stay mistakes', () => {
  it('ANTI-CHEAT: a dash where the target expects a dot produces that wrong letter', () => {
    // SOS, with the first S (...) keyed as -.. — which is D, and must stay D.
    const run = finish('SOS', synthesizeKeying('SOS', { wpm: 20, codeFor: (char, i) => (i === 0 ? '-..' : toMorse(char)) }))
    expect(run.text).toBe('DOS')
    const result = scoreOf('SOS', run)
    expect(result.ops[0]).toEqual({ op: 'substitute', expected: 'S', actual: 'D' })
    expect(result.accuracy).toBeCloseTo(200 / 3, 10)
  })

  it('ANTI-CHEAT: mid-passage, a flipped symbol decodes to exactly the letter sent', () => {
    const text = PASSAGES[3] // letter 10 is K (-.-)
    expect(lettersOf(text)[10]).toBe('K')
    const run = finish(text, synthesizeKeying(text, { wpm: 18, codeFor: (char, i) => (i === 10 ? '---' : toMorse(char)) }))
    expect(run.text[10]).toBe('O')
    expect(run.text).toBe(`${lettersOf(text).slice(0, 10)}O${lettersOf(text).slice(11)}`)
    expect(scoreOf(text, run).counts).toMatchObject({ substitute: 1, delete: 0, insert: 0 })
  })

  it('ANTI-CHEAT: a dot where a dash is expected is never promoted to the dash', () => {
    const run = finish('TEA', synthesizeKeying('TEA', { wpm: 25, codeFor: (char, i) => (i === 0 ? '.' : toMorse(char)) }))
    expect(run.text).toBe('EEA')
  })

  it('resyncs within three letters after an omitted letter and grades ~99%', () => {
    const sent = editLetters(LONG, [{ at: 40, op: 'delete' }])
    for (const wpm of [12, 25]) {
      const log = synthesizeKeying(sent, { wpm })
      const run = finish(LONG, log)
      expect(run.text).toBe(lettersOf(sent))
      expect(scoreOf(LONG, run).accuracy).toBeGreaterThanOrEqual(98.5)
      expect(stateAfterLetter(LONG, log, sent, 42).beamWidth).toBe(1)
    }
  })

  it('resyncs within three letters after an extra letter and grades ~99%', () => {
    const sent = editLetters(LONG, [{ at: 40, op: 'insert', char: 'Q' }])
    for (const wpm of [12, 25]) {
      const log = synthesizeKeying(sent, { wpm })
      const run = finish(LONG, log)
      expect(run.text).toBe(lettersOf(sent))
      expect(scoreOf(LONG, run).accuracy).toBeGreaterThanOrEqual(99)
      expect(stateAfterLetter(LONG, log, sent, 43).beamWidth).toBe(1)
    }
  })

  it('resyncs within three letters after a substituted letter', () => {
    const sent = editLetters(LONG, [{ at: 40, op: 'substitute', char: 'Q' }])
    const log = synthesizeKeying(sent, { wpm: 18 })
    expect(finish(LONG, log).text).toBe(lettersOf(sent))
    expect(stateAfterLetter(LONG, log, sent, 43).beamWidth).toBe(1)
  })

  it('still resyncs before the passage ends after two adjacent errors', () => {
    const cases = [
      [{ at: 40, op: 'substitute', char: 'Q' }, { at: 41, op: 'delete' }],
      [{ at: 40, op: 'delete' }, { at: 41, op: 'delete' }],
      [{ at: 40, op: 'insert', char: 'X' }, { at: 40, op: 'insert', char: 'Z' }],
      [{ at: 40, op: 'substitute', char: 'Q' }, { at: 41, op: 'substitute', char: 'J' }],
    ]
    for (const edits of cases) {
      const sent = editLetters(LONG, edits)
      const run = finish(LONG, synthesizeKeying(sent, { wpm: 16 }))
      // The last 30 letters are back in step with what was sent.
      expect(run.text.slice(-30)).toBe(lettersOf(sent).slice(-30))
      expect(scoreOf(LONG, run).accuracy).toBeGreaterThan(94)
    }
  })

  it('commits a letter still in progress at the end as what was sent', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'H', unitMs: 100 })
    keyer.keyDown(0)
    keyer.keyUp(100)
    keyer.keyDown(200)
    keyer.keyUp(300)
    expect(keyer.finish(400).text).toBe('I')
  })
})

describe('anchored: error path timing', () => {
  it('waits the leniency table\'s error gap of silence before closing a wrong letter, and schedules that check', () => {
    const u = 100
    const keyer = createKeyer({ errorGapUnits, target: 'EE', unitMs: u })
    keyer.keyDown(0)
    keyer.keyUp(300) // a dash where E is expected: the error path
    const limit = errorGapMs(u, errorGapUnits)
    expect(keyer.state(300)).toMatchObject({ letters: [], nextCheckAt: 300 + limit })
    expect(keyer.state(300 + limit - 1).letters).toEqual([])
    expect(keyer.state(300 + limit).text).toBe('T')
  })

  it('only schedules the pause check while anchored', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'AB', unitMs: 100 })
    keyer.keyDown(0)
    keyer.keyUp(100) // the first half of A: waiting, no timing involved
    const state = keyer.state(100)
    expect(state.nextCheckAt).toBe(100 + state.pauseAfterMs)
  })

  it('is complete when the last letter commits', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'ET', unitMs: 100 })
    keyer.keyDown(0)
    keyer.keyUp(100)
    expect(keyer.state(100).complete).toBe(false)
    keyer.keyDown(400)
    keyer.keyUp(700)
    expect(keyer.state(700)).toMatchObject({ complete: true, text: 'ET' })
  })
})

describe('pad', () => {
  it('decodes from symbols alone, however the taps are spaced', () => {
    const text = 'Wisdom is like a baobab tree'
    for (const [innerGapMs, letterGapMs] of [[90, 60], [900, 150], [150, 3000]]) {
      expect(finish(text, synthesizeTapping(text, { innerGapMs, letterGapMs })).text).toBe(lettersOf(text))
    }
  })

  it('forces a boundary with the end-letter control, even mid-letter', () => {
    const log = [
      { type: 'down', t: 0, pad: '.' },
      { type: 'up', t: 60, pad: '.' },
      { type: 'down', t: 120, pad: '.' },
      { type: 'up', t: 180, pad: '.' },
      { type: 'letter', t: 220 },
      { type: 'down', t: 300, pad: '.' },
      { type: 'up', t: 360, pad: '.' },
      { type: 'down', t: 420, pad: '.' },
      { type: 'up', t: 480, pad: '.' },
    ]
    expect(finish('H', log).text).toBe('II')
  })

  it('logs taps with enough detail to replay', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'ET' })
    keyer.padDown('.', 10)
    keyer.padUp('.', 80)
    keyer.commitLetter(120)
    keyer.padDown('-', 200)
    keyer.padUp('-', 260)
    const run = keyer.finish(400)
    expect(run.log).toEqual([
      { type: 'down', t: 10, pad: '.' },
      { type: 'up', t: 80, pad: '.' },
      { type: 'letter', t: 120 },
      { type: 'down', t: 200, pad: '-' },
      { type: 'up', t: 260, pad: '-' },
      { type: 'finish', t: 400 },
    ])
    expect(run.text).toBe('ET')
    expect(finish('ET', run.log).text).toBe('ET')
  })
})

describe('undo', () => {
  const tap = (keyer, pad, t) => {
    keyer.padDown(pad, t)
    keyer.padUp(pad, t + 60)
  }

  it('removes the last committed letter and rewinds the cursor', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'HE' })
    for (let i = 0; i < 4; i++) tap(keyer, '.', i * 200)
    tap(keyer, '-', 1000) // T where E is expected
    expect(keyer.state(3000)).toMatchObject({ text: 'HT', cursor: 2 })
    keyer.undo(3100)
    expect(keyer.state(3100)).toMatchObject({ text: 'H', cursor: 1 })
    tap(keyer, '.', 3200)
    const run = keyer.finish(3500)
    expect(run.text).toBe('HE')
    expect(grade({ target: 'HE', sent: run.text }).accuracy).toBe(100)
  })

  it('clears a letter still in progress before touching committed ones', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'EH' })
    tap(keyer, '.', 0)
    tap(keyer, '.', 300)
    tap(keyer, '.', 500) // E, then two dots of H
    expect(keyer.state(700)).toMatchObject({ text: 'E', cursor: 1 })
    keyer.undo(800)
    expect(keyer.state(800)).toMatchObject({ text: 'E', cursor: 1, strip: [{ id: 0, symbol: '.', endsLetter: true }] })
    keyer.undo(900)
    expect(keyer.state(900)).toMatchObject({ text: '', cursor: 0, strip: [] })
  })

  it('replays identically from the log', () => {
    const keyer = createKeyer({ errorGapUnits, target: 'HE' })
    for (let i = 0; i < 4; i++) tap(keyer, '.', i * 200)
    tap(keyer, '-', 1000)
    keyer.undo(3100)
    tap(keyer, '.', 3200)
    const run = keyer.finish(3500)
    expect(finish('HE', run.log).text).toBe(run.text)
  })
})

describe('config', () => {
  it('uses the leniency table\'s error-path gap and the specified pause threshold', () => {
    expect(errorGapUnits).toBe(2)
    expect(errorGapMs(60, errorGapUnits)).toBe(120)
    expect(() => interpret([], { target: 'E' })).toThrow(/leniency table/)
    expect(pauseGapMs(60)).toBe(2000)
    expect(pauseGapMs(300)).toBe(3000)
    expect(CONFIG.minPressMs).toBe(20)
  })
})
