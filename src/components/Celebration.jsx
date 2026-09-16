import { LazyMotion, domMin, m } from 'framer-motion'

/** The round rubber stamp that thumps down in the results modal. */
export function Stamp({ value, label, className }) {
  return (
    <LazyMotion features={domMin}>
      <m.div
        className={`flex size-[118px] flex-none flex-col items-center justify-center gap-[2px] rounded-full shadow-stamp ${className}`}
        initial={{ rotate: -24, scale: 2.6, opacity: 0 }}
        animate={{ rotate: [-24, 8, -6, -9], scale: [2.6, 0.88, 1.06, 1], opacity: [0, 1, 1, 1] }}
        transition={{ duration: 0.55, times: [0, 0.55, 0.75, 1], ease: [0.2, 1.4, 0.4, 1] }}
      >
        <span className="text-[44px] font-extrabold leading-none">{value}</span>
        <span className="text-[9.5px] font-bold tracking-[.22em]">{label}</span>
      </m.div>
    </LazyMotion>
  )
}

const CONFETTI_COLORS = ['bg-primary', 'bg-accent', 'bg-secondary']

/** Falling confetti across the nearest positioned ancestor (the modal card). */
export function Confetti() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] motion-reduce:hidden">
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          className={`absolute -top-6 h-[11px] rounded-full animate-confetti ${CONFETTI_COLORS[i % 3]} ${i % 3 === 1 ? 'w-[26px]' : 'w-[11px]'}`}
          style={{
            left: `${3 + ((i * 3.4) % 94)}%`,
            animationDuration: `${1.7 + (i % 5) * 0.35}s`,
            animationDelay: `${(i % 7) * 0.13}s`,
          }}
        />
      ))}
    </div>
  )
}
