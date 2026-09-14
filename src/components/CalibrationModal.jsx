import { useId, useState } from 'react'
import { useMorseInput } from '../hooks/useMorseInput.js'
import { toMorse } from '../morse/alphabet.js'
import { CALIBRATION_TEXT, calibrate } from '../morse/calibration.js'
import Modal from './Modal.jsx'
import StraightKey from './StraightKey.jsx'
import TransmissionStrip from './TransmissionStrip.jsx'

/** Key PARIS once on the straight key; offers the measured dot length to save. */
export default function CalibrationModal({ open, onClose, onSave, currentUnitMs, errorGapUnits, sidetone = false, touch = false }) {
  const titleId = useId()
  const [outcome, setOutcome] = useState(null) // null while listening, then calibrate()'s result
  const listening = open && outcome === null

  // Anchored to PARIS: the run finalizes on a short silence once all five
  // letters are in (right or wrong), and is measured then.
  const input = useMorseInput({
    mode: 'key',
    target: CALIBRATION_TEXT,
    errorGapUnits,
    enabled: listening,
    sidetone,
    haptics: true,
    beforePress: () => listening,
    onFinalize: run => {
      if (listening) setOutcome(calibrate(run.log, { errorGapUnits }))
    },
  })

  function startOver() {
    input.reset()
    setOutcome(null)
  }

  function close() {
    startOver()
    onClose()
  }

  return (
    <Modal open={open} onClose={close} width={620} labelledBy={titleId}>
      <div className="flex flex-col gap-[18px]">
        <div>
          <h2 id={titleId} className="text-[28px] font-extrabold leading-[1.1]">
            Calibrate your hand
          </h2>
          <p className="mt-2 text-[14.5px] font-medium leading-[1.45] text-ink-soft">
            Key PARIS on the straight key at your natural speed. Operators use it to measure speed, and it tells the key where to
            start.
          </p>
        </div>

        <div aria-hidden="true" className="grid grid-cols-5 gap-2.5">
          {[...CALIBRATION_TEXT].map(letter => (
            <div key={letter} className="flex flex-col gap-[9px] rounded-bubble bg-paper-2 px-3 py-[11px]">
              <span className="text-[21px] font-extrabold leading-none">{letter}</span>
              <span className="flex min-h-3.5 items-center gap-1">
                {[...toMorse(letter)].map((mark, i) => (
                  <span
                    key={i}
                    className={`block h-3 flex-none rounded-full ${mark === '.' ? 'w-3 bg-primary' : 'w-5 bg-secondary'}`}
                  />
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="sr-only">PARIS is dot dash dash dot, dot dash, dot dash dot, dot dot, dot dot dot.</p>

        {outcome === null && (
          <>
            <TransmissionStrip strip={input.strip} lite={touch} />
            <div className="flex flex-col items-center gap-2">
              <StraightKey isDown={input.isKeyDown} dashFormed={input.dashFormed} keyProps={input.keyProps} />
              <span className="text-[11.5px] font-medium tracking-[.02em] text-ink-soft pointer-coarse:hidden">
                Keyboard: hold space for the key
              </span>
            </div>
          </>
        )}

        {outcome?.ok && (
          <>
            <div className="rounded-box bg-paper-2 px-4 py-3.5" role="status">
              <div className="eyebrow">Measured</div>
              <div className="text-[30px] font-extrabold leading-[1.1] tabular-nums">{Math.round(outcome.wpm)} wpm</div>
              <p className="mt-1 text-[13.5px] font-medium leading-[1.45] text-ink-soft">
                A {Math.round(outcome.unitMs)} ms dot{currentUnitMs !== null && ` (was ${Math.round(currentUnitMs)} ms)`}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => {
                  onSave(outcome.unitMs)
                  startOver()
                }}
                className="rounded-full bg-primary px-[22px] py-[13px] text-[15px] font-extrabold text-on-primary shadow-button active:translate-y-[5px] active:shadow-none"
              >
                Save
              </button>
              <button
                type="button"
                onClick={startOver}
                className="rounded-full border-2 border-edge bg-transparent px-5 py-[13px] text-[14.5px] font-bold text-ink"
              >
                Try again
              </button>
            </div>
          </>
        )}

        {outcome && !outcome.ok && (
          <>
            <div className="rounded-box bg-paper-2 px-4 py-3.5" role="status">
              <p className="text-[14.5px] font-semibold leading-[1.45]">
                That came through as “{outcome.heard || 'nothing'}”, not PARIS. Take it a little slower.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={startOver}
                className="rounded-full bg-primary px-[22px] py-[13px] text-[15px] font-extrabold text-on-primary shadow-button active:translate-y-[5px] active:shadow-none"
              >
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
