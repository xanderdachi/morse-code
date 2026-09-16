// Real-device testing. Open the app with ?dump in the URL and every run that ends
// is kept on this device (the last MAX_RUNS), with its keystroke log and the raw
// input events as the browser delivered them, ready to copy out. Off otherwise:
// nothing is recorded and nothing is ever sent anywhere.

export const RUN_DUMP_KEY = 'morse-club-run-dump'
export const MAX_RUNS = 30
// Stored runs stay under this many characters (UTF-16, so twice that in bytes), leaving the origin's
// ~5 MB of localStorage to the progress save, which must never fail because of a debugging aid.
export const MAX_CHARS = 1_000_000
const MAX_EVENTS = 4000

// Only the keys the app binds are named; anything else is recorded as null.
const BOUND_KEYS = new Set([' ', '.', '-', 'Backspace', 'Enter'])

/** Whether this page load keeps runs: ?dump anywhere in the query. */
export function runDumpEnabled(search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).has('dump')
}

/**
 * Record input events from the moment of the call: when each was stamped (event.timeStamp) and when a
 * listener saw it (performance.now()), both on the page clock the keystroke log uses. Returns
 * { since(t), stop() }, where since(t) is every event stamped at or after `t`.
 */
export function startEventTrace(target = globalThis.window) {
  const events = []
  const record = event => {
    // Focus moving between controls isn't an interruption: only the window's own blur and focus are.
    if ((event.type === 'blur' || event.type === 'focus') && event.target instanceof Node) return
    events.push({
      type: event.type,
      stamp: event.timeStamp,
      at: performance.now(),
      key: BOUND_KEYS.has(event.key) ? event.key : null,
      repeat: event.repeat || undefined,
      pointerType: event.pointerType,
      pointerId: event.pointerId,
      visibility: event.type === 'visibilitychange' ? document.visibilityState : undefined,
    })
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  }
  const types = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel', 'blur', 'focus']
  for (const type of types) target.addEventListener(type, record, { capture: true, passive: true })
  target.document.addEventListener('visibilitychange', record, { capture: true, passive: true })
  return {
    since: t => events.filter(event => event.stamp >= t),
    stop() {
      for (const type of types) target.removeEventListener(type, record, { capture: true })
      target.document.removeEventListener('visibilitychange', record, { capture: true })
    },
  }
}

/** The kept runs, oldest first. Never throws. */
export function loadRuns() {
  try {
    const runs = JSON.parse(globalThis.localStorage.getItem(RUN_DUMP_KEY) ?? '[]')
    return Array.isArray(runs) ? runs : []
  } catch {
    return []
  }
}

/**
 * Keep a run, dropping the oldest past MAX_RUNS or MAX_CHARS, and more of the oldest if storage is full.
 * Returns how many are kept, or null when not even this run fits.
 */
export function saveRun(run) {
  let runs = [...loadRuns(), run].slice(-MAX_RUNS)
  for (;;) {
    const json = JSON.stringify(runs)
    try {
      if (json.length > MAX_CHARS) throw new RangeError('over the dump budget')
      globalThis.localStorage.setItem(RUN_DUMP_KEY, json)
      return runs.length
    } catch {
      if (runs.length <= 1) return null
      runs = runs.slice(1)
    }
  }
}

export function clearRuns() {
  try {
    globalThis.localStorage.removeItem(RUN_DUMP_KEY)
  } catch {
    // Nothing stored, or storage blocked: either way nothing is kept.
  }
}
