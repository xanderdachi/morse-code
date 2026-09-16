import { AnimatePresence, LazyMotion, domMin, m } from 'framer-motion'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DOT } from '../morse/symbols.js'
import { rowMoves } from './stripLayout.js'

const VISIBLE_MARKS = 40

const pop = {
  initial: { scale: 0.2, opacity: 0 },
  animate: { scale: [0.2, 1.18, 1], opacity: [0, 1, 1] },
  transition: { duration: 0.22, times: [0, 0.6, 1], ease: [0.2, 1.7, 0.4, 1] },
}

// Separators fade in and out, and marks glide to make room, so a regrouping
// reads as the display catching up rather than a correction.
const settle = { type: 'spring', stiffness: 520, damping: 42 }

/**
 * Raw dots and dashes as they are keyed, newest on the right, with a light
 * separator only where a letter has actually been committed. Never decoded,
 * never marked right or wrong.
 *
 * strip: [{ id, symbol, endsLetter }] from the keyer.
 *
 * `lite` (the touch layout) draws the same marks with CSS animations instead of
 * framer-motion's layout animations, which measure the page on every frame
 * they run and kept the next press waiting 30 ms or more on a phone.
 *
 * Memoized: the keyer keeps `strip` identical until a mark changes, so a key
 * going down or up doesn't re-render the strip.
 */
export default memo(function TransmissionStrip({ strip, lite = false }) {
  const hint = strip.length === 0 ? 'nothing yet' : strip.at(-1).endsLetter ? 'letter sent' : 'letter forming'
  const visible = strip.slice(-VISIBLE_MARKS)

  return (
    <section aria-label="Transmission" className="rounded-box border-2 border-edge bg-card px-4 py-[13px] shadow-card">
      <div className="eyebrow flex items-center justify-between gap-2.5">
        <span>Transmission</span>
        <span>{hint}</span>
      </div>
      {/* Grows to fill when short; overflows off the left edge when long, keeping the newest visible. */}
      {lite ? <LiteMarks visible={visible} /> : <MotionMarks visible={visible} />}
    </section>
  )
})

const loadLayoutFeatures = () => import('../lib/motionLayout.js').then(module => module.default)

// The desktop strip: marks pop in, and glide to make room with framer-motion's
// layout animations. Those live in their own chunk; until it arrives the marks
// still pop in and out, and the first render after it loads attaches the glide.
function MotionMarks({ visible }) {
  const [features, setFeatures] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadLayoutFeatures().then(loaded => {
      if (!cancelled) setFeatures(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <LazyMotion features={features ?? domMin}>
      <div className="mt-2.5 flex justify-end overflow-hidden">
        <div className="flex min-h-[34px] flex-[1_0_auto] items-center gap-[7px]">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.flatMap(mark => [
              <m.span
                key={`mark-${mark.id}`}
                layout="position"
                {...pop}
                transition={{ ...pop.transition, layout: settle }}
                className={`block h-[15px] flex-none rounded-full ${mark.symbol === DOT ? 'w-[15px] bg-primary' : 'w-10 bg-secondary'}`}
              />,
              mark.endsLetter && (
                <m.span
                  key={`letter-${mark.id}`}
                  layout="position"
                  initial={{ opacity: 0, scaleY: 0.3 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  exit={{ opacity: 0, scaleY: 0.3 }}
                  transition={{ duration: 0.18, layout: settle }}
                  className="block h-[22px] w-[2px] flex-none rounded-[2px] bg-edge"
                />
              ),
            ])}
          </AnimatePresence>
          <m.span layout="position" transition={{ layout: settle }} className="block h-[22px] w-[3px] flex-none rounded-[2px] bg-ink motion-safe:animate-caret" />
        </div>
      </div>
    </LazyMotion>
  )
}

const GLIDE = { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' }

// The lite strip: marks pop in with CSS keyframes, and when the row moves (a
// mark added, the oldest dropping off the left) the marks and the caret each
// slide into place with one composited animation, worked out from the widths
// above. Changes in the middle of the row (a regrouping) just snap.
function LiteMarks({ visible }) {
  const boxRef = useRef(null)
  const marksRef = useRef(null)
  const caretRef = useRef(null)
  const boxWidthRef = useRef(null)
  const shownRef = useRef(null)
  const items = visible.flatMap(mark => {
    const item = { key: `mark-${mark.id}`, kind: mark.symbol === DOT ? 'dot' : 'dash' }
    return mark.endsLetter ? [item, { key: `letter-${mark.id}`, kind: 'letter' }] : [item]
  })

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(([entry]) => {
      boxWidthRef.current = entry.contentRect.width
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const previous = shownRef.current
    shownRef.current = items
    const boxWidth = boxWidthRef.current
    if (!previous || boxWidth === null || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const moves = rowMoves(previous, items, boxWidth)
    if (!moves) return
    glide(marksRef.current, -moves.marks)
    glide(caretRef.current, -moves.caret)
  })

  return (
    <div ref={boxRef} className="mt-2.5 flex justify-end overflow-hidden">
      <div className="flex min-h-[34px] flex-[1_0_auto] items-center gap-[7px]">
        {items.length > 0 && (
          <span ref={marksRef} className="flex flex-none items-center gap-[7px]">
            {items.map(({ key, kind }) =>
              kind === 'letter' ? (
                <span key={key} className="block h-[22px] w-[2px] flex-none animate-letter-in rounded-[2px] bg-edge motion-reduce:animate-none" />
              ) : (
                <span
                  key={key}
                  className={`block h-[15px] flex-none animate-mark-pop rounded-full motion-reduce:animate-none ${kind === 'dot' ? 'w-[15px] bg-primary' : 'w-10 bg-secondary'}`}
                />
              ),
            )}
          </span>
        )}
        <span ref={caretRef} className="flex-none">
          <span className="block h-[22px] w-[3px] rounded-[2px] bg-ink motion-safe:animate-caret" />
        </span>
      </div>
    </div>
  )
}

const glides = new WeakMap() // element -> { animation, from }

// Slide from `fromPx` back to where the element now is, carrying on from wherever a slide still running has got to.
function glide(element, fromPx) {
  if (!element || typeof element.animate !== 'function') return
  let from = fromPx
  const running = glides.get(element)
  if (running && running.animation.playState === 'running') {
    const progress = running.animation.effect.getComputedTiming().progress ?? 1
    from += running.from * (1 - progress)
    running.animation.cancel()
  }
  glides.delete(element)
  if (Math.abs(from) < 0.5) return
  const animation = element.animate([{ transform: `translateX(${from}px)` }, { transform: 'translateX(0)' }], GLIDE)
  glides.set(element, { animation, from })
}
