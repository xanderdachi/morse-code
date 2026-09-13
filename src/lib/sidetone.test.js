import { describe, expect, it } from 'vitest'
import { createSidetone, SIDETONE } from './sidetone.js'

// A stand-in AudioContext that records what the sidetone schedules.
function fakeAudio({ state = 'suspended' } = {}) {
  const events = []
  const param = name => ({
    value: 0,
    setValueAtTime: (value, at) => events.push([name, 'set', value, at]),
    linearRampToValueAtTime: (value, at) => events.push([name, 'ramp', value, at]),
    cancelScheduledValues: at => events.push([name, 'cancel', at]),
    cancelAndHoldAtTime: at => events.push([name, 'hold', at]),
  })
  const contexts = []
  class AudioContextClass {
    constructor(options) {
      contexts.push(this)
      this.options = options
      this.state = state
      this.currentTime = 2
      this.destination = {}
    }
    createOscillator() {
      this.oscillator = { type: 'square', frequency: param('frequency'), connect() {}, start: () => events.push(['start']) }
      return this.oscillator
    }
    createGain() {
      this.gain = { gain: param('gain'), connect() {} }
      return this.gain
    }
    resume() {
      events.push(['resume'])
      this.state = 'running'
      return Promise.resolve()
    }
  }
  return { AudioContextClass, contexts, events }
}

const ramps = events => events.filter(([name, kind]) => name === 'gain' && kind === 'ramp').map(([, , value, at]) => [value, at])

describe('sidetone', () => {
  it('creates no audio until a gesture unlocks it, then resumes a suspended context', () => {
    const audio = fakeAudio()
    const tone = createSidetone({ AudioContextClass: audio.AudioContextClass })
    expect(audio.contexts).toHaveLength(0)
    tone.unlock()
    expect(audio.contexts).toHaveLength(1)
    expect(audio.events).toContainEqual(['resume'])
    expect(audio.contexts[0].state).toBe('running')
    tone.unlock()
    expect(audio.contexts).toHaveLength(1)
  })

  it('is a 600 Hz sine that ramps in and out over 5 ms', () => {
    const audio = fakeAudio({ state: 'running' })
    const tone = createSidetone({ AudioContextClass: audio.AudioContextClass })
    tone.hold('key', true)
    const context = audio.contexts[0]
    expect(context.oscillator.type).toBe('sine')
    expect(context.oscillator.frequency.value).toBe(600)
    context.currentTime = 3
    tone.hold('key', false)
    expect(ramps(audio.events)).toEqual([
      [SIDETONE.level, 2.005],
      [0, 3.005],
    ])
    // Each ramp starts from wherever the level has got to, never with a jump.
    expect(audio.events.filter(([name, kind]) => name === 'gain' && kind === 'hold')).toHaveLength(2)
  })

  it('keeps sounding until every holder lets go', () => {
    const audio = fakeAudio({ state: 'running' })
    const tone = createSidetone({ AudioContextClass: audio.AudioContextClass })
    tone.hold('dot', true)
    tone.hold('dash', true)
    tone.hold('dot', false)
    expect(ramps(audio.events)).toHaveLength(1)
    tone.hold('dash', false)
    expect(ramps(audio.events).at(-1)[0]).toBe(0)
  })

  it('does nothing, and never throws, without Web Audio', () => {
    const tone = createSidetone({ AudioContextClass: undefined })
    expect(() => {
      tone.unlock()
      tone.hold('key', true)
      tone.hold('key', false)
    }).not.toThrow()
    expect(tone.outputLatency).toBeNull()
  })
})
