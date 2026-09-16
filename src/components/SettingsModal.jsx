import { useId } from 'react'
import { KEYER_WPM, UNANCHORED_FROM_TIER } from '../lib/progress.js'
import { CONFIG } from '../morse/timing.js'
import { wpmForUnitMs } from '../morse/units.js'
import InputModeToggle from './InputModeToggle.jsx'
import Modal from './Modal.jsx'

export default function SettingsModal({
  open,
  onClose,
  mode,
  onModeChange,
  unitMs,
  tier,
  anchoredInput,
  onAnchoredChange,
  onCalibrate,
  onClearCalibration,
  touchControls,
  onTouchControlsChange,
  coarsePointer,
  sidetone,
  onSidetoneChange,
  onShowIntro,
  keyerMode,
  onKeyerModeChange,
  keyerWpm,
  onKeyerWpmChange,
}) {
  const titleId = useId()
  const calibrated = unitMs !== null
  const startingUnit = unitMs ?? CONFIG.defaultUnitMs

  return (
    <Modal open={open} onClose={onClose} width={560} labelledBy={titleId}>
      <div className="flex flex-col gap-[18px]">
        <h2 id={titleId} className="text-[28px] font-extrabold leading-[1.1]">
          Settings
        </h2>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[.1em] text-ink-soft">Input mode</span>
          <div className="self-start">
            <InputModeToggle mode={mode} onChange={onModeChange} />
          </div>
        </div>

        {/* The keyer belongs to the pad; the straight key always reads real presses. */}
        {mode === 'pad' && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[.1em] text-ink-soft">Pad keyer</span>
            <Choice
              label="Pad keyer"
              value={keyerMode}
              onChange={onKeyerModeChange}
              options={[
                ['manual', 'Manual'],
                ['iambic', 'Iambic'],
              ]}
            />
            <p className="text-[13px] font-medium leading-[1.5] text-ink-soft">
              {keyerMode === 'iambic'
                ? 'Tap once for each dot or dash, and the keyer times it perfectly. Hold a pad only to repeat it: every element period it stays down sends another. Hold both to alternate. Iambic runs are ranked on their own.'
                : 'Each tap on the dot or dash pad sends one element.'}
            </p>
            {keyerMode === 'iambic' && (
              <label className="flex items-center gap-3.5 rounded-box bg-paper-2 px-4 py-3">
                <span className="text-[13.5px] font-bold text-ink-soft">Speed</span>
                <input
                  type="range"
                  min={KEYER_WPM.min}
                  max={KEYER_WPM.max}
                  step={1}
                  value={keyerWpm}
                  onChange={event => onKeyerWpmChange(Number(event.target.value))}
                  className="min-w-0 flex-1 accent-primary"
                />
                <span className="w-[62px] text-right text-[15px] font-extrabold tabular-nums">{keyerWpm} wpm</span>
              </label>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[.1em] text-ink-soft">Touch controls</span>
          <Choice
            label="Touch controls"
            value={touchControls}
            onChange={onTouchControlsChange}
            options={[
              ['auto', 'Auto'],
              ['on', 'On'],
              ['off', 'Off'],
            ]}
          />
          <p className="text-[13px] font-medium leading-[1.5] text-ink-soft">
            {touchControls === 'auto'
              ? coarsePointer
                ? 'On for this touchscreen: big keys sit at the bottom of the screen, in reach of your thumbs.'
                : 'Off on this device, which has a mouse or trackpad. They switch on by themselves on a touchscreen.'
              : touchControls === 'on'
                ? 'Big keys sit at the bottom of the screen, whatever the device.'
                : 'The key stays in the page, and the keyboard works as usual.'}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[.1em] text-ink-soft">Sidetone</span>
          <Choice
            label="Sidetone"
            value={sidetone}
            onChange={onSidetoneChange}
            options={[
              [true, 'On'],
              [false, 'Off'],
            ]}
          />
          <p className="text-[13px] font-medium leading-[1.5] text-ink-soft">A tone while the key is down, so you can hear your rhythm.</p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[.1em] text-ink-soft">Letter boundaries</span>
          {tier >= UNANCHORED_FROM_TIER ? (
            <>
              <Choice
                label="Letter boundaries"
                value={anchoredInput}
                onChange={onAnchoredChange}
                options={[
                  [true, 'Anchored'],
                  [false, 'Pure timing'],
                ]}
              />
              <p className="text-[13px] font-medium leading-[1.5] text-ink-soft">
                {anchoredInput
                  ? 'The passage tells the key where each letter ends. Your spacing is never judged.'
                  : 'Letters end only where your spacing says they do, like on a real wire.'}
              </p>
            </>
          ) : (
            <p className="text-[13.5px] font-medium leading-[1.45] text-ink-soft">
              The passage tells the key where each letter ends. Sending on pure timing unlocks at tier {UNANCHORED_FROM_TIER}.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[.1em] text-ink-soft">Keying speed</span>
          <div className="rounded-box bg-paper-2 px-4 py-3.5">
            <div className="text-[30px] font-extrabold leading-[1.1] tabular-nums">{Math.round(wpmForUnitMs(startingUnit))} wpm</div>
            <p className="mt-1 text-[13.5px] font-medium leading-[1.45] text-ink-soft">
              {calibrated
                ? `Calibrated to a ${Math.round(startingUnit)} ms dot.`
                : 'Not calibrated. The key starts here and adapts to you as you send.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={onCalibrate}
              className="rounded-full bg-primary px-[22px] py-[13px] text-[15px] font-extrabold text-on-primary shadow-button active:translate-y-[5px] active:shadow-none"
            >
              Calibrate with PARIS
            </button>
            {calibrated && (
              <button
                type="button"
                onClick={onClearCalibration}
                className="rounded-full border-2 border-edge bg-transparent px-5 py-3 text-[14px] font-bold text-ink-soft"
              >
                Use the default
              </button>
            )}
          </div>
        </div>

        <p className="text-[13px] font-medium leading-[1.5] text-ink-soft">
          Every run adapts to your speed as you go. Calibrating just gives the key the right place to start, which helps most on
          the first few letters.
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={onShowIntro ?? undefined}
            disabled={!onShowIntro}
            className="rounded-full border-2 border-edge bg-transparent px-5 py-3 text-[14px] font-bold text-ink-soft disabled:opacity-55"
          >
            Show intro again
          </button>
          {!onShowIntro && <span className="text-[12.5px] font-semibold text-ink-soft">Available once this run is over.</span>}
        </div>
      </div>
    </Modal>
  )
}

function Choice({ label, value, onChange, options }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-[9px] self-start rounded-full bg-paper-2 p-[5px] shadow-well">
      {options.map(([option, text]) => (
        <button
          key={text}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`rounded-full px-[17px] py-[11px] text-[13.5px] font-bold ${
            value === option ? 'bg-card text-ink shadow-button' : 'bg-transparent text-ink-soft'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
