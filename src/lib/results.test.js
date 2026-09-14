import { describe, expect, it } from 'vitest'
import { createKeyer } from '../morse/keyer.js'
import { ERROR_PROSIGN } from '../morse/trie.js'
import { synthesizeKeying } from '../morse/testing/syntheticKeyer.js'
import { defaultProgress, leniencyFor } from './progress.js'
import { DIVISIONS, divisionOf, scoreRun } from './results.js'

const TARGET = 'TEA'

// T, then M where E is expected, then the error prosign, then E and A: the run reads TEA.
function scrubbedRun(tier) {
  const codes = ['-', '--', ERROR_PROSIGN, '.', '.-']
  const log = synthesizeKeying('XXXXX', { wpm: 12, codeFor: (_, i) => codes[i] })
  const keyer = createKeyer({ errorGapUnits: leniencyFor(tier).errorGapUnits, target: TARGET, unitMs: 100 })
  for (const { type, t } of log) {
    if (type === 'down') keyer.keyDown(t)
    else keyer.keyUp(t)
  }
  return keyer.finish(log.at(-1).t + 1000)
}

const at = tier => ({ ...defaultProgress(), tier })

describe('the error prosign in grading', () => {
  it('leaves grading untouched at tier 2', () => {
    const run = scrubbedRun(2)
    expect(run).toMatchObject({ text: 'TEA', scrubbedLetters: 1 })
    const result = scoreRun({ run, target: TARGET, progress: at(2), mode: 'key' })
    expect(result.counts).toEqual({ match: 3, substitute: 0, insert: 0, delete: 0 })
    expect(result.accuracy).toBe(100)
  })

  it('adds exactly one deletion at tier 4', () => {
    const run = scrubbedRun(4)
    const result = scoreRun({ run, target: TARGET, progress: at(4), mode: 'key' })
    expect(result.counts).toEqual({ match: 3, substitute: 0, insert: 0, delete: 1 })
    expect(result.accuracy).toBeCloseTo((100 * 2) / 3, 6)
  })

  it('reads the cost from the leniency table at every tier', () => {
    for (let tier = 1; tier <= 5; tier++) {
      const result = scoreRun({ run: scrubbedRun(tier), target: TARGET, progress: at(tier), mode: 'key' })
      expect(result.counts.delete).toBe(leniencyFor(tier).prosign === 'deletion' ? 1 : 0)
    }
  })
})

describe('keyer and division on every result', () => {
  const run = scrubbedRun(1)

  it('records an iambic run with its configured speed, in its own division', () => {
    const result = scoreRun({ run, target: TARGET, progress: at(1), mode: 'pad', keyerMode: 'iambic', keyerWpm: 20 })
    expect(result).toMatchObject({ keyerMode: 'iambic', keyerWpm: 20, division: 'pad-iambic' })
  })

  it('records manual keying with no keyer speed', () => {
    expect(scoreRun({ run, target: TARGET, progress: at(1), mode: 'pad', keyerMode: 'manual', keyerWpm: 20 })).toMatchObject({
      keyerMode: 'manual',
      keyerWpm: null,
      division: 'pad-manual',
    })
    // The straight key has no keyer, whatever the pad setting says.
    expect(scoreRun({ run, target: TARGET, progress: at(1), mode: 'key', keyerMode: 'iambic', keyerWpm: 20 })).toMatchObject({
      keyerMode: 'manual',
      keyerWpm: null,
      division: 'straight-key',
    })
  })

  it('never puts iambic runs in the same division as anything else', () => {
    const divisions = [
      divisionOf({ mode: 'key', keyerMode: 'manual' }),
      divisionOf({ mode: 'pad', keyerMode: 'manual' }),
      divisionOf({ mode: 'pad', keyerMode: 'iambic' }),
    ]
    expect(new Set(divisions).size).toBe(3)
    expect(Object.keys(DIVISIONS).sort()).toEqual([...divisions].sort())
  })
})
