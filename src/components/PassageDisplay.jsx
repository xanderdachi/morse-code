import { useMemo } from 'react'
import { isSendable } from '../morse/alphabet.js'

/**
 * The passage, with a cursor on the next letter to send. Only position is
 * shown here; nothing about whether earlier letters were right.
 */
export default function PassageDisplay({ passage, lettersSent }) {
  const words = useMemo(() => layoutWords(passage.text), [passage.text])

  return (
    <article className="min-w-0 rounded-card border-2 border-edge bg-card px-6 pb-5 pt-[22px] shadow-card">
      <div className="mb-3.5 flex flex-wrap items-baseline gap-2">
        <span className="rounded-full bg-paper-2 px-[11px] py-[5px] text-[11px] font-bold uppercase tracking-[.09em] text-ink">
          {passage.culture}
        </span>
        <span className="text-[12.5px] font-semibold text-ink-soft">{passage.era}</span>
      </div>

      <p className="sr-only">{passage.text}</p>
      <p
        aria-hidden="true"
        className="flex flex-wrap gap-x-[.34em] font-serif text-[22px] leading-[1.46] tracking-[-.005em] text-pretty sm:text-[31px]"
      >
        {words.map((word, w) => (
          <span key={w} className="whitespace-nowrap">
            {word.map(({ char, letter }, c) => (
              <span key={c} className={charClass(letter, lettersSent)}>
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
