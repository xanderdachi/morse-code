import { useEffect, useEffectEvent } from 'react'
import { eventTime, isTypingTarget } from '../hooks/useMorseInput.js'

/** One big key: hold time decides dot or dash. Spacebar works as the key on desktop. */
export default function StraightKey({ isDown, dashFormed, keyboardEnabled, onPress, onRelease, onCancel }) {
  const press = useEffectEvent(at => onPress(at))
  const release = useEffectEvent(at => onRelease(at))
  const cancel = useEffectEvent(() => onCancel())

  useEffect(() => {
    if (!keyboardEnabled) return

    const isSpace = event => event.code === 'Space' && !isTypingTarget(event.target)
    const onKeyDown = event => {
      if (!isSpace(event)) return
      event.preventDefault()
      if (!event.repeat) press(eventTime(event))
    }
    const onKeyUp = event => {
      if (!isSpace(event)) return
      event.preventDefault()
      release(eventTime(event))
    }
    const onBlur = () => cancel()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [keyboardEnabled])

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        aria-label="Morse key: hold briefly for a dot, longer for a dash"
        onPointerDown={event => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          onPress(eventTime(event))
        }}
        onPointerUp={event => onRelease(eventTime(event))}
        onPointerCancel={() => onCancel()}
        onContextMenu={event => event.preventDefault()}
        className={`relative grid size-[138px] touch-none select-none place-items-center rounded-full bg-paper-2 transition-[translate,box-shadow] duration-70 [-webkit-touch-callout:none] sm:size-[186px] ${
          isDown ? 'translate-y-[6px] shadow-key-down' : 'shadow-button'
        }`}
      >
        <span
          className={`grid size-[74%] place-items-center rounded-full bg-primary ${isDown ? 'shadow-cap-down' : 'shadow-cap'}`}
        >
          <span
            className={`block h-4 rounded-full bg-glyph transition-[width] duration-350 ease-[cubic-bezier(.2,1.3,.4,1)] ${
              dashFormed ? 'w-[62px]' : 'w-4'
            }`}
          />
        </span>
      </button>
      <p className="max-w-[260px] text-center text-[12.5px] font-semibold text-pretty text-ink-soft">
        Short press makes a dot, long press makes a dash. Pause to end a letter.
      </p>
    </div>
  )
}
