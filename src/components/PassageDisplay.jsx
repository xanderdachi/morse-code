import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { isSendable } from '../morse/alphabet.js'

// Compact (touch layout): the panel's height is capped by --passage-room and it
// scrolls inside itself, with smaller type on small screens.
const COMPACT_PANEL = 'max-h-(--passage-room) overflow-y-auto overscroll-contain'

/**
 * The passage, with a cursor on the next letter to send. Only position is
 * shown here; nothing about whether earlier letters were right.
 * Pass passage={null} while passages are loading.
 *
 * `compact` is the touch layout: the panel scrolls within the height the page
 * gives it, and follows the cursor unless the reader has scrolled away from it.
 * `idle` (no run under way) takes it back to the top of the passage.
 */
export default memo(function PassageDisplay({ passage, lettersSent, compact = false, idle = true, ref }) {
  const text = passage?.text ?? ''
  const words = useMemo(() => layoutWords(text), [text])
  const ownRef = useRef(null)
  const panelRef = ref ?? ownRef
  const cursorRef = useRef(lettersSent)

  // A new passage, or a run reset: start from the top. Scrolling ahead to read
  // before keying is left alone, since nothing here changes until a run does.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (compact && idle && panel) panel.scrollTop = 0
  }, [compact, idle, panelRef, text])

  useLayoutEffect(() => {
    const from = cursorRef.current
    cursorRef.current = lettersSent
    const panel = panelRef.current
    // Only forward moves. The count can dip while letters regroup, and that must not move the panel.
    if (compact && panel && lettersSent > from) followCursor(panel, from)
  }, [compact, panelRef, lettersSent])

  if (!passage) return <PassageSkeleton compact={compact} ref={panelRef} />

  return (
    <article
      ref={panelRef}
      className={`min-w-0 rounded-card border-2 border-edge bg-card px-6 pb-5 pt-[22px] shadow-card ${compact ? COMPACT_PANEL : ''}`}
    >
      <div className="mb-3.5 flex flex-wrap items-baseline gap-2">
        <span className="rounded-full bg-paper-2 px-[11px] py-[5px] text-[11px] font-bold uppercase tracking-[.09em] text-ink">
          {passage.culture}
        </span>
        {passage.era && <span className="text-[12.5px] font-semibold text-ink-soft">{passage.era}</span>}
      </div>

      <p className="sr-only">{passage.text}</p>
      <p
        aria-hidden="true"
        className={`flex flex-wrap gap-x-[.34em] font-serif leading-[1.46] tracking-[-.005em] text-pretty ${
          compact
            ? 'text-[20px] max-[380px]:text-[18px] sm:text-[26px] [@media(max-height:640px)]:text-[18px]'
            : 'text-[22px] sm:text-[31px]'
        }`}
      >
        {words.map((word, w) => (
          <span key={w} className="whitespace-nowrap">
            {word.map(({ char, letter }, c) => (
              <span
                key={c}
                data-letter={letter === -1 ? undefined : letter}
                data-cursor={letter === lettersSent || undefined}
                className={charClass(letter, lettersSent)}
              >
                {char}
              </span>
            ))}
          </span>
        ))}
      </p>

      <div className="mt-4 flex flex-wrap gap-x-2.5 gap-y-1 border-t-2 border-dashed border-edge pt-3.5 font-serif text-[13px] font-medium text-ink-soft">
        <span className="text-[14.5px] italic text-ink">{passage.title}</span>
        <span aria-hidden="true">·</span>
        <span>{passage.author}</span>
      </div>
    </article>
  )
})

function PassageSkeleton({ compact, ref }) {
  return (
    <article
      ref={ref}
      aria-busy="true"
      className={`min-w-0 rounded-card border-2 border-edge bg-card px-6 pb-5 pt-[22px] shadow-card ${compact ? COMPACT_PANEL : ''}`}
    >
      <span className="sr-only">Loading passage</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="mb-3.5 h-[25px] w-20 rounded-full bg-paper-2" />
        <div className="flex h-[32px] items-center sm:h-[45px]">
          <div className="h-[60%] w-3/4 rounded-mark bg-paper-2" />
        </div>
        <div className="mt-4 border-t-2 border-dashed border-edge pt-3.5">
          <div className="h-[19px] w-44 rounded-full bg-paper-2" />
        </div>
      </div>
    </article>
  )
}

// Keep the next letter in view as sending moves it on: a cursor running off the
// bottom brings its line up to a third of the way down. If the reader has
// scrolled away (the cursor's previous place, `from`, isn't on screen), leave
// the panel where they put it. Only the panel scrolls, never the page.
function followCursor(panel, from) {
  const cursor = panel.querySelector('[data-cursor]')
  if (!cursor || panel.scrollHeight <= panel.clientHeight) return
  const view = panel.getBoundingClientRect()
  const previous = panel.querySelector(`[data-letter="${from}"]`)?.getBoundingClientRect()
  if (previous && (previous.bottom <= view.top || previous.top >= view.bottom)) return

  const mark = cursor.getBoundingClientRect()
  let offset = 0
  if (mark.bottom > view.bottom - mark.height / 2) offset = mark.top - view.top - view.height / 3
  else if (mark.top < view.top) offset = mark.top - view.top - mark.height
  if (offset === 0) return
  const smooth = !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  panel.scrollTo({ top: panel.scrollTop + offset, behavior: smooth ? 'smooth' : 'instant' })
}

// Split into words of characters; `letter` is the character's index among
// sendable letters, or -1 for characters the operator skips.
function layoutWords(text) {
  let letter = 0
  return text
    .normalize('NFC')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => [...word].map(char => ({ char, letter: isSendable(char) ? letter++ : -1 })))
}

function charClass(letter, lettersSent) {
  if (letter === lettersSent) return 'rounded-mark bg-primary px-[2px] text-on-primary shadow-cursor'
  if (letter === -1 || letter < lettersSent) return 'text-ink-soft'
  return 'text-ink'
}
