// jsdom has no canvas, and the blob only needs to be observed, not rasterized.
import { vi } from 'vitest'

/**
 * A 2D context that records what was drawn, one entry in `frames` per
 * `clearRect` — so one per call to `drawBlob`.
 */
export function recordingContext() {
  const frames = []
  const current = () => frames[frames.length - 1]
  const ctx = {
    frames,
    globalAlpha: 1,
    fillStyle: null,
    setTransform() {},
    clearRect() {
      frames.push({ points: [], stops: [], dots: [], origin: null })
    },
    save() {},
    restore() {},
    translate(x, y) {
      current().origin = [x, y]
    },
    beginPath() {},
    closePath() {},
    moveTo() {},
    // Each sample point is the control point of its quadratic.
    quadraticCurveTo(x, y) {
      current().points.push([x, y])
    },
    arc(x, y, radius) {
      current().dots.push({ x, y, radius, alpha: ctx.globalAlpha })
    },
    fill() {},
    createRadialGradient: () => ({ addColorStop: (_at, color) => current().stops.push(color) }),
  }
  return ctx
}

/** Hand every canvas in this test the same recording context. */
export function stubCanvas(ctx = recordingContext()) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
  return ctx
}

/** The nearest and furthest a drawn silhouette reaches from the body's centre. */
export function extent(frame) {
  const radii = frame.points.map(([x, y]) => Math.hypot(x, y))
  return { min: Math.min(...radii), max: Math.max(...radii) }
}
