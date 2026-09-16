import { DASH, DOT } from '../morse/symbols.js'

/**
 * Dot and dash buttons, plus an "end letter" control that forces a letter
 * boundary. Input handling comes from useMorseInput. `pulses`, with the iambic
 * keyer, counts the elements each paddle has sent: the glyph pops once per element.
 */
export default function DotDashPad({ padsDown, padProps, letterProps, pulses = null }) {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex w-full justify-center gap-3.5">
        <PadButton label="Dot" held={padsDown[DOT]} className="bg-primary" {...padProps[DOT]}>
          <ElementPulse count={pulses?.[DOT]}>
            <span className="block size-[34px] rounded-full bg-glyph" />
          </ElementPulse>
        </PadButton>
        <PadButton label="Dash" held={padsDown[DASH]} className="bg-secondary" {...padProps[DASH]}>
          <ElementPulse count={pulses?.[DASH]}>
            <span className="block h-[34px] w-[70px] rounded-full bg-glyph" />
          </ElementPulse>
        </PadButton>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <button type="button" {...letterProps} className={CONTROL_CLASS}>
          end letter
        </button>
        <span className="text-[12.5px] font-semibold text-ink-soft">only if you need it</span>
      </div>
    </div>
  )
}

const CONTROL_CLASS =
  'rounded-full border-2 border-edge bg-paper-2 px-[18px] py-[9px] text-[13px] font-bold text-ink active:translate-y-[3px]'

/**
 * A pad's glyph, popping once each time `count` goes up: an element the iambic keyer just sent, drawn with
 * the transmission strip's own mark pop. Nothing moves before the first element, or without a count.
 */
export function ElementPulse({ count = 0, children }) {
  return (
    <span key={count} data-pulse={count} className={`grid place-items-center ${count > 0 ? 'animate-mark-pop motion-reduce:animate-none' : ''}`}>
      {children}
    </span>
  )
}

function PadButton({ label, held, className, children, ...pointerProps }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-held={held}
      {...pointerProps}
      className={`grid h-[138px] max-h-[170px] min-w-0 flex-[1_1_0] touch-key place-items-center rounded-pad shadow-button active:translate-y-[6px] active:shadow-none data-[held=true]:translate-y-[6px] data-[held=true]:shadow-none sm:h-[186px] ${className}`}
    >
      {children}
    </button>
  )
}
