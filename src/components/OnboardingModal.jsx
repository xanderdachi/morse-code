import { useIsPresent } from 'framer-motion'
import { useEffect, useId, useRef, useState } from 'react'
import { useMorseInput } from '../hooks/useMorseInput.js'
import { DASH, DOT } from '../morse/symbols.js'
import Modal from './Modal.jsx'
import Pip from './Pip.jsx'
import TouchKeys from './TouchKeys.jsx'
import TransmissionStrip from './TransmissionStrip.jsx'

const STEPS = ['welcome', 'keying', 'try', 'after']
const TRY = STEPS.indexOf('try')
export const TRY_LETTER = 'E'

/**
 * The first-visit intro: four cards from Pip, under half a minute. The third
 * is live: Pip asks for an E on the real input engine, and the card moves on
 * the moment one arrives. Closable at every step; `onClose` fires however it
 * was closed. Its steps reset each time it opens.
 *
 *   touch          whether this device keys on the touch keys (else the keyboard)
 *   mode           'key' or 'pad'
 *   errorGapUnits  from the tier's leniency table, as for any run
 *   keyerMode, keyerWpm  the pad's keyer, so the try-it card keys the way a run would
 */
export default function OnboardingModal({ open, onClose, ...props }) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onClose} width={540} labelledBy={titleId}>
      <Intro titleId={titleId} onClose={onClose} {...props} />
    </Modal>
  )
}

function Intro({ titleId, onClose, touch, mode, unitMs = null, errorGapUnits, keyerMode = 'manual', keyerWpm = null, sidetone = false }) {
  const [step, setStep] = useState(0)
  const [missed, setMissed] = useState(false)
  const [passed, setPassed] = useState(false)
  const present = useIsPresent() // false while the modal animates away
  const trying = present && step === TRY
  const tryRef = useRef(null)

  const input = useMorseInput({
    mode,
    target: TRY_LETTER,
    errorGapUnits,
    keyerMode,
    keyerWpm,
    unitMs,
    enabled: trying,
    sidetone,
    haptics: true,
    beforePress: () => trying,
    // The first letter the engine commits is the answer: an E moves straight on,
    // anything else clears the wire for another go.
    onUpdate: state => {
      if (!trying || state.lettersSent === 0) return
      const correct = state.text[0] === TRY_LETTER
      setMissed(!correct)
      if (correct) {
        setPassed(true)
        setStep(TRY + 1)
      }
      queueMicrotask(input.reset)
    },
  })

  // Keyboard focus off the buttons, so a held spacebar can't press one.
  useEffect(() => {
    if (step === TRY) tryRef.current?.focus({ preventScroll: true })
  }, [step])

  function goTo(next) {
    input.reset()
    setMissed(false)
    setStep(next)
  }

  const kind = STEPS[step]
  const keyName = mode === 'key' ? 'key' : keyerMode === 'iambic' ? 'iambic' : 'pad'

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-baseline gap-3 pr-12">
        <h2 id={titleId} className="eyebrow">
          {kind === 'after' && passed ? 'Nice E!' : 'Welcome to Morse Club'}
        </h2>
        <span className="eyebrow ml-auto">
          {step + 1} of {STEPS.length}
        </span>
      </div>

      <div className="flex items-end gap-3">
        <Pip />
        <p
          aria-live="polite"
          className="min-w-0 rounded-bubble rounded-bl-mark border-2 border-edge bg-card px-3.5 py-2.5 text-[15px] font-semibold leading-[1.4] text-pretty text-ink shadow-card"
        >
          {kind === 'welcome' && 'You send passages of world literature down the wire in Morse code, one letter at a time.'}
          {kind === 'keying' && KEYING_LINES[touch ? 'touch' : 'keyboard'][keyName]}
          {kind === 'try' && (missed ? MISSED_LINES[keyName] : TRY_LINES[keyName])}
          {kind === 'after' && 'Mistakes only show up after the run, never during it, and pausing to think costs you nothing.'}
        </p>
      </div>

      <div
        ref={tryRef}
        tabIndex={-1}
        className="flex min-h-[176px] flex-col items-center justify-center gap-4 rounded-panel bg-paper-2 px-4 py-[18px] outline-none sm:px-5"
      >
        {kind === 'welcome' && <PassagePicture />}
        {kind === 'keying' &&
          (touch ? <TouchKeys mode={mode} /> : <KeyboardKeys mode={mode} />)}
        {kind === 'try' && (
          <>
            <div className="w-full">
              <TransmissionStrip strip={input.strip} lite={touch} />
            </div>
            {touch ? (
              <TouchKeys
                mode={mode}
                isDown={input.isKeyDown}
                dashFormed={input.dashFormed}
                padsDown={input.padsDown}
                keyProps={input.keyProps}
                padProps={input.padProps}
                pulses={keyName === 'iambic' ? input.pulses : null}
              />
            ) : (
              <KeyboardKeys mode={mode} input={input} />
            )}
          </>
        )}
        {kind === 'after' && (
          <>
            <AfterPicture />
            <p className="text-center text-[13px] font-semibold leading-[1.45] text-pretty text-ink-soft">
              Sent a letter you want back? Eight quick dots is the operator&rsquo;s signal to disregard it.
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div aria-hidden="true" className="mr-auto flex items-center gap-1.5">
          {STEPS.map((name, i) => (
            <span
              key={name}
              className={`block h-2.5 rounded-full transition-[width,background-color] duration-200 ${i === step ? 'w-6 bg-primary' : 'w-2.5 bg-paper-2'}`}
            />
          ))}
        </div>
        {step > 0 && (
          <button type="button" onClick={() => goTo(step - 1)} className={QUIET_BUTTON}>
            Back
          </button>
        )}
        {step === TRY ? (
          <button type="button" onClick={() => goTo(step + 1)} className={QUIET_BUTTON}>
            Skip
          </button>
        ) : step < STEPS.length - 1 ? (
          <button type="button" onClick={() => goTo(step + 1)} className={PRIMARY_BUTTON}>
            Next
          </button>
        ) : (
          <button type="button" onClick={onClose} className={PRIMARY_BUTTON}>
            Start sending
          </button>
        )}
      </div>
    </div>
  )
}

const PRIMARY_BUTTON =
  'rounded-full bg-primary px-[22px] py-[13px] text-[15px] font-extrabold text-on-primary shadow-button active:translate-y-[5px] active:shadow-none'
const QUIET_BUTTON = 'rounded-full border-2 border-edge bg-transparent px-5 py-3 text-[14.5px] font-bold text-ink'

const KEYING_LINES = {
  touch: {
    key: 'Hold the round key at the bottom of your screen: a quick press makes a dot, a longer one a dash.',
    pad: 'Tap the keys at the bottom of your screen, dot on the left and dash on the right.',
    // The iambic keyer times each element itself: an operator who holds for every element sends repeats.
    iambic: 'Tap the dot key on the left or the dash key on the right once for each element. Hold a key only to repeat it.',
  },
  keyboard: {
    key: 'Your spacebar is the telegraph key: a quick press makes a dot, a longer one a dash.',
    pad: 'Press the full stop for a dot and the hyphen for a dash.',
    iambic: 'Tap the full stop once for each dot and the hyphen once for each dash. Hold a key only to repeat it.',
  },
}

const TRY_LINES = {
  key: 'Your turn: send me an E, which is one quick press.',
  pad: 'Your turn: send me an E, which is a single dot.',
  iambic: 'Your turn: send me an E, which is one tap on the dot key.',
}

const MISSED_LINES = {
  key: 'Not quite, so try again: an E is just one quick press.',
  pad: 'Not quite, so try again: an E is just a single dot.',
  iambic: 'Not quite, so try again: an E is one tap on the dot key, let go straight away.',
}

// Keycaps for the keyboard. Given `input`, they press down with the real keys
// and take clicks and taps as well.
function KeyboardKeys({ mode, input }) {
  if (mode === 'key') {
    return (
      <Keycap label="Spacebar" pressed={input?.isKeyDown} className="w-[min(240px,100%)]" {...input?.keyProps}>
        space
      </Keycap>
    )
  }
  return (
    <div className="flex items-start gap-5">
      {[
        [DOT, '.', 'dot'],
        [DASH, '-', 'dash'],
      ].map(([pad, cap, name]) => (
        <div key={name} className="flex flex-col items-center gap-2">
          <Keycap label={`${name} key`} pressed={input?.padsDown[pad]} className="w-[68px] text-[26px]" {...input?.padProps[pad]}>
            {cap}
          </Keycap>
          <span className="eyebrow">{name}</span>
        </div>
      ))}
    </div>
  )
}

function Keycap({ label, pressed = false, className = '', children, ...props }) {
  const live = Object.keys(props).length > 0
  return (
    <button
      type="button"
      aria-label={label}
      aria-hidden={!live || undefined}
      tabIndex={live ? undefined : -1}
      {...props}
      className={`grid h-[58px] touch-key place-items-center rounded-bubble border-2 border-edge bg-card font-mono text-[15px] font-medium text-ink transition-[translate,box-shadow] duration-70 ${
        pressed ? 'translate-y-[5px] shadow-none' : 'shadow-button'
      } ${live ? '' : 'pointer-events-none'} ${className}`}
    >
      {children}
    </button>
  )
}

function PassagePicture() {
  const text = 'What is the sound of one hand?'
  const cursor = 8
  return (
    <div aria-hidden="true" className="w-full rounded-box border-2 border-edge bg-card px-4 pb-3.5 pt-3 shadow-card">
      <span className="rounded-full bg-paper-2 px-[11px] py-[5px] text-[11px] font-bold uppercase tracking-[.09em] text-ink">Japan</span>
      <p className="mt-2.5 font-serif text-[19px] leading-[1.4]">
        {[...text].map((char, i) => (
          <span
            key={i}
            className={i === cursor ? 'rounded-mark bg-primary px-[2px] text-on-primary shadow-cursor' : i < cursor ? 'text-ink-soft' : ''}
          >
            {char}
          </span>
        ))}
      </p>
      <div className="mt-3 flex items-center gap-[7px]">
        {['.', '-', '-', null, '.', '.', '.', '.', null, '.', '-'].map((mark, i) =>
          mark === null ? (
            <span key={i} className="block h-[18px] w-[2px] rounded-[2px] bg-edge" />
          ) : (
            <span key={i} className={`block h-3 rounded-full ${mark === DOT ? 'w-3 bg-primary' : 'w-8 bg-secondary'}`} />
          ),
        )}
      </div>
    </div>
  )
}

function AfterPicture() {
  const review = [
    ['H', 'H', 'match'],
    ['A', 'A', 'match'],
    ['N', 'M', 'substitute'],
    ['D', 'D', 'match'],
  ]
  return (
    <div aria-hidden="true" className="flex w-full flex-wrap gap-3">
      <div className="flex-[1_1_150px] rounded-tile border-2 border-edge bg-card px-3.5 py-[11px] shadow-card">
        <div className="flex items-center gap-2">
          <span className="block size-3.5 rounded-full bg-paper-2 shadow-lamp-off" />
          <span className="eyebrow">paused</span>
        </div>
        <div className="mt-1 text-[21px] font-extrabold leading-[1.2] tabular-nums">0:14</div>
        <div className="text-[12px] font-semibold text-ink-soft">clock stopped</div>
      </div>
      <div className="flex-[1_1_150px] rounded-tile border-2 border-edge bg-card px-3.5 py-[11px] shadow-card">
        <div className="eyebrow">After the run</div>
        <div className="mt-2 flex gap-1">
          {review.map(([expected, actual, op], i) => (
            <span
              key={i}
              className={`flex min-w-[21px] flex-col items-center gap-[2px] rounded-chip px-[3px] py-[5px] ${
                op === 'match' ? 'bg-paper-2' : 'bg-accent text-on-accent'
              }`}
            >
              <span className="font-serif text-[17px] leading-none">{expected}</span>
              <span className="font-mono text-[10.5px] font-medium leading-none opacity-80">{actual}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
