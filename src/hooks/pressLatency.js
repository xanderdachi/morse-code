// Dev only: how long a press takes from the input event to the keyer, to React's
// commit, and to the next frame. Marks are timed from event.timeStamp, so this
// lag never moves a recorded press. It is what the operator feels, though: the
// key cap, lamp and sidetone trail their hand by this much, and uneven lag
// muddles the rhythm they hear. Anything past ~30 ms is worth fixing.

export const LATENCY_BUDGET_MS = 30
const REPORT_EVERY = 20

export function createLatencyProbe({ enabled, log = console, now = () => performance.now() }) {
  if (!enabled) return { pressed() {}, committed() {} }

  const samples = []
  let pending = null

  function report() {
    const summary = {}
    for (const stage of ['engine', 'commit', 'frame']) {
      const values = samples.map(sample => sample[stage]).filter(Number.isFinite).sort((a, b) => a - b)
      if (values.length === 0) continue
      summary[stage] = {
        p50: round(values[Math.floor(values.length / 2)]),
        p95: round(values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]),
        max: round(values.at(-1)),
      }
    }
    log.debug?.(`[morse-club] press latency over the last ${samples.length} presses (ms)`, summary)
    samples.length = 0
  }

  function finish(sample) {
    samples.push(sample)
    globalThis.__morseLatency = [...(globalThis.__morseLatency ?? []).slice(-199), sample]
    if (sample.commit > LATENCY_BUDGET_MS) {
      log.warn?.(
        `[morse-club] slow press: ${round(sample.commit)} ms from ${sample.source}down to rendered state (budget ${LATENCY_BUDGET_MS} ms)`,
        sample,
      )
    }
    if (samples.length >= REPORT_EVERY) report()
  }

  return {
    /** A press reached the keyer; `stamp` is its event time. */
    pressed(stamp, source) {
      pending = { source, stamp, engine: now() - stamp }
    },
    /** React committed the held state. */
    committed() {
      if (!pending) return
      const sample = pending
      pending = null
      sample.commit = now() - sample.stamp
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          sample.frame = now() - sample.stamp
          finish(sample)
        })
      } else {
        finish(sample)
      }
    },
  }
}

function round(ms) {
  return Math.round(ms * 10) / 10
}
