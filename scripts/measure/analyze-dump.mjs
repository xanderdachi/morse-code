// Read a run dump from a real device and report what the headless harness can't see.
//
//   node scripts/measure/analyze-dump.mjs morse-club-runs-2026-09-16T10-00-00.json [more.json ...]
//
// Make a dump by opening the app with ?dump in the URL, keying, then Download (or Copy into a file).
//
// Per run:
//   stamps    the share of keystroke-log times that are the events' own stamps (event.timeStamp). Below 100%,
//             the browser's stamps weren't usable and the handler's clock stood in, so every main-thread delay
//             landed in the timing.
//   lag       listener time minus stamp, p50 / p99 / max: how late input reached the page
//   cancel, blur, hidden   interruptions during the run (pointercancel, window blur, page hidden)
//   bounces   presses shorter than the bounce filter, dropped
//   hold repeats  iambic holds that sent more than one element
//   stalls    times the iambic keyer stopped because the page fell behind
//   replay    the log decoded again here; 'DIFFERS' means the device decoded something else from the same log

import fs from 'node:fs'
import { leniencyFor } from '../../src/lib/progress.js'
import { interpret } from '../../src/morse/keyer.js'
import { CONFIG } from '../../src/morse/timing.js'
import { unitMsForWpm } from '../../src/morse/units.js'

const files = process.argv.slice(2)
if (!files.length) {
  console.error('usage: node scripts/measure/analyze-dump.mjs <dump.json> [...]')
  process.exit(1)
}

const round = n => (Number.isFinite(n) ? +n.toFixed(1) : null)
function percentile(values, p) {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

function device(userAgent = '') {
  const os = /iPhone|iPad/.test(userAgent) ? 'iOS' : /Android/.test(userAgent) ? 'Android' : /Mac OS X/.test(userAgent) ? 'macOS' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : '?'
  const browser = /EdgA?\//.test(userAgent) ? 'Edge' : /OPR\//.test(userAgent) ? 'Opera' : /Firefox\/|FxiOS/.test(userAgent) ? 'Firefox' : /CriOS|Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : '?'
  return `${os} ${browser}`
}

const runs = files.flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')))
const rows = []
const details = []
for (const [i, run] of runs.entries()) {
  const iambic = run.keyerMode === 'iambic'
  const log = run.log ?? []
  const events = run.events ?? []
  const first = log.find(entry => entry.type === 'down')?.t ?? null
  const last = log.at(-1)?.t ?? null
  const during = event => first !== null && event.stamp >= first - 50 && event.stamp <= last + 50

  const inputs = events.filter(event => /^(keydown|keyup|pointerdown|pointerup|pointercancel)$/.test(event.type) && !event.repeat)
  const lags = inputs.map(event => event.at - event.stamp)
  const stamps = new Set(events.map(event => event.stamp))
  const timed = log.filter(entry => entry.type === 'down' || entry.type === 'up')
  // The iambic keyer's log holds the elements it generated, not the paddles: only its first element starts at a stamp.
  const stamped = iambic ? null : timed.filter(entry => stamps.has(entry.t)).length

  const replay = interpret(log, {
    target: run.target,
    anchored: run.anchored,
    unitMs: iambic ? unitMsForWpm(run.keyerWpm) : (run.unitMs ?? CONFIG.defaultUnitMs),
    errorGapUnits: leniencyFor(run.tier).errorGapUnits,
  })

  const interruptions = events.filter(event => during(event) && (event.type === 'pointercancel' || event.type === 'blur' || (event.type === 'visibilitychange' && event.visibility === 'hidden')))
  const offClock = inputs.filter(event => Math.abs(event.at - event.stamp) > 5000).length

  rows.push({
    run: i + 1,
    ended: run.endedAt?.slice(11, 19),
    device: device(run.userAgent),
    input: iambic ? `iambic ${run.keyerWpm}` : run.mode,
    touch: run.touchControls ? 'yes' : 'no',
    accuracy: run.accuracy,
    sent: `${run.sent.length}/${run.target.replaceAll(' ', '').length}`,
    end: run.finishReason,
    presses: log.filter(entry => entry.type === 'down').length,
    stamps: stamped === null ? 'n/a' : events.length === 0 ? 'no events' : `${Math.round((100 * stamped) / Math.max(1, timed.length))}%`,
    'lag p50': round(percentile(lags, 50)),
    'lag p99': round(percentile(lags, 99)),
    'lag max': round(Math.max(...lags)),
    'off clock': offClock || '',
    repeats: events.filter(event => event.repeat).length || '',
    cancel: interruptions.filter(event => event.type === 'pointercancel').length || '',
    blur: interruptions.filter(event => event.type === 'blur').length || '',
    hidden: interruptions.filter(event => event.type === 'visibilitychange').length || '',
    bounces: (run.anomalies ?? []).filter(anomaly => anomaly.type === 'bounce').length || '',
    'hold repeats': (run.anomalies ?? []).filter(anomaly => anomaly.type === 'hold-repeat').length || '',
    stalls: (run.anomalies ?? []).filter(anomaly => anomaly.type === 'keyer-stall').length || '',
    replay: replay.text === run.sent ? 'same' : 'DIFFERS',
  })

  for (const event of interruptions) {
    // What the log did at the interruption: a release stamped at that moment, or nothing held.
    const releasedThen = log.some(entry => entry.type === 'up' && Math.abs(entry.t - event.stamp) < 1)
    details.push({ run: i + 1, event: event.type, 'ms into run': round(event.stamp - first), 'released a held key then': releasedThen ? 'yes' : 'no' })
  }
  if (replay.text !== run.sent) details.push({ run: i + 1, event: 'replay differs', device: run.sent, replayed: replay.text })
}

console.table(rows)
if (details.length) {
  console.log('\nINTERRUPTIONS AND REPLAY DIFFERENCES')
  console.table(details)
}

const byInput = new Map()
for (const [i, run] of runs.entries()) {
  const key = `${device(run.userAgent)} · ${rows[i].input}${run.touchControls ? ' · touch' : ''}`
  byInput.set(key, [...(byInput.get(key) ?? []), run])
}
console.log('\nBY DEVICE AND INPUT')
console.table(
  [...byInput].map(([key, group]) => {
    const lags = group.flatMap(run => (run.events ?? []).filter(event => /^(keydown|keyup|pointerdown|pointerup)$/.test(event.type) && !event.repeat).map(event => event.at - event.stamp))
    const accuracies = group.map(run => run.accuracy).filter(Number.isFinite)
    return {
      group: key,
      runs: group.length,
      'mean accuracy': round(accuracies.reduce((a, b) => a + b, 0) / accuracies.length),
      'runs under 98%': accuracies.filter(a => a < 98).length,
      'lag p50': round(percentile(lags, 50)),
      'lag p99': round(percentile(lags, 99)),
      'lag max': round(Math.max(...lags)),
    }
  }),
)
