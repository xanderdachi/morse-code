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

  it('says what a letter taken back with the error prosign cost', () => {
    show({ mode: 'key', run: { scrubbedLetters: 1 } }, 4)
    expect(screen.getByText(/1 letter disregarded with the error prosign, counted as missed/)).toBeTruthy()
  })
})
