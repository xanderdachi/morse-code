/**
 * "Slow Tide" — the loading blob, from direction 2a of the loading-rhythms
 * mockup. The drawing (entry, squash, breath, resolve) is the mockup's, value
 * for value. The score is not: the mockup's stretch strike is gone, leaving one
 * squash retuned to carry the loop on its own — see STRIKE.
 *
 * Plain canvas 2D — no React, no DOM lookups, no imports — so the caller owns
 * the canvas (and its devicePixelRatio transform) and this stays testable
 * against a stub context.
 *
 * The resolved mark is also the link-preview image, public/og-image.png, which
 * scripts/og-image.mjs draws with this file: rerun it after changing the mark.
 */

/** The page behind the blob; also the colour punched out for the two dots. */
export const PAPER = '#FFF3E2'

/** Radial-gradient stops for the body, and for the mark it resolves into. */
const BODY = ['#5FD3C4', '#12A594', '#0C8074']
const MARK = ['#FFC776', '#FF9F1C', '#E07F08']

/**
 * The strike's feel, in one place. The loop has a single move, so these three
 * numbers are most of its character:
 *   m  — magnitude: how deep the squash goes. At .45 it read as a twitch.
 *   dk — settle damping: how quickly the wobble dies. Lower wobbles longer.
 *   f  — settle frequency: how fast it wobbles. Lower is slower and softer.
 */
export const STRIKE = { m: 0.85, dk: 3.6, f: 5.6 }

export const ENTRY_MS = 820
export const RESOLVE_MS = 1200
const BREATH_MS = 2600

/** Past this the blob costs more to draw than it gains in looking better. */
export const MAX_DPR = 1.5

/** Past LONG_AFTER_MS the rest beats stretch, ramping in over LONG_RAMP_MS. */
export const LONG_AFTER_MS = 4600
const LONG_RAMP_MS = 2600
const LONG_REST_STRETCH = 1.33
// The mockup swaps to the stretched score once the ramp is this far in.
const LONG_THRESHOLD = 0.4

/**
 * One loop of the score: a rest, one squash, a rest. Every beat carries a value
 * `v` that the body reads as a squash:
 *   rest — v is 0, so only the breath moves.
 *   ant  — anticipation, a negative pre-move that loads against the strike.
 *   str  — the strike, easing out (quint) from the anticipated position.
 *   set  — the settle, a cosine decaying at STRIKE.dk and ringing at STRIKE.f.
 */
const SCORE = [
  { t: 'rest', d: 1400 },
  { t: 'ant', d: 100 },
  { t: 'str', d: 170 },
  { t: 'set', d: 640 },
  { t: 'rest', d: 1500 },
]

export const LOOP_MS = SCORE.reduce((total, beat) => total + beat.d, 0)

/** The same beats with each one's start offset filled in. */
function withStarts(beats) {
  let start = 0
  return beats.map(beat => {
    const placed = { ...beat, s: start }
    start += beat.d
    return placed
  })
}

const NORMAL = withStarts(SCORE)
const STRETCHED = withStarts(SCORE.map(beat => (beat.t === 'rest' ? { ...beat, d: beat.d * LONG_REST_STRETCH } : beat)))
const STRETCHED_MS = STRETCHED.reduce((total, beat) => total + beat.d, 0)

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x)

function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a || 1e-6))
  return t * t * (3 - 2 * t)
}

const easeOutQuint = t => 1 - (1 - clamp01(t)) ** 5

function easeInOutCubic(x) {
  const t = clamp01(x)
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function mix(from, to, t) {
  const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const a = channels(from)
  const b = channels(to)
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`
}

/** How far into the long-wait stretch we are, 0 to 1. */
export function longRamp(timeMs) {
  return clamp01((timeMs - LONG_AFTER_MS) / LONG_RAMP_MS)
}

/**
 * The beat playing `loopMs` into the loop, with `remainingMs` of real time left
 * in it.
 *
 * Under the long-wait stretch the rest beats are 1.33x longer but loop time
 * runs proportionally faster, so one pass still takes LOOP_MS and the rests
 * simply take a larger share of it. That is why `remainingMs` divides the
 * remaining loop time by that rate to get back to real milliseconds.
 */
export function beatAt(loopMs, long = 0) {
  const stretched = long > LONG_THRESHOLD
  const beats = stretched ? STRETCHED : NORMAL
  const rate = stretched ? STRETCHED_MS / LOOP_MS : 1
  const span = stretched ? STRETCHED_MS : LOOP_MS

  let local = loopMs - Math.floor(loopMs / LOOP_MS) * LOOP_MS
  if (stretched) local = (local * rate) % span

  for (let index = 0; index < beats.length; index++) {
    const beat = beats[index]
    if (local >= beat.s && local < beat.s + beat.d) {
      return {
        beat,
        index,
        progress: (local - beat.s) / beat.d,
        remainingMs: (beat.s + beat.d - local) / rate,
      }
    }
  }
  return { beat: beats[beats.length - 1], index: beats.length - 1, progress: 1, remainingMs: 0 }
}

/** The body's squash value, breath and wobble `loopMs` into the loop. */
function bodyState(loopMs, long) {
  const breath = Math.sin((2 * Math.PI * loopMs) / BREATH_MS)
  const { beat, progress } = beatAt(loopMs, long)
  const { m, dk, f } = STRIKE

  if (beat.t === 'rest') return { v: 0, breath, wobble: 0 }
  if (beat.t === 'ant') return { v: -0.2 * m * easeInOutCubic(progress), breath, wobble: 0 }
  if (beat.t === 'str') return { v: -0.2 * m + (m + 0.2 * m) * easeOutQuint(progress), breath, wobble: 0 }
  return {
    v: m * Math.exp(-dk * progress) * Math.cos(f * progress),
    breath,
    wobble: m * 0.09 * Math.exp(-3 * progress),
  }
}

/**
 * When resolve may start, in on-screen milliseconds, given that the app became
 * ready at `t` and must stay on screen at least `floorMs`.
 *
 * Mid-rest there is nothing to interrupt, so it starts at once. Mid-move it
 * waits the move out: half a strike reads as a glitch, and the longest beat in
 * the score is the settle at 640ms. Ready before the entry finishes resolves
 * straight out of the entry, skipping the loop entirely. Reduced motion has no
 * moves to finish, so it only waits out the floor.
 */
export function resolveStartFor(t, { reduced = false, floorMs = 0 } = {}) {
  if (reduced) return Math.max(t, floorMs)
  if (t < ENTRY_MS) return Math.max(ENTRY_MS, floorMs)
  const { beat, remainingMs } = beatAt(t - ENTRY_MS, longRamp(t))
  return Math.max(beat.t === 'rest' ? t : t + remainingMs, floorMs)
}

/** The wordmark's opacity at this much of the resolve. */
export function wordmarkFade(resolve) {
  return smoothstep(0.72, 1, resolve)
}

const N = 96

/** The superellipse the body morphs into as it resolves. */
function squircle(radius, theta) {
  const p = 4.2
  return (radius * 0.96) / (Math.abs(Math.cos(theta)) ** p + Math.abs(Math.sin(theta)) ** p) ** (1 / p)
}

/**
 * Draw one frame into `ctx`, in CSS pixels: the caller has already sized the
 * canvas and applied the devicePixelRatio transform.
 *
 * `timeMs` is time on screen. `phase` is where we are in the three phases:
 *   entry    0..1 — the fall-in, done at 1.
 *   resolve  0..1 — the hand-over to the mark.
 *   long     0..1 — how far into the long-wait rest stretch.
 *   restOnly     — reduced motion: breath only, and resolve without the compress.
 *
 * Returns the body radius it drew at, which is what positions the wordmark.
 */
export function drawBlob(ctx, width, height, timeMs, phase = {}) {
  const { entry = 1, resolve = 0, long = 0, restOnly = false } = phase
  ctx.clearRect(0, 0, width, height)

  const baseRadius = Math.min(width, height) * (width < 430 ? 0.22 : 0.2)
  const state = restOnly
    ? { v: 0, breath: Math.sin((2 * Math.PI * timeMs) / BREATH_MS), wobble: 0 }
    : bodyState(Math.max(0, timeMs - ENTRY_MS), long)
  const { v } = state

  const cx = width / 2
  let cy = height / 2
  let radius = baseRadius * (1 + 0.01 * state.breath)
  // The squash; at rest v is 0 and this leaves the body round.
  let sx = 1 + 0.45 * v
  let sy = 1 - 0.55 * v
  cy += radius * 0.16 * v
  const wobble = state.wobble + Math.abs(v) * 0.05

  // Entry: the body falls in from above, then lands with one damped squash.
  if (entry < 1) {
    const fall = 1 - clamp01(entry / 0.66)
    cy -= height * 0.62 * fall * fall
    const impact = clamp01((entry - 0.66) / 0.34)
    if (impact > 0) {
      const bounce = 0.85 * Math.exp(-3.2 * impact) * Math.cos(5.6 * impact)
      sy *= 1 - 0.5 * bounce
      sx *= 1 + 0.4 * bounce
    }
  }

  // Resolve: compress, morph toward the squircle, ramp teal to orange, dots in.
  let morph = 0
  let colors = BODY
  let dots = 0
  if (resolve > 0) {
    if (!restOnly) {
      const compress = smoothstep(0, 0.1, resolve) * (1 - smoothstep(0.1, 0.34, resolve))
      sy *= 1 - 0.3 * compress
      sx *= 1 + 0.24 * compress
    }
    radius *= 1 - 0.1 * smoothstep(0.08, 0.3, resolve)
    morph = smoothstep(0.3, 0.72, resolve)
    colors = BODY.map((color, i) => mix(color, MARK[i], morph))
    dots = smoothstep(0.62, 0.92, resolve)
  }

  // 96 polar samples, smoothed by curving each through its neighbour's midpoint.
  const points = []
  for (let i = 0; i < N; i++) {
    const theta = (i / N) * Math.PI * 2
    let r = radius * (1 + wobble * Math.cos(3 * theta + timeMs / 420))
    if (morph > 0) r = r * (1 - morph) + squircle(radius, theta) * morph
    points.push([r * Math.cos(theta) * sx, r * Math.sin(theta) * sy])
  }

  ctx.save()
  ctx.translate(cx, cy)
  ctx.beginPath()
  ctx.moveTo((points[N - 1][0] + points[0][0]) / 2, (points[N - 1][1] + points[0][1]) / 2)
  for (let i = 0; i < N; i++) {
    const from = points[i]
    const to = points[(i + 1) % N]
    ctx.quadraticCurveTo(from[0], from[1], (from[0] + to[0]) / 2, (from[1] + to[1]) / 2)
  }
  ctx.closePath()

  const gradient = ctx.createRadialGradient(-radius * 0.34, -radius * 0.4, radius * 0.06, 0, 0, radius * 1.32)
  gradient.addColorStop(0, colors[0])
  gradient.addColorStop(0.52, colors[1])
  gradient.addColorStop(1, colors[2])
  ctx.fillStyle = gradient
  ctx.fill()

  if (dots > 0) {
    ctx.fillStyle = PAPER
    ctx.globalAlpha = dots
    const dotRadius = radius * 0.13
    const dotOffset = radius * 0.27
    ctx.beginPath()
    ctx.arc(-dotOffset, 0, dotRadius * dots, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(dotOffset, 0, dotRadius * dots, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.restore()

  return { radius }
}
