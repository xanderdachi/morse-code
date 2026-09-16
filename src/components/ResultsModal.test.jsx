// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MotionGlobalConfig } from 'framer-motion'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultProgress } from '../lib/progress.js'
import { scoreRun } from '../lib/results.js'
import ResultsModal from './ResultsModal.jsx'

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true
})

afterEach(cleanup)

const passage = { id: 'hamlet', title: 'Hamlet', author: 'William Shakespeare', culture: 'England', era: null, blurb: null, text: 'To be.' }
const run = { text: 'TOBE.', elapsedMs: 4000, pausedMs: 0, letterUnits: 40, anchored: true, scrubbedLetters: 0 }

function show(overrides, tier = 1) {
  const result = {
    ...scoreRun({ run: { ...run, ...overrides.run }, target: 'To be.', progress: { ...defaultProgress(), tier }, ...overrides }),
    passage,
    passageNumber: 1,
    anomalies: overrides.anomalies ?? [],
  }
  render(<ResultsModal open result={result} onClose={() => {}} onNext={() => {}} onRetry={() => {}} />)
}

describe('results: how the run was keyed', () => {
  it('labels an iambic run with its chosen speed instead of reporting a measured one', () => {
    show({ mode: 'pad', keyerMode: 'iambic', keyerWpm: 20 })
    expect(screen.getAllByText(/Iambic, 20 WPM/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Words / min')).toBeNull()
    expect(screen.queryByText('Effective wpm')).toBeNull()
  })

  it('reports measured speed for the straight key and the manual pad', () => {
    show({ mode: 'pad', keyerMode: 'manual', keyerWpm: 20 })
    expect(screen.getByText('Words / min')).toBeTruthy()
    expect(screen.queryByText(/Iambic/)).toBeNull()
  })

  it('says when presses were too short to register, since they are graded as missing', () => {
    show({
      mode: 'key',
      anomalies: [
        { type: 'bounce', t: 100, durationMs: 12 },
        { type: 'long-press', t: 900, durationMs: 5000 },
        { type: 'bounce', t: 1800, durationMs: 9 },
        { type: 'bounce', t: 2600, durationMs: 15 },
      ],
    })
    expect(screen.getByText('3 presses were too short to register, so they aren’t in what came down the wire.')).toBeTruthy()
    cleanup()
    show({ mode: 'key', anomalies: [{ type: 'bounce', t: 100, durationMs: 12 }] })
    expect(screen.getByText('1 press was too short to register, so it isn’t in what came down the wire.')).toBeTruthy()
    cleanup()
    show({ mode: 'key' })
    expect(screen.queryByText(/too short to register/)).toBeNull()
  })

  it('says when iambic holds sent more than one element, and says nothing when none did', () => {
    const repeat = elements => ({ type: 'hold-repeat', t: 100 * elements, durationMs: 396, elements, periodMs: 120 })
    show({ mode: 'pad', keyerMode: 'iambic', keyerWpm: 20, anomalies: [repeat(4), repeat(2), repeat(3), { type: 'bounce', t: 5, durationMs: 9 }, repeat(2)] })
    expect(screen.getByText('4 holds sent more than one element — tap once per dot or dash.')).toBeTruthy()
    expect(screen.getByText('1 press was too short to register, so it isn’t in what came down the wire.')).toBeTruthy()
    cleanup()
    show({ mode: 'pad', keyerMode: 'iambic', keyerWpm: 20, anomalies: [repeat(2)] })
    expect(screen.getByText('1 hold sent more than one element — tap once per dot or dash.')).toBeTruthy()
    cleanup()
    show({ mode: 'pad', keyerMode: 'iambic', keyerWpm: 20, anomalies: [{ type: 'long-press', t: 5, durationMs: 5000 }] })
    expect(screen.queryByText(/sent more than one element/)).toBeNull()
  })

  it('says when the keyer stopped because the device fell behind, and says nothing when it never did', () => {
    const stall = t => ({ type: 'keyer-stall', t, driftMs: 1890, suppressed: 16 })
    show({ mode: 'pad', keyerMode: 'iambic', keyerWpm: 20, anomalies: [stall(100), stall(900)] })
    expect(screen.getByText('This device fell behind 2 times, so the keyer stopped instead of guessing: a held paddle may have sent fewer elements than you held it for.')).toBeTruthy()
    cleanup()
    show({ mode: 'pad', keyerMode: 'iambic', keyerWpm: 20, anomalies: [stall(100)] })
    expect(screen.getByText(/This device fell behind once, so the keyer stopped instead of guessing/)).toBeTruthy()
    cleanup()
    show({ mode: 'pad', keyerMode: 'iambic', keyerWpm: 20 })
    expect(screen.queryByText(/fell behind/)).toBeNull()
  })

  it('scores an anchored run as symbol accuracy and says the review cannot see spacing; unanchored stays plain accuracy', () => {
    show({ mode: 'key', run: { anchored: true } })
    expect(screen.getByText('Symbol accuracy')).toBeTruthy()
    expect(screen.queryByText('Accuracy')).toBeNull()
    expect(screen.getByText(/Letter breaks follow the passage, so this checks each letter’s dots and dashes, not your spacing/)).toBeTruthy()
    cleanup()
    show({ mode: 'key', run: { anchored: false } })
    expect(screen.getByText('Accuracy')).toBeTruthy()
    expect(screen.queryByText('Symbol accuracy')).toBeNull()
    expect(screen.queryByText(/Letter breaks follow the passage/)).toBeNull()
  })

  it('says what a letter taken back with the error prosign cost', () => {
    show({ mode: 'key', run: { scrubbedLetters: 1 } }, 4)
    expect(screen.getByText(/1 letter disregarded with the error prosign, counted as missed/)).toBeTruthy()
  })
})
