// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_CHARS, MAX_RUNS, RUN_DUMP_KEY, clearRuns, loadRuns, runDumpEnabled, saveRun, startEventTrace } from './runDump.js'

afterEach(() => {
  localStorage.clear()
})

describe('run dump', () => {
  it('is on only with ?dump in the query', () => {
    expect(runDumpEnabled('')).toBe(false)
    expect(runDumpEnabled('?tier=2')).toBe(false)
    expect(runDumpEnabled('?dump')).toBe(true)
    expect(runDumpEnabled('?x=1&dump=1')).toBe(true)
  })

  it('keeps the last MAX_RUNS runs, oldest first', () => {
    for (let i = 0; i < MAX_RUNS + 5; i++) saveRun({ i })
    const runs = loadRuns()
    expect(runs).toHaveLength(MAX_RUNS)
    expect(runs[0].i).toBe(5)
    expect(runs.at(-1).i).toBe(MAX_RUNS + 4)
    clearRuns()
    expect(loadRuns()).toEqual([])
  })

  it('drops the oldest runs to stay under its storage budget, leaving room for progress', () => {
    const big = 'x'.repeat(MAX_CHARS / 4)
    for (let i = 0; i < 6; i++) expect(saveRun({ i, big })).toBeLessThanOrEqual(3)
    expect(localStorage.getItem(RUN_DUMP_KEY).length).toBeLessThanOrEqual(MAX_CHARS)
    expect(loadRuns().at(-1).i).toBe(5)
    expect(saveRun({ big: 'x'.repeat(MAX_CHARS) })).toBeNull()
  })

  it('traces input events with their stamps, naming only bound keys', () => {
    const trace = startEventTrace(window)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '.' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }))
    const events = trace.since(0)
    trace.stop()
    window.dispatchEvent(new KeyboardEvent('keyup', { key: '.' }))
    expect(events.map(event => [event.type, event.key])).toEqual([
      ['keydown', '.'],
      ['keydown', null],
    ])
    expect(trace.since(0)).toHaveLength(2)
    expect(typeof events[0].stamp).toBe('number')
  })

  it('traces the window losing focus, not focus moving between controls', () => {
    const button = document.body.appendChild(document.createElement('button'))
    const trace = startEventTrace(window)
    button.focus()
    button.blur()
    window.dispatchEvent(new FocusEvent('blur'))
    trace.stop()
    button.remove()
    expect(trace.since(0).map(event => event.type)).toEqual(['blur'])
  })
})
