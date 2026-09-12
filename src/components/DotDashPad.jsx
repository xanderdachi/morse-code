import { useEffect, useEffectEvent, useState } from 'react'
import { eventTime, isTypingTarget } from '../hooks/useMorseInput.js'
import { DASH, DOT } from '../morse/timing.js'

const KEY_TO_SYMBOL = { '.': DOT, '-': DASH }
const NOTHING_HELD = { [DOT]: false, [DASH]: false }

/** Separate dot and dash buttons. On desktop: . for dot, - for dash, space ends a word. */
export default function DotDashPad({ keyboardEnabled, onPress, onRelease, onWordBreak, onCancel }) {
  const [held, setHeld] = useState(NOTHING_HELD)

  const pressSymbol = (symbol, at) => {
    setHeld(current => ({ ...current, [symbol]: true }))
    onPress(symbol, at)
  }
  const releaseSymbol = (symbol, at) => {
    setHeld(current => ({ ...current, [symbol]: false }))
    onRelease(at)
  }

  const handleKeyDown = useEffectEvent(event => {
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
    const symbol = KEY_TO_SYMBOL[event.key]
    if (symbol) {
      event.preventDefault()
      if (!event.repeat) pressSymbol(symbol, eventTime(event))
    } else if (event.code === 'Space') {
      event.preventDefault()
      if (!event.repeat) onWordBreak()
    }
  })
  const handleKeyUp = useEffectEvent(event => {
    if (isTypingTarget(event.target)) return
    const symbol = KEY_TO_SYMBOL[event.key]
    if (symbol) releaseSymbol(symbol, eventTime(event))
    else if (event.code === 'Space') event.preventDefault()
  })
  const handleBlur = useEffectEvent(() => {
    setHeld(NOTHING_HELD)
    onCancel()
  })

  useEffect(() => {
    if (!keyboardEnabled) return
    const onKeyDown = event => handleKeyDown(event)
    const onKeyUp = event => handleKeyUp(event)
    const onBlur = () => handleBlur()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [keyboardEnabled])

  const buttonProps = symbol => ({
    held: held[symbol],
    onDown: at => pressSymbol(symbol, at),
    onUp: at => releaseSymbol(symbol, at),
  })

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex w-full justify-center gap-3.5">
        <PadButton label="Dot" className="bg-primary" {...buttonProps(DOT)}>
          <span className="block size-[34px] rounded-full bg-glyph" />
        </PadButton>
        <PadButton label="Dash" className="bg-secondary" {...buttonProps(DASH)}>
          <span className="block h-[34px] w-[70px] rounded-full bg-glyph" />
        </PadButton>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onWordBreak}
          className="rounded-full border-2 border-edge bg-paper-2 px-[18px] py-[9px] text-[13px] font-bold text-ink active:translate-y-[3px]"
        >
          space
        </button>
        <span className="text-[12.5px] font-semibold text-ink-soft">or just pause between letters</span>
      </div>
    </div>
  )
}

function PadButton({ label, held, onDown, onUp, className, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-held={held}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        onDown(eventTime(event))
      }}
      onPointerUp={event => onUp(eventTime(event))}
      onPointerCancel={event => onUp(eventTime(event))}
      onClick={event => {
        // Enter on a focused button fires no pointer events: send a quick tap.
        if (event.detail !== 0) return
        onDown()
        onUp()
      }}
      onContextMenu={event => event.preventDefault()}
      className={`grid h-[138px] max-h-[170px] min-w-0 flex-[1_1_0] touch-none select-none place-items-center rounded-pad shadow-button [-webkit-touch-callout:none] active:translate-y-[6px] active:shadow-none data-[held=true]:translate-y-[6px] data-[held=true]:shadow-none sm:h-[186px] ${className}`}
    >
      {children}
    </button>
  )
}
