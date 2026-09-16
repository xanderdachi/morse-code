import { useLayoutEffect, useRef } from 'react'
import { ENTRY_MS, MAX_DPR, RESOLVE_MS, drawBlob, longRamp, resolveStartFor, wordmarkFade } from '../lib/blob.js'

/**
 * The loading screen: "Slow Tide" from the loading-rhythms mockup, wired to the
 * app's readiness instead of to a demo clock.
 *
 * Three phases — entry (ENTRY_MS), a repeating loop (LOOP_MS), then resolve
 * (RESOLVE_MS) into the wordmark. The mockup loops on its own clock; here the
 * loop can be cut short at any moment, so the only question this component
 * really answers is *when* resolve is allowed to start. See `resolveStartFor`.
 *
 * It must never be the reason the app is late, so it draws its first frame
 * synchronously on mount, takes no dependency beyond the canvas, and stops its
 * frame loop the moment the tab is hidden.
 */

/** Below this the loader would flash rather than read as a loader. */
const MIN_ON_SCREEN_MS = 400
/** Longest we'll wait for a move to finish before giving up and fading out. */
const MAX_BEAT_WAIT_MS = 900
/** The fade used when waiting for the move would cost more than that. */
const CROSSFADE_MS = 300

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x)

export default function LoadingScreen({ ready = false, onDone }) {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const wordmarkRef = useRef(null)

  // The frame loop is started once and reads props through this, so a change of
  // `ready` never costs a re-render or restarts the animation.
  const latest = useRef({ ready, onDone })

  useLayoutEffect(() => {
    latest.current = { ready, onDone }
  })

  useLayoutEffect(() => {
    // Layout effects run in the commit, before the browser paints, so the first
    // frame below goes out with the mount rather than a frame after it.
    const mountedAt = performance.now()
    const root = rootRef.current
    const canvas = canvasRef.current
    const wordmark = wordmarkRef.current
    const ctx = canvas?.getContext?.('2d') ?? null

    const motion = globalThis.matchMedia?.(REDUCED_MOTION) ?? null
    let reduced = motion?.matches ?? false

    let frameId = 0
    let handedOver = false
    // On-screen time: a backgrounded tab neither draws nor ages the animation,
    // so coming back resumes the beat instead of snapping past it.
    let onScreenMs = 0
    let lastTick = performance.now()
    let resolveAt = null
    let fadeAt = null
    let laidOut = false

    /**
     * The canvas's size in CSS pixels.
     *
     * Asking the element costs a synchronous layout of the whole document, and
     * on the first frame that document has never been laid out — which is the
     * app's entire first layout, pulled into the loader's first frame. The
     * loader covers the viewport, so take the size from there until the browser
     * has laid the page out on its own schedule, after which asking is free.
     */
    function viewport() {
      if (laidOut) {
        const width = canvas.clientWidth
        const height = canvas.clientHeight
        if (width > 0 && height > 0) return { width, height }
      }
      laidOut = true
      return { width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 }
    }

    function finish() {
      if (handedOver) return
      handedOver = true
      cancelAnimationFrame(frameId)
      frameId = 0
      latest.current.onDone?.()
    }

    function paint() {
      const t = onScreenMs

      if (resolveAt === null && fadeAt === null && latest.current.ready) {
        const at = resolveStartFor(t, { reduced, floorMs: MIN_ON_SCREEN_MS })
        // Waiting out this move would cost more than it's worth; leave instead.
        if (at - t > MAX_BEAT_WAIT_MS) fadeAt = t
        else resolveAt = at
      }

      const entry = reduced ? 1 : clamp01(t / ENTRY_MS)
      const resolve = resolveAt === null ? 0 : clamp01((t - resolveAt) / RESOLVE_MS)
      const opacity = wordmarkFade(resolve)

      if (ctx) {
        const { width, height } = viewport()
        if (width > 0 && height > 0) {
          const dpr = Math.min(MAX_DPR, globalThis.devicePixelRatio || 1)
          const pixelWidth = Math.round(width * dpr)
          const pixelHeight = Math.round(height * dpr)
          if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth
            canvas.height = pixelHeight
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          const { radius } = drawBlob(ctx, width, height, t, { entry, resolve, long: longRamp(t), restOnly: reduced })
          if (wordmark) {
            wordmark.style.transform =
              `translate(-50%, -50%) translateY(${Math.round(radius * 1.5)}px) scale(${(0.9 + 0.1 * opacity).toFixed(3)})`
          }
        }
      }
      if (wordmark) wordmark.style.opacity = opacity.toFixed(3)

      if (fadeAt !== null) {
        const fade = clamp01((t - fadeAt) / CROSSFADE_MS)
        if (root) root.style.opacity = (1 - fade).toFixed(3)
        if (fade >= 1) finish()
      } else if (resolve >= 1) {
        // Hand over only once the wordmark is at full opacity.
        finish()
      }
    }

    function frame() {
      const now = performance.now()
      onScreenMs += now - lastTick
      lastTick = now
      paint()
      if (!handedOver) frameId = requestAnimationFrame(frame)
    }

    function onVisibilityChange() {
      if (handedOver) return
      if (document.visibilityState === 'hidden') {
        cancelAnimationFrame(frameId)
        frameId = 0
      } else if (frameId === 0) {
        lastTick = performance.now()
        frameId = requestAnimationFrame(frame)
      }
    }

    function onMotionChange(event) {
      reduced = event.matches
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    motion?.addEventListener?.('change', onMotionChange)

    // First frame now, in this same commit, so the loader is on screen before
    // the browser paints whatever it is covering.
    paint()
    if (import.meta.env.DEV && ctx) {
      const drawn = performance.now()
      console.info(
        `LoadingScreen: first frame ${(drawn - mountedAt).toFixed(1)}ms after mount, ` +
          `${drawn.toFixed(0)}ms after navigation`,
      )
    }
    if (!handedOver) frameId = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(frameId)
      frameId = 0
      handedOver = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motion?.removeEventListener?.('change', onMotionChange)
    }
  }, [])

  return (
    <div ref={rootRef} role="status" className="fixed inset-0 z-70 bg-paper text-ink">
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full" />
      <p
        ref={wordmarkRef}
        aria-hidden="true"
        style={{ opacity: 0, transform: 'translate(-50%, -50%) translateY(56px)' }}
        className="pointer-events-none absolute left-1/2 top-1/2 m-0 whitespace-nowrap font-ui text-[30px] font-extrabold leading-none tracking-[-.01em]"
      >
        Morse Club
      </p>
      <span className="sr-only">Loading Morse Club</span>
    </div>
  )
}
