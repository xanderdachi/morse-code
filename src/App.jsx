import { MotionConfig } from 'framer-motion'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import DotDashPad from './components/DotDashPad.jsx'
import InputModeToggle from './components/InputModeToggle.jsx'
import PassageDisplay from './components/PassageDisplay.jsx'
import PassagePickerModal from './components/PassagePickerModal.jsx'
import Pip from './components/Pip.jsx'
import ResultsModal from './components/ResultsModal.jsx'
import StraightKey from './components/StraightKey.jsx'
import TransmissionStrip from './components/TransmissionStrip.jsx'
import { passages } from './data/passages.js'
import { useMorseInput } from './hooks/useMorseInput.js'
import { formatClock } from './lib/format.js'
import { normalize } from './morse/alphabet.js'
import { decode } from './morse/decode.js'
import { grade } from './morse/grade.js'
import { isMark } from './morse/timing.js'

const MODE_STORAGE_KEY = 'morse-club:input-mode'
const AUTO_FINISH_DELAY_MS = 260

function readStoredMode() {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'pad' ? 'pad' : 'key'
  } catch {
    return 'key'
  }
}

export default function App() {
  const [passageIndex, setPassageIndex] = useState(0)
  const [mode, setMode] = useState(readStoredMode)
  const [modal, setModal] = useState(null) // null | 'results' | 'passages'
  const [result, setResult] = useState(null)
  const input = useMorseInput()

  const passage = passages[passageIndex]
  const target = useMemo(() => normalize(passage.text), [passage.text])
  const targetLetters = target.replaceAll(' ', '').length

  // Only letters whose closing gap has arrived count as sent.
  const { symbols } = input
  const pendingMarks = symbols.length - symbols.findLastIndex(symbol => !isMark(symbol)) - 1
  const sentSoFar = useMemo(() => decode(symbols.slice(0, symbols.length - pendingMarks)), [symbols, pendingMarks])
  const lettersSent = sentSoFar.replaceAll(' ', '').length

  useEffect(() => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode)
    } catch {
      // Storage unavailable (private mode, blocked): the choice just won't persist.
    }
  }, [mode])

  function finish() {
    const run = input.finish()
    if (run.symbols.length === 0) return
    const sent = decode(run.symbols)
    const elapsedMs = run.endedAt - run.startedAt
    setResult({ ...grade({ target, sent, elapsedMs }), sent, elapsedMs, mode })
    setModal('results')
  }

  const autoFinish = useEffectEvent(finish)
  const holding = input.isKeyDown || input.isPadDown
  const complete = !result && !holding && pendingMarks === 0 && lettersSent > 0 && lettersSent >= targetLetters
  useEffect(() => {
    if (!complete) return
    const timer = setTimeout(() => autoFinish(), AUTO_FINISH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [complete, lettersSent])

  function startOver() {
    input.reset()
    setResult(null)
  }

  // Keying again after a finished run starts a fresh one on the same passage.
  function resumeIfFinished() {
    if (result) startOver()
  }

  function pickPassage(index) {
    setPassageIndex(index)
    startOver()
    setModal(null)
  }

  function changeMode(next) {
    if (next === mode) return
    input.cancel()
    setMode(next)
  }

  const keyboardEnabled = modal === null
  const percent = result ? Math.round(result.accuracy * 100) : null

  let pipLine = 'Ready when you are.'
  if (percent !== null && percent >= 93) pipLine = 'Textbook. Pip is thrilled.'
  else if (percent !== null && percent >= 85) pipLine = 'Nice hand!'
  else if (!result && symbols.length > 0) pipLine = 'Keep it coming.'

  let lampLabel = 'idle'
  if (input.isKeyDown) lampLabel = input.dashFormed ? 'sending — dash forming' : 'sending — dot forming'
  else if (input.isPadDown) lampLabel = 'mark'

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen overflow-x-hidden bg-paper text-ink">
        <Backdrop />

        <div className="relative z-1 mx-auto flex w-full max-w-[1120px] flex-col gap-[18px] px-4 pb-10 pt-5 sm:px-10 sm:pb-[66px] sm:pt-12">
          <header className="flex flex-wrap items-center gap-3">
            <div className="mr-auto flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="grid size-10 -rotate-4 place-items-center rounded-logo bg-primary text-[17px] font-extrabold text-on-primary shadow-button"
              >
                ··
              </span>
              <h1 className="text-[24px] font-extrabold leading-none tracking-[-.01em]">Morse Club</h1>
            </div>
            <button
              type="button"
              onClick={() => setModal('passages')}
              className="flex items-center gap-2 rounded-full bg-secondary px-4 py-[9px] text-[13.5px] font-bold text-on-secondary shadow-button active:translate-y-1 active:shadow-none"
            >
              <span className="text-[11px] tracking-[.1em] opacity-75">NO. {passageIndex + 1}</span>
              <span>{passage.title}</span>
            </button>
          </header>

          <main className="flex flex-col gap-[18px]">
            <div className="flex min-w-0 flex-col gap-3.5">
              <PassageDisplay passage={passage} lettersSent={lettersSent} />
              <RunStats
                startedAt={input.startedAt}
                result={result}
                lettersSent={lettersSent}
                targetLetters={targetLetters}
                charsSent={sentSoFar.length}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-3.5">
              <TransmissionStrip symbols={symbols} />

              <div className="flex flex-col items-center gap-3.5 rounded-card border-2 border-edge bg-card px-[18px] pb-5 pt-[18px] shadow-card">
                <InputModeToggle mode={mode} onChange={changeMode} />
                <Lamp on={holding} label={lampLabel} />

                {mode === 'key' ? (
                  <StraightKey
                    isDown={input.isKeyDown}
                    dashFormed={input.dashFormed}
                    keyboardEnabled={keyboardEnabled}
                    onPress={at => {
                      resumeIfFinished()
                      input.pressKey(at)
                    }}
                    onRelease={input.releaseKey}
                    onCancel={input.cancel}
                  />
                ) : (
                  <DotDashPad
                    keyboardEnabled={keyboardEnabled}
                    onPress={(symbol, at) => {
                      resumeIfFinished()
                      input.pressPad(symbol, at)
                    }}
                    onRelease={input.releasePad}
                    onWordBreak={input.breakWord}
                    onCancel={input.cancel}
                  />
                )}

                <div className="flex w-full flex-wrap justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={finish}
                    disabled={symbols.length === 0 || result !== null}
                    className="flex-[1_1_130px] rounded-full bg-accent px-5 py-[13px] text-[15px] font-extrabold text-on-accent shadow-button active:translate-y-[5px] active:shadow-none"
                  >
                    Send it
                  </button>
                  <button
                    type="button"
                    onClick={startOver}
                    className="rounded-full border-2 border-edge bg-transparent px-[18px] py-[13px] text-[14px] font-bold text-ink-soft active:translate-y-[3px]"
                  >
                    Start over
                  </button>
                </div>
              </div>

              <div className="flex items-end gap-3 px-1">
                <Pip />
                <p
                  aria-live="polite"
                  className="rounded-bubble rounded-bl-mark border-2 border-edge bg-card px-3.5 py-2.5 text-[13.5px] font-semibold text-ink shadow-card"
                >
                  {pipLine}
                </p>
              </div>
            </div>
          </main>

          <p className="text-center text-[11.5px] font-medium tracking-[.02em] text-ink-soft pointer-coarse:hidden">
            {mode === 'key' ? 'Keyboard: hold space for the key' : 'Keyboard: . for dot, - for dash, space between words'}
          </p>
        </div>

        <ResultsModal
          open={modal === 'results'}
          onClose={() => setModal(null)}
          result={result}
          passage={passage}
          passageNumber={passageIndex + 1}
          onNext={() => pickPassage((passageIndex + 1) % passages.length)}
          onRetry={() => pickPassage(passageIndex)}
        />
        <PassagePickerModal
          open={modal === 'passages'}
          onClose={() => setModal(null)}
          passages={passages}
          currentIndex={passageIndex}
          onPick={pickPassage}
        />
      </div>
    </MotionConfig>
  )
}

function RunStats({ startedAt, result, lettersSent, targetLetters, charsSent }) {
  const running = startedAt !== null && result === null
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (!running) return
    const tick = () => setNow(performance.now())
    tick()
    const interval = setInterval(tick, 100)
    return () => clearInterval(interval)
  }, [running])

  const elapsedMs = result ? result.elapsedMs : running ? Math.max(0, now - startedAt) : 0
  const liveWpm = elapsedMs > 1200 ? charsSent / 5 / (elapsedMs / 60_000) : 0
  const wpm = Math.round(result ? result.wpm : liveWpm)
  const progress = Math.min(100, Math.round((100 * lettersSent) / Math.max(1, targetLetters)))

  return (
    <div className="flex flex-wrap gap-2.5">
      <Stat label="Time" value={formatClock(elapsedMs)} />
      <Stat label="Pace" value={`${wpm} wpm`} />
      <div className="flex-[2_1_200px] rounded-tile border-2 border-edge bg-card px-3.5 py-[11px] shadow-card">
        <div className="eyebrow flex justify-between">
          <span>Sent</span>
          <span>
            {lettersSent} / {targetLetters}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Letters sent"
          aria-valuemin={0}
          aria-valuemax={targetLetters}
          aria-valuenow={Math.min(lettersSent, targetLetters)}
          className="mt-[7px] h-3 overflow-hidden rounded-full bg-paper-2"
        >
          <div className="h-full rounded-full bg-secondary transition-[width] duration-250 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex-[1_1_120px] rounded-tile border-2 border-edge bg-card px-3.5 py-[11px] shadow-card">
      <div className="eyebrow">{label}</div>
      <div className="text-[21px] font-extrabold leading-[1.2] tabular-nums">{value}</div>
    </div>
  )
}

function Lamp({ on, label }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`block size-[22px] rounded-full transition-[background-color,box-shadow] duration-80 ${
          on ? 'bg-accent shadow-lamp-on' : 'bg-paper-2 shadow-lamp-off'
        }`}
      />
      <span className="text-[11px] font-bold uppercase tracking-[.12em] text-ink-soft">{label}</span>
    </div>
  )
}

// Slow-drifting confetti dots behind the app.
const DRIFTERS = [
  { color: 'bg-primary', alt: false, style: { top: '12%', left: '6%', width: 26, height: 26, opacity: 0.28 }, duration: 17 },
  { color: 'bg-secondary', alt: true, style: { top: '26%', left: '16%', width: 74, height: 24, opacity: 0.2 }, duration: 23 },
  { color: 'bg-accent', alt: false, style: { top: '64%', left: '9%', width: 18, height: 18, opacity: 0.3 }, duration: 19, delay: 2 },
  { color: 'bg-primary', alt: true, style: { top: '78%', left: '22%', width: 58, height: 20, opacity: 0.22 }, duration: 27, delay: 1 },
  { color: 'bg-accent', alt: false, style: { top: '16%', right: '8%', width: 90, height: 28, opacity: 0.18 }, duration: 25 },
  { color: 'bg-secondary', alt: true, style: { top: '40%', right: '15%', width: 22, height: 22, opacity: 0.3 }, duration: 21, delay: 3 },
  { color: 'bg-primary', alt: false, style: { top: '58%', right: '6%', width: 34, height: 34, opacity: 0.22 }, duration: 29, delay: 1.5 },
  { color: 'bg-secondary', alt: true, style: { top: '86%', right: '20%', width: 66, height: 22, opacity: 0.2 }, duration: 24, delay: 2.5 },
  { color: 'bg-accent', alt: false, style: { top: '4%', left: '44%', width: 16, height: 16, opacity: 0.25 }, duration: 31 },
  { color: 'bg-primary', alt: true, style: { bottom: '3%', left: '52%', width: 48, height: 18, opacity: 0.2 }, duration: 33, delay: 4 },
]

function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {DRIFTERS.map(({ color, alt, style, duration, delay = 0 }, i) => (
        <div
          key={i}
          className={`absolute rounded-full motion-reduce:animate-none ${color} ${alt ? 'animate-drift-alt' : 'animate-drift'}`}
          style={{ ...style, animationDuration: `${duration}s`, animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  )
}
