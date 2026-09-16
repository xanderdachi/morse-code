// Extra letters cost accuracy: matches ÷ (passage letters + insertions).

import { describe, expect, it } from 'vitest'
import { leniencyFor } from '../lib/progress.js'
import { normalize, toMorse } from './alphabet.js'
import { grade } from './grade.js'
import { interpret } from './keyer.js'
import { synthesizeKeying, synthesizeScript } from './testing/syntheticKeyer.js'
import { CONFIG } from './timing.js'

const TEXT = 'In a certain kingdom, in a certain land, there lived a Tsar.'
const lettersOf = text => normalize(text).replaceAll(' ', '').toUpperCase()
const modes = [
  ['anchored', true, 1],
  ['unanchored', false, 5],
]

function accuracyOf(steps, { anchored, tier, wpm = 15, target = TEXT }) {
  const log = synthesizeScript(steps, { wpm, seed: 3, jitter: 0.1 })
  const run = interpret(log, { target, anchored, errorGapUnits: leniencyFor(tier).errorGapUnits, unitMs: CONFIG.defaultUnitMs, final: true })
  return { run, ...grade({ target, sent: run.text }) }
}

describe('insertions cost accuracy', () => {
  for (const [name, anchored, tier] of modes) {
    it(`grades an extra E after every letter near 50%, not 100% (${name})`, () => {
      const { accuracy, counts } = accuracyOf(
        [...lettersOf(TEXT)].flatMap(char => [{ code: toMorse(char) }, { code: '.' }]),
        { anchored, tier },
      )
      expect(counts.insert).toBeGreaterThan(30)
      // Anchored lands lower (about 38%): an extra dot can also join the next letter and spoil it.
      expect(accuracy).toBeGreaterThanOrEqual(30)
      expect(accuracy).toBeLessThanOrEqual(55)
    })

    it(`grades a garbled extra letter after every real letter near 50% (${name})`, () => {
      const { accuracy } = accuracyOf(
        [...lettersOf(TEXT)].flatMap(char => [{ code: toMorse(char) }, { code: '------' }]),
        { anchored, tier },
      )
      expect(Math.abs(accuracy - 50)).toBeLessThanOrEqual(10)
    })

    it(`still grades a clean run exactly 100% (${name})`, () => {
      for (const wpm of [5, 20, 35]) {
        const { accuracy, counts } = accuracyOf([...lettersOf(TEXT)].map(char => ({ code: toMorse(char) })), { anchored, tier, wpm })
        expect(counts.insert).toBe(0)
        expect(accuracy).toBe(100)
      }
    })
  }

  it('grades H sent where S belongs as one substitution, not a match plus a free insertion', () => {
    for (const [target, sent] of [
      ['SO', 'HO'],
      ['IS NOT', 'IHNOT'],
      ['PLEASANT', 'PLEWSANT'],
    ]) {
      const wrong = [...lettersOf(target)].findIndex((char, i) => char !== sent[i])
      for (const [name, anchored, tier] of modes) {
        for (const wpm of [5, 20, 35]) {
          const log = synthesizeKeying(target, { wpm, codeFor: (char, i) => (i === wrong ? toMorse(sent[i]) : toMorse(char)) })
          const run = interpret(log, { target, anchored, errorGapUnits: leniencyFor(tier).errorGapUnits, unitMs: 1200 / wpm, final: true })
          expect(run.text, `${target} at ${wpm} WPM, ${name}`).toBe(sent)
          expect(grade({ target, sent: run.text }).counts).toEqual({ match: sent.length - 1, substitute: 1, insert: 0, delete: 0 })
        }
      }
    }
  })
})
