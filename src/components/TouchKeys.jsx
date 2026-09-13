import { DASH, DOT } from '../morse/symbols.js'

/**
 * The keys for a touchscreen. Docked, they float at the bottom of the screen
 * within thumb reach, clear of the home indicator: one round key in the middle
 * for the straight key, or dot bottom-left and dash bottom-right. Inline, the
 * same keys sit in the page flow (the intro's try-it card). Input handling
 * comes from useMorseInput; leave the props out for a picture of the keys.
 */
export default function TouchKeys({
  mode,
  isDown = false,
  dashFormed = false,
  padsDown = { [DOT]: false, [DASH]: false },
  keyProps,
  padProps,
  letterProps,
  docked = false,
  ref,
}) {
  const decorative = !keyProps && !padProps
  const place = docked
    ? 'pointer-events-none fixed inset-x-0 bottom-0 z-40 pt-3 pb-[calc(env(safe-area-inset-bottom)+18px)] pl-[max(18px,env(safe-area-inset-left))] pr-[max(18px,env(safe-area-inset-right))]'
    : ''

  if (mode === 'key') {
    return (
      <div ref={ref} data-touch-keys={docked ? 'docked' : 'inline'} className={`flex justify-center ${place}`}>
        <button
          type="button"
          aria-label="Morse key: hold briefly for a dot, longer for a dash"
          aria-hidden={decorative || undefined}
          tabIndex={decorative ? -1 : undefined}
          {...keyProps}
          className={`pointer-events-auto relative grid touch-key place-items-center rounded-full bg-paper-2 transition-[translate,box-shadow] duration-70 ${
            docked ? 'size-[clamp(104px,34vw,136px)]' : 'size-[112px]'
          } ${isDown ? 'translate-y-[6px] shadow-float-down' : 'shadow-float'}`}
        >
          <span className={`grid size-[74%] place-items-center rounded-full bg-primary ${isDown ? 'shadow-cap-down' : 'shadow-cap'}`}>
            <span
              className={`block h-3.5 rounded-full bg-glyph transition-[width] duration-350 ease-[cubic-bezier(.2,1.3,.4,1)] ${
                dashFormed ? 'w-[48px]' : 'w-3.5'
              }`}
            />
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      data-touch-keys={docked ? 'docked' : 'inline'}
      className={`flex items-end ${docked ? `justify-between gap-3 ${place}` : 'justify-center gap-6'}`}
    >
      <PadKey label="Dot" held={padsDown[DOT]} docked={docked} decorative={decorative} className="bg-primary" {...padProps?.[DOT]}>
        <span className="block size-[26px] rounded-full bg-glyph" />
      </PadKey>
      {docked && letterProps && (
        <button
          type="button"
          {...letterProps}
          className="pointer-events-auto mb-2 min-w-0 whitespace-nowrap rounded-full border-2 border-edge bg-paper-2 px-4 py-[9px] text-[13px] font-bold text-ink shadow-float [-webkit-tap-highlight-color:transparent] active:translate-y-[3px] active:shadow-float-down max-[360px]:px-2.5 max-[360px]:text-[12px]"
        >
          end letter
        </button>
      )}
      <PadKey label="Dash" held={padsDown[DASH]} docked={docked} decorative={decorative} className="bg-secondary" {...padProps?.[DASH]}>
        <span className="block h-[26px] w-[54px] rounded-full bg-glyph" />
      </PadKey>
    </div>
  )
}

function PadKey({ label, held, docked, decorative, className, children, ...pointerProps }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-hidden={decorative || undefined}
      tabIndex={decorative ? -1 : undefined}
      data-held={held}
      {...pointerProps}
      className={`pointer-events-auto grid flex-none touch-key place-items-center rounded-full transition-[translate,box-shadow] duration-70 ${
        docked ? 'size-[clamp(88px,27vw,120px)]' : 'size-[92px]'
      } ${held ? 'translate-y-[6px] shadow-float-down' : 'shadow-float'} ${className}`}
    >
      {children}
    </button>
  )
}
