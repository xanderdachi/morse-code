// Browser input pipeline: what the engine records against what was dispatched.
//
//   node scripts/measure/browser-pipeline.mjs run [results.jsonl] [--quick] [--iambic-load]
//   node scripts/measure/browser-pipeline.mjs report [results.jsonl]
//
// --iambic-load runs only the iambic keyer under CPU load (keyboard and touch, 15 / 25 / 30 WPM, 1x / 4x / 6x)
// and exits non-zero if any run sends MAX_EXTRAS or more extra elements, or fails to run.
//
// Needs puppeteer-core, which the project doesn't depend on: set PUPPETEER_FROM to a directory whose
// node_modules has it. CHROME_PATH defaults to the macOS Chrome install.
//
// `run` builds the production app with one addition, a wrapper that pushes every keyer the input hook
// creates onto window.__keyers so the raw keystroke log can be read back. It serves the build, opens
// headless Chrome and dispatches key, mouse and touch events through CDP on a schedule: a real passage,
// dots 1 unit, dashes 3, gaps 1 / 3 / 7. Every event is logged with the moment it was sent.
//
//   stamping 'explicit'  (the main grid) each event carries its scheduled time as its timestamp, the way an
//                        operating system stamps real input at the hardware. Anything between that stamp
//                        and the keyer log that moves, drops or duplicates an event shows up as error.
//   stamping 'arrival'   the browser stamps each event when the CDP command arrives. This mostly measures the
//                        harness: node's own stalls between reading the clock and writing the socket land in
//                        the stamp. Kept as a noise floor, next to the same thing on a blank page.
//
// Per run: press and gap error (recorded interval minus scheduled or sent interval), dropped and duplicated
// presses, delivery lag (performance.now() at a capture listener minus event.timeStamp, less the harness's own
// lateness in sending). With the iambic keyer: missing and extra elements. An extra element whose paddle
// release was stamped before the keyer's decision is the pipeline's fault if the release was sent on time,
// the harness's if it was sent too late to arrive before the decision.

import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fallbackPassages } from '../../src/lib/passages.js'
import { KEYER_WPM, STORAGE_KEY } from '../../src/lib/progress.js'
import { normalize, toMorse } from '../../src/morse/alphabet.js'
import { unitMsForWpm } from '../../src/morse/units.js'

const PROJECT = fileURLToPath(new URL('../..', import.meta.url))
const [command = 'run', outArg] = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const QUICK = process.argv.includes('--quick')
const IAMBIC_LOAD = process.argv.includes('--iambic-load')
const MAX_EXTRAS = 5 // --iambic-load: extra elements per run must stay under this
const OUT = outArg ?? path.join(os.tmpdir(), 'morse-pipeline.jsonl')

const SPEEDS = [8, 15, 25, 35, 45]
const THROTTLES = [1, 4, 6]
const IAMBIC_MAX_WPM = KEYER_WPM.max // the ceiling the app itself enforces: a faster job is run at it
const IAMBIC_LOAD_SPEEDS = [15, 25, IAMBIC_MAX_WPM]
const ELEMENTS = QUICK ? { 8: 12, 15: 20, 25: 30, 30: 30, 35: 30, 45: 30 } : { 8: 50, 15: 80, 25: 110, 30: 120, 35: 130, 45: 150 }
// A speed the table doesn't list keys the same number of elements as the fast end, rather than the whole passage.
const elementsFor = wpm => ELEMENTS[wpm] ?? (QUICK ? 30 : 130)
const EDGE_MS = 8 // iambic edge release: this long before the keyer's decision
const SPIN_MS = 4 // wait out the last stretch before each event in a busy loop: timers alone run late
const EXPLICIT_SEND_AFTER_MS = 2 // explicit stamps are sent this long after their time, so they are never in the future

// The longest built-in passage, chosen by marking the others cleared.
const PASSAGE = fallbackPassages.reduce((a, b) => (b.textMorseSafe.length > a.textMorseSafe.length ? b : a))

// ---------------------------------------------------------------------------------------------- run

async function run() {
  const require = createRequire(path.join(process.env.PUPPETEER_FROM ?? PROJECT, 'noop.js'))
  const imported = await import(pathToFileURL(require.resolve('puppeteer-core')).href)
  const puppeteer = imported.default?.launch ? imported.default : imported.default.default

  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'morse-pipeline-dist-'))
  await buildApp(dist)
  const server = await serve(dist)
  const origin = `http://127.0.0.1:${server.address().port}/`
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
    protocolTimeout: 300_000, // a page far behind can take minutes to answer
  })
  fs.writeFileSync(OUT, '')
  const record = row => fs.appendFileSync(OUT, `${JSON.stringify(row)}\n`)
  console.log(`passage "${PASSAGE.title}", ${planFor({ wpm: 20, elements: Infinity }).length} elements; writing ${OUT}`)

  const jobs = []
  if (IAMBIC_LOAD) {
    for (const profile of ['keyboard', 'touch']) {
      for (const wpm of IAMBIC_LOAD_SPEEDS) for (const throttle of THROTTLES) jobs.push({ mode: 'iambic', profile, wpm, throttle, stamping: 'explicit', release: 'comfortable' })
    }
  }
  const matrix = IAMBIC_LOAD ? [] : [
    ['key', 'keyboard'],
    ['key', 'mouse'],
    ['key', 'touch'],
    ['pad', 'keyboard'],
    ['pad', 'touch'],
    ['iambic', 'keyboard'],
    ['iambic', 'touch'],
  ]
  for (const [mode, profile] of matrix) {
    for (const wpm of SPEEDS) for (const throttle of THROTTLES) jobs.push({ mode, profile, wpm, throttle, stamping: 'explicit', release: 'comfortable' })
  }
  if (!IAMBIC_LOAD) {
    for (const profile of ['keyboard', 'touch']) {
      for (const wpm of IAMBIC_LOAD_SPEEDS) for (const throttle of THROTTLES) jobs.push({ mode: 'iambic', profile, wpm, throttle, stamping: 'explicit', release: 'edge' })
    }
    for (const profile of ['keyboard', 'touch']) {
      for (const wpm of [8, 25, 45]) for (const throttle of [1, 6]) jobs.push({ mode: 'key', profile, wpm, throttle, stamping: 'arrival', release: 'comfortable' })
      for (const throttle of [1, 6]) jobs.push({ mode: 'blank', profile, wpm: 25, throttle, stamping: 'arrival', release: 'comfortable' })
    }
  }

  const started = Date.now()
  for (const [i, job] of jobs.entries()) {
    const result = await runJob(browser, origin, job)
    record(result)
    const m = result.metrics
    const elapsed = ((Date.now() - started) / 60000).toFixed(1)
    console.log(
      `[${i + 1}/${jobs.length} ${elapsed}m] ${job.mode}/${job.profile} ${job.wpm}wpm ${job.throttle}x ${job.stamping} ${job.release}:`,
      m.error ?? `press p99 ${m.pressP99}ms gap p99 ${m.gapP99}ms dropped ${m.dropped} dup ${m.duplicated} extra ${m.extra ?? '-'} lag p99 ${m.lagP99}ms`,
    )
  }
  await browser.close()
  server.close()
  report(OUT)
  if (IAMBIC_LOAD) process.exitCode = iambicLoadVerdict(OUT) ? 0 : 1
}

// --iambic-load: every run under MAX_EXTRAS extra elements, and every run ran.
function iambicLoadVerdict(file) {
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  const table = rows.map(row => {
    const metrics = row.metrics.error ? row.metrics : analyze(row)
    return {
      input: `iambic/${row.profile}`,
      wpm: row.wpm,
      cpu: `${row.throttle}x`,
      presses: metrics.presses ?? '-',
      extra: metrics.extra ?? '-',
      missing: metrics.missing ?? '-',
      'lag p99': metrics.lagP99 ?? '-',
      verdict: metrics.error ? `FAIL: ${metrics.error.split('\n')[0]}` : metrics.extra < MAX_EXTRAS ? 'pass' : 'FAIL',
    }
  })
  console.log(`\nIAMBIC UNDER LOAD: extra elements per run must stay under ${MAX_EXTRAS}`)
  console.table(table)
  const failed = table.filter(row => row.verdict !== 'pass')
  console.log(failed.length ? `${failed.length} of ${table.length} runs FAILED.` : `All ${table.length} runs pass.`)
  return failed.length === 0
}

async function buildApp(outDir) {
  const vite = await import(pathToFileURL(path.join(PROJECT, 'node_modules/vite/dist/node/index.js')).href)
  const realKeyer = path.join(PROJECT, 'src/morse/keyer.js')
  await vite.build({
    root: PROJECT,
    configFile: path.join(PROJECT, 'vite.config.js'),
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true },
    plugins: [
      {
        name: 'expose-keyers',
        enforce: 'pre',
        resolveId(source, importer) {
          if (source === '../morse/keyer.js' && importer?.endsWith(`${path.sep}hooks${path.sep}useMorseInput.js`)) return '\0exposed-keyer'
        },
        load(id) {
          if (id !== '\0exposed-keyer') return
          return [
            `import * as real from ${JSON.stringify(realKeyer)}`,
            `export * from ${JSON.stringify(realKeyer)}`,
            'export function createKeyer(options) {',
            '  const keyer = real.createKeyer(options)',
            '  ;(window.__keyers ??= []).push(keyer)',
            '  return keyer',
            '}',
          ].join('\n')
        },
      },
    ],
  })
}

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/__blank__.html') {
      res.writeHead(200, { 'content-type': 'text/html' })
      // Default actions prevented, as the app prevents them: an unhandled Space floods headless Chrome with synthetic keydowns.
      res.end('<!doctype html><body style="margin:0;height:100vh;touch-action:none"><script>for (const type of ["pointerdown", "keydown", "keyup"]) addEventListener(type, event => event.preventDefault(), { passive: false })</script></body>')
      return
    }
    let file = path.join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// One element per entry: { symbol, at, length } in ms from the first press.
function planFor({ wpm, elements }) {
  const u = unitMsForWpm(wpm)
  const plan = []
  let t = 0
  const words = normalize(PASSAGE.textMorseSafe).toUpperCase().split(' ').filter(Boolean)
  for (const [w, word] of words.entries()) {
    for (const [c, char] of [...word].entries()) {
      for (const [s, symbol] of [...(toMorse(char) ?? '')].entries()) {
        if (plan.length >= elements) return plan
        if (plan.length) t += (s > 0 ? 1 : c > 0 ? 3 : w > 0 ? 7 : 0) * u
        const length = (symbol === '.' ? 1 : 3) * u
        plan.push({ symbol, at: t, length })
        t += length
      }
    }
  }
  return plan
}

const KEYS = {
  ' ': { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 },
  '.': { key: '.', code: 'Period', windowsVirtualKeyCode: 190, nativeVirtualKeyCode: 190 },
  '-': { key: '-', code: 'Minus', windowsVirtualKeyCode: 189, nativeVirtualKeyCode: 189 },
}

function commandFor({ mode, profile }, type, symbol, targets, timestamp) {
  const which = mode === 'key' || mode === 'blank' ? ' ' : symbol
  if (profile === 'keyboard') {
    const key = KEYS[which]
    return type === 'down'
      ? ['Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: key.key, unmodifiedText: key.key, timestamp }]
      : ['Input.dispatchKeyEvent', { type: 'keyUp', ...key, timestamp }]
  }
  const { x, y } = targets[which]
  if (profile === 'mouse') {
    return ['Input.dispatchMouseEvent', { type: type === 'down' ? 'mousePressed' : 'mouseReleased', x, y, button: 'left', buttons: type === 'down' ? 1 : 0, clickCount: 1, timestamp }]
  }
  return type === 'down'
    ? ['Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }], timestamp }]
    : ['Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp }]
}

async function openPage(browser, origin, job) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  if (job.profile === 'touch') {
    await page.emulate({
      viewport: { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    })
  } else {
    await page.setViewport({ width: 1280, height: 900 })
  }
  const storage = {
    onboardingSeen: true,
    inputMode: job.mode === 'key' ? 'key' : 'pad',
    keyerMode: job.mode === 'iambic' ? 'iambic' : 'manual',
    keyerWpm: Math.min(job.wpm, IAMBIC_MAX_WPM),
    unitMs: Math.min(400, Math.max(40, unitMsForWpm(job.wpm))),
    touchControls: job.profile === 'touch' ? 'on' : 'off',
    clearedPassageIds: fallbackPassages.filter(p => p.id !== PASSAGE.id).map(p => p.id),
  }
  await page.evaluateOnNewDocument(
    (key, stored) => {
      try {
        localStorage.setItem(key, JSON.stringify(stored))
      } catch {
        // storage blocked: the app falls back to defaults
      }
      window.__seen = []
      for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel', 'blur']) {
        window.addEventListener(
          type,
          event => {
            window.__seen.push({
              type,
              stamp: event.timeStamp,
              at: performance.now(),
              key: event.key,
              pointerType: event.pointerType,
              label: event.target?.closest?.('[aria-label]')?.getAttribute('aria-label') ?? null,
            })
          },
          { capture: true },
        )
      }
    },
    STORAGE_KEY,
    storage,
  )
  if (job.mode === 'blank') {
    await page.goto(`${origin}__blank__.html`, { waitUntil: 'domcontentloaded' })
  } else {
    await page.setRequestInterception(true)
    page.on('request', request => (/supabase|fonts\.g/.test(request.url()) ? request.abort() : request.continue()))
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  }
  const session = await page.createCDPSession()
  return { context, page, session, errors }
}

async function findTargets(page, job) {
  if (job.mode === 'blank') return { ' ': { x: 200, y: 300 } }
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const targets = await page.evaluate(() => {
      const center = selector => {
        for (const node of document.querySelectorAll(selector)) {
          node.scrollIntoView({ block: 'center', inline: 'center' })
          const rect = node.getBoundingClientRect()
          if (!rect.width || !rect.height) continue
          const x = rect.left + rect.width / 2
          const y = rect.top + rect.height / 2
          const hit = document.elementFromPoint(x, y)
          if (hit && (hit === node || node.contains(hit))) return { x, y }
        }
        return null
      }
      const ready = document.querySelector('header') && !document.body.innerText.includes('Loading passages') && !document.querySelector('[role=dialog]')
      return ready ? { ' ': center('[aria-label^="Morse key"]'), '.': center('[aria-label="Dot"]'), '-': center('[aria-label="Dash"]') } : null
    })
    const needed = job.profile === 'keyboard' ? true : job.mode === 'key' ? targets?.[' '] : targets?.['.'] && targets?.['-']
    if (targets && needed) return targets
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('controls never became hittable')
}

async function until(target) {
  for (;;) {
    const left = target - performance.now()
    if (left <= 0) return
    if (left > SPIN_MS) await new Promise(resolve => setTimeout(resolve, left - SPIN_MS))
    else {
      while (performance.now() < target) {
        // spin: timers are too coarse
      }
      return
    }
  }
}

async function runJob(browser, origin, job) {
  const base = { ...job, at: new Date().toISOString() }
  let opened
  try {
    opened = await openPage(browser, origin, job)
    const { page, session, errors } = opened
    const targets = await findTargets(page, job)
    await new Promise(resolve => setTimeout(resolve, 800)) // let the first screen's animations finish
    await session.send('Emulation.setCPUThrottlingRate', { rate: job.throttle })
    await new Promise(resolve => setTimeout(resolve, 300))

    const wpm = job.mode === 'iambic' ? Math.min(job.wpm, IAMBIC_MAX_WPM) : job.wpm
    const u = unitMsForWpm(wpm)
    const plan = planFor({ wpm, elements: elementsFor(job.wpm) })
    const events = []
    for (const [index, element] of plan.entries()) {
      const releaseAt =
        job.mode !== 'iambic' ? element.at + element.length : job.release === 'edge' ? element.at + element.length + u - EDGE_MS : element.at + element.length / 2
      events.push({ index, type: 'down', symbol: element.symbol, at: element.at })
      events.push({ index, type: 'up', symbol: element.symbol, at: releaseAt })
    }
    events.sort((a, b) => a.at - b.at || (a.type === 'up' ? -1 : 1))

    const start = performance.now() + 400
    const pending = []
    const sent = []
    for (const event of events) {
      const scheduled = start + event.at
      const explicit = job.stamping === 'explicit'
      await until(explicit ? scheduled + EXPLICIT_SEND_AFTER_MS : scheduled)
      const timestamp = explicit ? (performance.timeOrigin + scheduled) / 1000 : undefined
      const sentAt = performance.now()
      pending.push(session.send(...commandFor(job, event.type, event.symbol, targets, timestamp)).catch(error => errors.push(`cdp: ${error.message}`)))
      sent.push({ ...event, scheduled, sentAt })
    }
    await Promise.all(pending)
    await new Promise(resolve => setTimeout(resolve, 5 * u + 400))
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 })

    const page_ = await page.evaluate(() => {
      const keyers = window.__keyers ?? []
      const main = keyers.reduce((best, keyer) => (!best || keyer.log.length > best.log.length ? keyer : best), null)
      return { log: main ? main.log.map(entry => ({ ...entry })) : [], finalized: main?.finalized ?? null, seen: window.__seen }
    })
    const row = { ...base, u, plan: plan.length, sent, ...page_, errors }
    return { ...row, metrics: analyze(row) }
  } catch (error) {
    return { ...base, metrics: { error: String(error.stack ?? error) } }
  } finally {
    await opened?.context.close().catch(() => {})
  }
}

// ------------------------------------------------------------------------------------------ analyze

const round = (n, digits = 2) => (Number.isFinite(n) ? +n.toFixed(digits) : null)
const mean = values => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN)
function percentile(values, p) {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

// What the page recorded, on its clock: the keyer log, or on the blank page the capture listeners.
function recorded(run) {
  if (run.mode !== 'blank') return run.log
  return run.seen.filter(event => /^(keydown|keyup|pointerdown|pointerup)$/.test(event.type)).map(event => ({ type: event.type.endsWith('down') ? 'down' : 'up', t: event.stamp }))
}

// Match each sent event to the recorded event of the same type (and pad) nearest its expected time, within
// one unit, and pair them into signed press and gap errors: recorded interval minus sent interval.
function matchStraight(run) {
  const reference = event => (run.stamping === 'explicit' ? event.scheduled : event.sentAt)
  const times = recorded(run)
  const downs = run.sent.filter(event => event.type === 'down')
  const recordedDowns = times.filter(entry => entry.type === 'down')
  const offset = percentile(
    downs
      .slice(0, 15)
      .map((event, i) => recordedDowns[i]?.t - reference(event))
      .filter(Number.isFinite),
    50,
  )
  const used = new Set()
  const matchOf = new Map()
  for (const event of run.sent) {
    let best = null
    for (const [i, entry] of times.entries()) {
      if (used.has(i) || entry.type !== event.type || (run.mode === 'pad' && entry.pad !== event.symbol)) continue
      const distance = Math.abs(entry.t - offset - reference(event))
      if (distance <= run.u && (!best || distance < best.distance)) best = { i, distance }
    }
    if (best) {
      used.add(best.i)
      matchOf.set(event, times[best.i])
    }
  }
  const byIndex = new Map(run.sent.map(event => [`${event.index}:${event.type}`, event]))
  const presses = []
  const gaps = []
  const pressesVsPlan = [] // against the ideal schedule: the pipeline plus the harness's own pacing
  for (let index = 0; index < run.plan; index++) {
    const down = byIndex.get(`${index}:down`)
    const up = byIndex.get(`${index}:up`)
    const next = byIndex.get(`${index + 1}:down`)
    if (matchOf.has(down) && matchOf.has(up)) {
      const length = matchOf.get(up).t - matchOf.get(down).t
      presses.push(length - (reference(up) - reference(down)))
      pressesVsPlan.push(length - (up.at - down.at))
    }
    if (next && matchOf.has(up) && matchOf.has(next)) gaps.push(matchOf.get(next).t - matchOf.get(up).t - (reference(next) - reference(up)))
  }
  return {
    presses,
    gaps,
    pressesVsPlan,
    downs: downs.length,
    dropped: downs.filter(event => !matchOf.has(event)).length,
    duplicated: times.filter((entry, i) => entry.type === 'down' && !used.has(i)).length,
  }
}

// Input events as the page saw them, in dispatch order, for the run's profile.
function seenInputs(run) {
  const pattern = run.profile === 'keyboard' ? /^key(down|up)$/ : /^pointer(down|up)$/
  return run.seen.filter(event => pattern.test(event.type))
}

// How late the harness itself sent each event, beyond its intended send time.
const sendLateness = (run, event) => event.sentAt - event.scheduled - (run.stamping === 'explicit' ? EXPLICIT_SEND_AFTER_MS : 0)

// Delivery lag: stamp to listener. With explicit stamps, less the time from the stamp to the send. Only events
// the harness sent on time count (each and the one before it): a stall in node can hold a write back after the
// clock was read, and that would land here as lag.
function deliveryLags(run) {
  const seen = seenInputs(run)
  if (seen.length !== run.sent.length) return seen.map(event => event.at - event.stamp)
  const onTime = i => sendLateness(run, run.sent[i]) <= 1
  return seen.flatMap((event, i) => {
    if (!onTime(i) || (i > 0 && !onTime(i - 1))) return []
    const stampToSend = run.stamping === 'explicit' ? Math.max(0, run.sent[i].sentAt - run.sent[i].scheduled) : 0
    return [event.at - event.stamp - stampToSend]
  })
}

function analyze(run) {
  const lag = deliveryLags(run)
  const pacing = run.sent.map(event => Math.abs(sendLateness(run, event)))
  const common = {
    lagP50: round(percentile(lag, 50)),
    lagP99: round(percentile(lag, 99)),
    lagMax: round(Math.max(...lag)),
    lagPaired: seenInputs(run).length === run.sent.length,
    pacingP99: round(percentile(pacing, 99)),
    pacingMax: round(Math.max(...pacing)),
    pageErrors: run.errors.length,
    blurs: run.seen.filter(event => event.type === 'blur').length,
  }
  if (run.mode === 'iambic') return { ...common, ...analyzeIambic(run) }
  if (!recorded(run).length) return { ...common, error: 'nothing recorded' }

  const { presses, gaps, pressesVsPlan, downs, dropped, duplicated } = matchStraight(run)
  const abs = values => values.map(Math.abs)
  return {
    ...common,
    presses: presses.length,
    pressMean: round(mean(abs(presses))),
    pressBias: round(mean(presses)),
    pressP99: round(percentile(abs(presses), 99)),
    gapMean: round(mean(abs(gaps))),
    gapP99: round(percentile(abs(gaps), 99)),
    worst: round(Math.max(...abs(presses), ...abs(gaps))),
    vsPlanPressP99: round(percentile(abs(pressesVsPlan), 99)),
    dropped,
    duplicated,
    droppedPer1000: round((1000 * dropped) / downs, 1),
    duplicatedPer1000: round((1000 * duplicated) / downs, 1),
    finalized: run.finalized,
  }
}

function analyzeIambic(run) {
  const { sent, u } = run
  const reference = event => (run.stamping === 'explicit' ? event.scheduled : event.sentAt)
  const presses = sent.filter(event => event.type === 'down')
  const elements = []
  for (const [i, entry] of run.log.entries()) {
    if (entry.type !== 'down') continue
    const up = run.log.slice(i + 1).find(next => next.type === 'up' && next.pad === entry.pad)
    elements.push({ pad: entry.pad, start: entry.t, end: up?.t ?? NaN })
  }
  // Paddle presses and releases as the page stamped them, each with its paddle and, when they pair up, what was sent.
  const padOf = event => (event.key === '.' || event.label === 'Dot' ? '.' : event.key === '-' || event.label === 'Dash' ? '-' : null)
  const seen = seenInputs(run)
  const paired = seen.length === sent.length
  const stamped = seen.map((event, i) => ({ type: event.type.endsWith('down') ? 'down' : 'up', pad: padOf(event), t: event.stamp, sent: paired ? sent[i] : null }))

  // An element answers a press on its paddle stamped at most half a unit before it starts. Anything else is extra.
  const answered = new Set()
  const extras = []
  const lengthErrors = []
  for (const element of elements) {
    lengthErrors.push(Math.abs(element.end - element.start - (element.pad === '.' ? 1 : 3) * u))
    const press = stamped.findIndex((event, i) => event.type === 'down' && event.pad === element.pad && !answered.has(i) && event.t <= element.start + 0.5 && element.start - event.t <= u / 2)
    if (press >= 0) {
      answered.add(press)
      continue
    }
    // Extra. The release that should have prevented it: the first on this paddle after its last press.
    const lastPress = stamped.filter(event => event.type === 'down' && event.pad === element.pad && event.t < element.start - 0.5).at(-1)
    const release = lastPress && stamped.find(event => event.type === 'up' && event.pad === element.pad && event.t >= lastPress.t)
    const margin = release ? element.start - release.t : null
    const late = release?.sent ? sendLateness(run, release.sent) : null
    // Released in time by its stamp: the pipeline's fault unless the harness sent it too late to make the decision.
    // Released after the decision by more than a unit: knock-on from an earlier extra shifting the sequence.
    const cause = margin === null ? 'unknown' : margin > 0 ? (late !== null && late >= margin ? 'harness' : 'pipeline') : margin > -u ? 'late release' : 'knock-on'
    extras.push({ start: element.start, margin: round(margin), cause })
  }
  const inTime = extras.filter(extra => extra.cause === 'pipeline').length

  const gaps = []
  if (elements.length === presses.length && extras.length === 0) {
    for (let i = 1; i < elements.length; i++) {
      const sentGap = reference(presses[i]) - reference(presses[i - 1]) - (presses[i - 1].symbol === '.' ? 1 : 3) * u
      gaps.push(Math.abs(elements[i].start - elements[i - 1].end - sentGap))
    }
  }
  const missing = presses.length - answered.size
  return {
    presses: presses.length,
    elements: elements.length,
    missing,
    extra: extras.length,
    extraReleasedInTime: inTime,
    extraReleasedLate: extras.filter(extra => extra.cause === 'late release').length,
    extraHarness: extras.filter(extra => extra.cause === 'harness').length,
    extraKnockOn: extras.filter(extra => extra.cause === 'knock-on' || extra.cause === 'unknown').length,
    extraMargins: extras.slice(0, 12).map(extra => extra.margin),
    releasesSent: sent.filter(event => event.type === 'up').length,
    pressMean: round(mean(lengthErrors)),
    pressP99: round(percentile(lengthErrors, 99)),
    gapMean: round(mean(gaps)),
    gapP99: round(percentile(gaps, 99)),
    worst: round(Math.max(...lengthErrors, ...gaps)),
    dropped: missing,
    duplicated: extras.length,
    droppedPer1000: round((1000 * missing) / presses.length, 1),
    duplicatedPer1000: round((1000 * extras.length) / presses.length, 1),
  }
}

// ------------------------------------------------------------------------------------------- report

function report(file) {
  const rows = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  const failed = rows.filter(row => row.metrics.error)
  console.log(`${rows.length} runs, ${failed.length} failed`)
  if (failed.length) {
    console.table(failed.map(row => ({ mode: row.mode, profile: row.profile, wpm: row.wpm, throttle: row.throttle, stamping: row.stamping, release: row.release, error: row.metrics.error.split('\n')[0] })))
  }
  const ok = rows.filter(row => !row.metrics.error)
  // Recomputed from the raw record, so a change to the analysis applies to results already on disk.
  for (const row of ok) row.metrics = analyze(row)
  const view = (row, extra = {}) => ({
    input: `${row.mode === 'iambic' ? `iambic ${row.release}` : row.mode}/${row.profile}`,
    wpm: row.mode === 'iambic' && row.wpm > IAMBIC_MAX_WPM ? `${row.wpm}->${IAMBIC_MAX_WPM}` : row.wpm,
    cpu: `${row.throttle}x`,
    n: row.metrics.presses,
    'press mean': row.metrics.pressMean,
    'press p99': row.metrics.pressP99,
    'gap mean': row.metrics.gapMean,
    'gap p99': row.metrics.gapP99,
    worst: row.metrics.worst,
    'drop/1k': row.metrics.droppedPer1000,
    'dup/1k': row.metrics.duplicatedPer1000,
    'lag p50': row.metrics.lagP50,
    'lag p99': row.metrics.lagP99,
    'lag max': row.metrics.lagMax,
    'harness late max': row.metrics.pacingMax,
    ...extra,
  })
  const straight = row => ['key', 'pad'].includes(row.mode)

  console.log('\nSTRAIGHT KEY AND MANUAL PAD, OS-style timestamps (ms; recorded interval minus scheduled interval)')
  console.table(ok.filter(row => straight(row) && row.stamping === 'explicit').map(row => view(row)))

  console.log('POOLED ACROSS SPEEDS')
  const groups = new Map()
  for (const row of ok.filter(row => row.stamping === 'explicit' && row.mode !== 'blank' && !(row.mode === 'iambic' && row.release === 'edge'))) {
    const key = `${row.mode}/${row.profile} ${row.throttle}x`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  console.table(
    [...groups].map(([key, group]) => {
      const iambic = group[0].mode === 'iambic'
      const presses = iambic ? [] : group.flatMap(row => matchStraight(row).presses.map(Math.abs))
      const gaps = iambic ? [] : group.flatMap(row => matchStraight(row).gaps.map(Math.abs))
      const lags = group.flatMap(row => deliveryLags(row))
      const downs = group.reduce((n, row) => n + row.sent.filter(event => event.type === 'down').length, 0)
      return {
        group: key,
        presses: downs,
        'press mean': iambic ? '-' : round(mean(presses)),
        'press p99': iambic ? '-' : round(percentile(presses, 99)),
        'gap mean': iambic ? '-' : round(mean(gaps)),
        'gap p99': iambic ? '-' : round(percentile(gaps, 99)),
        worst: iambic ? '-' : round(Math.max(...presses, ...gaps)),
        'drop/1k': round((1000 * group.reduce((n, row) => n + row.metrics.dropped, 0)) / downs, 2),
        'dup/1k': round((1000 * group.reduce((n, row) => n + row.metrics.duplicated, 0)) / downs, 2),
        'lag p50': round(percentile(lags, 50)),
        'lag p99': round(percentile(lags, 99)),
        'lag max': round(Math.max(...lags)),
      }
    }),
  )

  console.log('\nIAMBIC KEYER, OS-style timestamps (element counts; press = generated element length error; gap vs scheduled)')
  console.table(
    ok
      .filter(row => row.mode === 'iambic')
      .map(row =>
        view(row, {
          missing: row.metrics.missing,
          extra: row.metrics.extra,
          'extra: pipeline': row.metrics.extraReleasedInTime,
          'extra: harness sent late': row.metrics.extraHarness,
          'extra: knock-on': row.metrics.extraKnockOn,
        }),
      ),
  )
  const edge = ok.filter(row => row.mode === 'iambic' && row.release === 'edge')
  if (edge.length) {
    console.log(`Edge: every paddle released ${EDGE_MS} ms before the keyer's decision. Pipeline-caused extra elements per 1000 releases:`)
    console.table(
      edge.map(row => ({
        input: `iambic edge/${row.profile}`,
        wpm: row.wpm,
        cpu: `${row.throttle}x`,
        'pipeline extras per 1000 releases': round((1000 * row.metrics.extraReleasedInTime) / row.metrics.releasesSent, 0),
        'lag p50': row.metrics.lagP50,
        'lag p99': row.metrics.lagP99,
      })),
    )
  }

  console.log('\nNOISE FLOOR: browser-stamped on arrival, app against a blank page (ms; recorded interval minus sent interval)')
  console.table(ok.filter(row => row.stamping === 'arrival').map(row => view(row)))

  const main = ok.filter(row => row.stamping === 'explicit' && straight(row))
  const over = main.filter(row => row.metrics.pressP99 > 8 || row.metrics.gapP99 > 8)
  console.log(over.length ? `\nP99 OVER 8 MS (OS-style timestamps) in ${over.length} runs:` : '\nOS-style timestamps: no run has a p99 press or gap error over 8 ms.')
  if (over.length) console.table(over.map(row => view(row)))
  const lossy = ok.filter(row => row.mode !== 'blank' && (row.metrics.dropped || row.metrics.duplicated))
  console.log(lossy.length ? `\nRUNS WITH DROPPED OR EXTRA EVENTS: ${lossy.length}` : '\nNo dropped or extra events.')
  if (lossy.length) console.table(lossy.map(row => view(row, { 'release margins (ms before decision)': JSON.stringify(row.metrics.extraMargins ?? []) })))
}

// Last, so every declaration above is initialized before anything runs.
if (command === 'report') report(OUT)
else await run()
