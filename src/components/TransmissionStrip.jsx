import { motion } from 'framer-motion'
import { DASH, DOT, LETTER_GAP, isMark } from '../morse/timing.js'

const VISIBLE_SYMBOLS = 40

const pop = {
  initial: { scale: 0.2, opacity: 0 },
  animate: { scale: [0.2, 1.18, 1], opacity: [0, 1, 1] },
  transition: { duration: 0.22, times: [0, 0.6, 1], ease: [0.2, 1.7, 0.4, 1] },
}

/** Raw dots and dashes as they are keyed, newest on the right. Never decoded. */
export default function TransmissionStrip({ symbols }) {
  const hint = symbols.length === 0 ? 'nothing yet' : isMark(symbols.at(-1)) ? 'letter forming' : 'letter sent'
  const start = Math.max(0, symbols.length - VISIBLE_SYMBOLS)

  return (
    <section aria-label="Transmission" className="rounded-box border-2 border-edge bg-card px-4 py-[13px] shadow-card">
      <div className="eyebrow flex items-center justify-between gap-2.5">
        <span>Transmission</span>
        <span>{hint}</span>
      </div>
      {/* Grows to fill when short; overflows off the left edge when long, keeping the newest visible. */}
      <div className="mt-2.5 flex justify-end overflow-hidden">
        <div className="flex min-h-[34px] flex-[1_0_auto] items-center gap-[7px]">
          {symbols.slice(start).map((symbol, i) => (
            <Symbol key={start + i} symbol={symbol} />
          ))}
          <span className="block h-[22px] w-[3px] flex-none rounded-[2px] bg-ink motion-safe:animate-caret" />
        </div>
      </div>
    </section>
  )
}

function Symbol({ symbol }) {
  if (symbol === DOT) return <motion.span {...pop} className="block size-[15px] flex-none rounded-full bg-primary" />
  if (symbol === DASH) return <motion.span {...pop} className="block h-[15px] w-10 flex-none rounded-full bg-secondary" />
  if (symbol === LETTER_GAP) return <span className="block h-[22px] w-[2px] flex-none rounded-[2px] bg-edge" />
  return <span className="mb-[3px] block h-[2px] w-4 flex-none self-end rounded-[2px] bg-ink-soft opacity-50" />
}
