import { MotionConfig } from 'framer-motion'
import { memo, useEffect, useEffectEvent, useRef, useState } from 'react'
import CalibrationModal from './components/CalibrationModal.jsx'
import DotDashPad from './components/DotDashPad.jsx'
import InputModeToggle from './components/InputModeToggle.jsx'
import LoadingScreen from './components/LoadingScreen.jsx'
import OnboardingModal from './components/OnboardingModal.jsx'
import PassageDisplay from './components/PassageDisplay.jsx'
import PassagePickerModal from './components/PassagePickerModal.jsx'
import Pip from './components/Pip.jsx'
import ResultsModal from './components/ResultsModal.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import StraightKey from './components/StraightKey.jsx'
import TierUpModal from './components/TierUpModal.jsx'
import TouchKeys from './components/TouchKeys.jsx'
import TransmissionStrip from './components/TransmissionStrip.jsx'
import { useCoarsePointer } from './hooks/useCoarsePointer.js'
import { useDockRoom } from './hooks/useDockRoom.js'
import { useMorseInput } from './hooks/useMorseInput.js'
import { useWakeLock } from './hooks/useWakeLock.js'
import { formatClock } from './lib/format.js'
import { loadBoard } from './lib/passages.js'
import {
  boardIdsFor,
  canUndo,
  isAnchored,
  isCleared,
  leniencyFor,
  loadProgress,
  markOnboardingSeen,
  recordRun,
  saveProgress,
  setAnchoredInput,
  setBoardIds,
  setCalibration,
  setInputMode,
  setKeyerMode,
  setKeyerWpm,
  setSidetone,
  setTouchControls,
  sidetoneOn,
  tierStatus,
  usesIambic,
  usesTouchControls,
} from './lib/progress.js'
import { scoreRun } from './lib/results.js'
import { clearRuns, loadRuns, runDumpEnabled, saveRun, startEventTrace } from './lib/runDump.js'
import { unitMsForWpm, wordsPerMinute } from './morse/units.js'

// The Finish control appears once this few letters of the passage remain.
const FINISH_CONTROL_WITHIN = 3

// However the first load goes, the loading screen hands over by this point: a
// hung fetch must not trap anyone behind it.
const LOADING_TIMEOUT_MS = 10_000

export default function App() {
  const [progress, setProgress] = useState(loadProgress)
  const [board, setBoard] = useState({ tier: null, passages: [], offline: false })
  // ?dump: keep each run's keystroke log on this device for real-device testing (lib/runDump.js).
  const [dumping] = useState(() => runDumpEnabled())
  const [dumpedRuns, setDumpedRuns] = useState(() => (dumping ? loadRuns().length : 0))
  const traceRef = useRef(null)
  // Presses of . or - on the straight key, which ignores them, since the last press that counted.
  const [ignoredPadKeys, setIgnoredPadKeys] = useState(0)
  const [passageId, setPassageId] = useState(null)
  // null | 'intro' | 'results' | 'passages' | 'tier-up' | 'complete' | 'settings' | 'calibrate'
  const [modal, setModal] = useState(progress.onboardingSeen ? null : 'intro')
  const [result, setResult] = useState(null)
  // The loading screen covers the first paint and, once handed over, is gone
  // for the session: not on a tier change, not between passages.
  const [loaded, setLoaded] = useState(false)
  const screenRef = useRef(null)
  const dockRef = useRef(null)
  const passageRef = useRef(null)

  const coarsePointer = useCoarsePointer()
  const touch = usesTouchControls(progress, coarsePointer)
  const sidetone = sidetoneOn(progress, touch)
  const mode = progress.inputMode
  const iambic = usesIambic(progress)
  const { errorGapUnits } = leniencyFor(progress.tier)
  const anchored = isAnchored(progress)
  const undoAllowed = anchored && canUndo(progress)
  const boardLoading = board.tier !== progress.tier
  const firstScreenReady = useFirstScreenReady(boardLoading)
  const passageIndex = board.passages.findIndex(p => p.id === passageId)
  const passage = board.passages[passageIndex] ?? null
  const target = passage?.textMorseSafe ?? ''
  const targetLetters = target.replaceAll(' ', '').length
  const status = tierStatus(progress, board.passages)

  const input = useMorseInput({
    mode,
    target,
    errorGapUnits,
    anchored,
    // The iambic keyer's elements are exactly its own unit long.
    unitMs: iambic ? unitMsForWpm(progress.keyerWpm) : progress.unitMs,
    keyerMode: progress.keyerMode,
    keyerWpm: progress.keyerWpm,
    enabled: modal === null,
    undoEnabled: undoAllowed && result === null,
    sidetone,
    haptics: true,
    beforePress: () => {
      if (!passage) return false
      setIgnoredPadKeys(0)
      resumeIfFinished()
    },
    onIgnoredKey: () => setIgnoredPadKeys(count => count + 1),
    onFinalize: run => gradeRun(run),
  })
  const { lettersSent } = input

  // Load the board whenever the tier changes, reusing the passages chosen on
  // the first visit to this tier. Keep the current passage if it's still on the
  // board; otherwise start on the first one not yet cleared.
  const rememberedBoard = useEffectEvent(tier => boardIdsFor(progress, tier))
  const showBoard = useEffectEvent((tier, { passages, offline, ids }) => {
    setBoard({ tier, passages, offline })
    const stored = boardIdsFor(progress, tier)
    if (ids && (!stored || ids.join() !== stored.join())) commitProgress(setBoardIds(progress, tier, ids))
    if (!passages.some(p => p.id === passageId)) {
      setPassageId((passages.find(p => !isCleared(progress, p.id)) ?? passages[0]).id)
      input.reset()
    }
  })

  useEffect(() => {
    let cancelled = false
    loadBoard(progress.tier, rememberedBoard(progress.tier)).then(loaded => {
      if (!cancelled) showBoard(progress.tier, loaded)
    })
    return () => {
      cancelled = true
    }
  }, [progress.tier])

  function commitProgress(next) {
    setProgress(saveProgress(next))
  }

  // Grade a run once it is finalized, however it ended: the settle silence, a
  // long pause, or the Finish control. Input is already discarded by then.
  function gradeRun(run) {
    if (!passage || result) return
    if (run.letters.length === 0) {
      if (dumping) dumpRun(run, null)
      startOver()
      return
    }
    const graded = scoreRun({ run, target, progress, mode, keyerMode: progress.keyerMode, keyerWpm: progress.keyerWpm })
    if (dumping) dumpRun(run, graded)
    const outcome = recordRun(progress, {
      passageId: passage.id,
      accuracy: Math.round(graded.accuracy),
      board: board.passages,
    })
    commitProgress(outcome.progress)
    setResult({
      ...graded,
      // The raw keystroke log, for replaying the decode or verifying a score later. Not sent anywhere.
      log: run.log,
      anomalies: run.anomalies,
      passage,
      passageNumber: passageIndex + 1,
      advancedToTier: outcome.advanced ? outcome.progress.tier : null,
      completedAllTiers: outcome.completed,
    })
    setModal('results')
  }

  function dumpRun(run, graded) {
    const kept = saveRun({
      endedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      passageId: passage.id,
      target,
      tier: progress.tier,
      mode,
      keyerMode: iambic ? 'iambic' : 'manual',
      keyerWpm: iambic ? progress.keyerWpm : null,
      touchControls: touch,
      anchored,
      unitMs: progress.unitMs,
      sent: run.text,
      accuracy: graded ? Math.round(graded.accuracy) : null,
      finishReason: run.finishReason,
      anomalies: run.anomalies,
      log: run.log,
      // The raw events from 2 s before the first press, each stamped and seen: the log's times are the stamps.
      events: traceRef.current?.since((run.log[0]?.t ?? 0) - 2000) ?? [],
    })
    setDumpedRuns(kept ?? -1)
  }

  // A pointer click never leaves focus on a control outside a dialog, where a stray Enter or Space would press
  // it again (Start over wiping a run). Keyboard activation (detail 0) keeps focus where the keyboard put it.
  useEffect(() => {
    const release = event => {
      if (event.detail === 0 || !(event.target instanceof Element)) return
      const control = event.target.closest('button, [role="button"]')
      if (control && !control.closest('[role="dialog"]')) control.blur()
    }
    document.addEventListener('click', release, true)
    return () => document.removeEventListener('click', release, true)
  }, [])

  useEffect(() => {
    if (!dumping) return
    const trace = startEventTrace()
    traceRef.current = trace
    return () => {
      trace.stop()
      traceRef.current = null
    }
  }, [dumping])

  const holding = input.isKeyDown || input.padsDown['.'] || input.padsDown['-']
  // Near the end, or with as many letters sent as the passage has.
  const showFinish =
    passage !== null && result === null && (input.remaining <= FINISH_CONTROL_WITHIN || input.lettersSent >= targetLetters)
  // From the first press until the run is graded.
  const runActive = result === null && (input.startedAt !== null || holding)

  useWakeLock(runActive)
  useDockRoom({ enabled: touch, screenRef, dockRef, passageRef, layout: mode })

  // The intro can't be opened during a run (Settings disables it), and never renders over one regardless.
  const introOpen = modal === 'intro' && !runActive

  function closeIntro() {
    commitProgress(markOnboardingSeen(progress))
    setModal(null)
  }

  function startOver() {
    input.reset()
    setResult(null)
  }

  // Keying again after a finished run starts a fresh one on the same passage.
  function resumeIfFinished() {
    if (result) startOver()
  }

  function pickPassage(id) {
    setPassageId(id)
    startOver()
    setModal(null)
  }

  // The next passage after the current one that isn't cleared yet, wrapping.
  function nextPassageId() {
    const list = board.passages
    for (let step = 1; step <= list.length; step++) {
      const candidate = list[(passageIndex + step) % list.length]
      if (!isCleared(progress, candidate.id)) return candidate.id
    }
    return list[(passageIndex + 1) % list.length].id
  }

  function leaveResults() {
    setModal(result?.advancedToTier ? 'tier-up' : result?.completedAllTiers ? 'complete' : null)
  }

  function changeMode(next) {
    setIgnoredPadKeys(0)
    if (next !== mode) commitProgress(setInputMode(progress, next))
  }

  function changeAnchoring(next) {
    startOver()
    commitProgress(setAnchoredInput(progress, next))
  }

  function changeKeyerMode(next) {
    if (next !== progress.keyerMode) commitProgress(setKeyerMode(progress, next))
  }

  function changeTouchControls(next) {
    if (next !== progress.touchControls) commitProgress(setTouchControls(progress, next))
  }

  const percent = result ? Math.round(result.accuracy) : null

  let pipLine = 'Ready when you are.'
  if (percent !== null && percent >= 93) pipLine = 'Textbook. Pip is thrilled.'
  else if (percent !== null && percent >= 85) pipLine = 'Nice hand!'
  // Two presses of . or - on the straight key, which silently ignores them: say where they do work.
  else if (!result && mode === 'key' && ignoredPadKeys >= 2) pipLine = 'The . and - keys work in pad mode. On the straight key, hold Space.'
  // Undo shows what it removed, so mashing it reads as deleting rather than nothing happening.
  else if (!result && input.tookBack !== null) pipLine = <TookBack symbols={input.tookBack} />
  // The error prosign is good operating, so it gets a calm nod, never an alarm.
  else if (!result && input.prosignHeard) pipLine = 'Disregarded. Carry on from there.'
  else if (!result && input.paused) pipLine = 'Take your time.'
  else if (!result && input.strip.length > 0) pipLine = 'Keep it coming.'

  let lampLabel = 'idle'
  if (input.isKeyDown) lampLabel = input.dashFormed ? 'sending — dash forming' : 'sending — dot forming'
  else if (holding) lampLabel = 'mark'
  else if (!result && input.paused) lampLabel = 'paused'

  return (
    <MotionConfig reducedMotion="user">
      {!loaded && <LoadingScreen ready={firstScreenReady} onDone={() => setLoaded(true)} />}

      {/* With touch controls the practice screen is its own scroller, so nothing chains to the page or pulls to refresh. */}
      <div
        ref={screenRef}
        className={
          touch
            ? 'fixed inset-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-paper text-ink'
            : 'relative min-h-screen overflow-x-hidden bg-paper text-ink'
        }
      >
        <Backdrop />

        <div
          className={`relative z-1 mx-auto flex w-full max-w-[1120px] flex-col gap-[18px] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(2.5rem,env(safe-area-inset-left))] sm:pr-[max(2.5rem,env(safe-area-inset-right))] ${
            touch
              ? 'pb-[calc(var(--dock-room,0px)+28px)] pt-[calc(env(safe-area-inset-top)+20px)] sm:pt-[calc(env(safe-area-inset-top)+32px)]'
              : 'pb-10 pt-5 sm:pb-[66px] sm:pt-12'
          }`}
        >
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
            <span className="rounded-full bg-paper-2 px-[13px] py-[7px] text-[12px] font-bold text-ink-soft">
              Tier {status.tier} — {status.cleared}/{status.total} cleared
            </span>
            <button
              type="button"
              onClick={() => setModal('settings')}
              className="rounded-full border-2 border-edge bg-card px-[15px] py-[9px] text-[13.5px] font-bold text-ink shadow-card active:translate-y-1 active:shadow-none"
            >
              Setup
            </button>
            <button
              type="button"
              onClick={() => setModal('passages')}
              className="flex items-center gap-2 rounded-full bg-secondary px-4 py-[9px] text-[13.5px] font-bold text-on-secondary shadow-button active:translate-y-1 active:shadow-none"
            >
              <span className="text-[11px] tracking-[.1em] opacity-75">NO. {passage ? passageIndex + 1 : '–'}</span>
              <span>{passage?.title ?? 'Loading passages'}</span>
            </button>
          </header>

          <main className="flex flex-col gap-[18px]">
            <div className="flex min-w-0 flex-col gap-3.5">
              <PassageDisplay passage={passage} lettersSent={lettersSent} compact={touch} idle={!runActive} ref={passageRef} />
              <RunStats
                input={input}
                holding={holding}
                result={result}
                targetLetters={targetLetters}
                keyerWpm={iambic ? progress.keyerWpm : null}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-3.5">
              <TransmissionStrip strip={input.strip} lite={touch} />

              <div className="flex flex-col items-center gap-3.5 rounded-card border-2 border-edge bg-card px-[18px] pb-5 pt-[18px] shadow-card">
                <InputModeToggle mode={mode} onChange={changeMode} />
                {iambic && <span className="eyebrow -mt-1.5">Iambic keyer · {progress.keyerWpm} wpm</span>}
                <Lamp on={holding} label={lampLabel} />

                {touch ? (
                  // The keys themselves float at the bottom of the screen.
                  <p className="max-w-[260px] text-center text-[12.5px] font-semibold text-pretty text-ink-soft">
                    {mode === 'key' ? 'Short press makes a dot, long press makes a dash.' : 'Dot on the left, dash on the right.'}
                  </p>
                ) : mode === 'key' ? (
                  <StraightKey isDown={input.isKeyDown} dashFormed={input.dashFormed} keyProps={input.keyProps} />
                ) : (
                  <DotDashPad
                    padsDown={input.padsDown}
                    padProps={input.padProps}
                    letterProps={input.letterProps}
                    pulses={iambic ? input.pulses : null}
                  />
                )}

                <div className="flex w-full flex-wrap justify-center gap-2.5">
                  {/* The Finish control: near the end only. Silence alone always ends a run too. */}
                  {showFinish && (
                    <button
                      type="button"
                      onClick={input.finish}
                      disabled={input.strip.length === 0}
                      className="flex-[1_1_130px] rounded-full bg-accent px-5 py-[13px] text-[15px] font-extrabold text-on-accent shadow-button active:translate-y-[5px] active:shadow-none"
                    >
                      Send it
                    </button>
                  )}
                  {undoAllowed && (
                    <button
                      type="button"
                      onClick={releasingFocus(input.undo)}
                      disabled={input.strip.length === 0 || result !== null}
                      className="rounded-full border-2 border-edge bg-transparent px-[18px] py-[13px] text-[14px] font-bold text-ink-soft active:translate-y-[3px]"
                    >
                      Undo
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={releasingFocus(startOver)}
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

          <div className="flex flex-col items-center gap-1.5">
            {board.offline && (
              <p role="status" className="flex items-center gap-2 text-[11.5px] font-medium tracking-[.02em] text-ink-soft">
                <span aria-hidden="true" className="size-2 rounded-full bg-ink-soft opacity-50" />
                Offline: playing the built-in passages.
              </p>
            )}
            {dumping && (
              <RunDump
                count={dumpedRuns}
                onClear={() => {
                  clearRuns()
                  setDumpedRuns(0)
                }}
              />
            )}
            {!touch && (
              <p className="text-center text-[11.5px] font-medium tracking-[.02em] text-ink-soft">
                {mode === 'key' ? 'Keyboard: hold space for the key' : 'Keyboard: . for dot, - for dash, space to end a letter'}
                {undoAllowed && ', backspace to undo'}
              </p>
            )}
            {/* Last thing on the screen. With touch controls the container's --dock-room padding sits below it, so the floating keys never cover it. */}
            <footer className="text-center text-[11.5px] font-medium tracking-[.02em] text-ink-soft">Created by: Sehel x Claude</footer>
          </div>
        </div>
      </div>

      {touch && (
        <TouchKeys
          docked
          ref={dockRef}
          mode={mode}
          isDown={input.isKeyDown}
          dashFormed={input.dashFormed}
          padsDown={input.padsDown}
          keyProps={input.keyProps}
          padProps={input.padProps}
          letterProps={input.letterProps}
          pulses={iambic ? input.pulses : null}
        />
      )}

      <ResultsModal
        open={modal === 'results'}
        onClose={leaveResults}
        result={result}
        onNext={() => (result?.advancedToTier || result?.completedAllTiers ? leaveResults() : pickPassage(nextPassageId()))}
        onRetry={() => pickPassage(result.passage.id)}
      />
      <TierUpModal
        open={modal === 'tier-up' || modal === 'complete'}
        tier={result?.advancedToTier ?? progress.tier}
        complete={modal === 'complete'}
        onClose={() => {
          startOver()
          setModal(null)
        }}
      />
      <SettingsModal
        open={modal === 'settings'}
        onClose={() => setModal(null)}
        mode={mode}
        onModeChange={changeMode}
        unitMs={progress.unitMs}
        tier={progress.tier}
        anchoredInput={anchored}
        onAnchoredChange={changeAnchoring}
        onCalibrate={() => setModal('calibrate')}
        onClearCalibration={() => commitProgress(setCalibration(progress, null))}
        touchControls={progress.touchControls}
        onTouchControlsChange={changeTouchControls}
        coarsePointer={coarsePointer}
        sidetone={sidetone}
        onSidetoneChange={on => commitProgress(setSidetone(progress, on))}
        onShowIntro={runActive ? null : () => setModal('intro')}
        keyerMode={progress.keyerMode}
        onKeyerModeChange={changeKeyerMode}
        keyerWpm={progress.keyerWpm}
        onKeyerWpmChange={wpm => commitProgress(setKeyerWpm(progress, wpm))}
      />
      <OnboardingModal
        open={introOpen}
        onClose={closeIntro}
        touch={touch}
        mode={mode}
        unitMs={iambic ? unitMsForWpm(progress.keyerWpm) : progress.unitMs}
        errorGapUnits={errorGapUnits}
        keyerMode={progress.keyerMode}
        keyerWpm={progress.keyerWpm}
        sidetone={sidetone}
      />
      <CalibrationModal
        open={modal === 'calibrate'}
        onClose={() => setModal('settings')}
        errorGapUnits={errorGapUnits}
        currentUnitMs={progress.unitMs}
        sidetone={sidetone}
        touch={touch}
        onSave={unitMs => {
          commitProgress(setCalibration(progress, unitMs))
          setModal('settings')
        }}
      />
      <PassagePickerModal
        open={modal === 'passages'}
        onClose={() => setModal(null)}
        passages={board.passages}
        loading={boardLoading}
        currentId={passageId}
        isCleared={id => isCleared(progress, id)}
        onPick={pickPassage}
      />
    </MotionConfig>
  )
}

/**
 * Whether the first screen is worth showing: the board has settled (fetched, or
 * the bundled passages chosen instead) and the fonts are in, so nothing the
 * loader hands over to reflows underneath the player. Nothing optional gates
 * it, and LOADING_TIMEOUT_MS releases it regardless, so a fetch that never
 * answers costs a wait rather than the app.
 */
function useFirstScreenReady(boardLoading) {
  const [fontsReady, setFontsReady] = useState(() => !document.fonts)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const fonts = document.fonts
    if (!fonts) return
    let cancelled = false
    fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const ready = timedOut || (!boardLoading && fontsReady)

  useEffect(() => {
    if (ready) return
    const timer = setTimeout(() => setTimedOut(true), LOADING_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [ready])

  return ready
}

// Undo and Start over let go of focus once clicked, so Enter (or a stray Space elsewhere) can't press them again.
function releasingFocus(action) {
  return event => {
    event.currentTarget.blur()
    action()
  }
}

// ?dump: the runs kept on this device, as JSON to copy or download. `count` is -1 when the last save failed.
function RunDump({ count, onClear }) {
  const [note, setNote] = useState(null)
  const json = () => JSON.stringify(loadRuns())

  async function copy() {
    try {
      await navigator.clipboard.writeText(json())
      setNote('Copied.')
    } catch {
      setNote('Copy blocked here: use Download.')
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([json()], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `morse-club-runs-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const button = 'rounded-full border-2 border-edge px-3 py-1 font-bold text-ink-soft active:translate-y-[2px]'
  return (
    <div role="group" aria-label="Run dump" className="flex flex-wrap items-center justify-center gap-2 text-[11.5px] font-semibold text-ink-soft">
      <span>{count < 0 ? 'Run dump: last run not saved (storage full?)' : `Run dump: ${count} saved`}</span>
      <button type="button" className={button} onClick={releasingFocus(copy)}>
        Copy
      </button>
      <button type="button" className={button} onClick={releasingFocus(download)}>
        Download
      </button>
      <button
        type="button"
        className={button}
        onClick={releasingFocus(() => {
          onClear()
          setNote(null)
        })}
      >
        Clear
      </button>
      {note && <span aria-live="polite">{note}</span>}
    </div>
  )
}

// What an undo just removed, as the marks that were keyed: decoded letters never show during a run.
function TookBack({ symbols }) {
  if (!symbols) return 'Nothing left to take back.'
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      Took back
      <span aria-hidden="true" className="inline-flex items-center gap-[3px]">
        {[...symbols].map((symbol, i) => (
          <span key={i} className={`block h-2 rounded-full ${symbol === '.' ? 'w-2 bg-primary' : 'w-4 bg-secondary'}`} />
        ))}
      </span>
      <span className="sr-only">{[...symbols].map(symbol => (symbol === '.' ? 'dot' : 'dash')).join(' ')}</span>
    </span>
  )
}

// `keyerWpm` is set for the iambic keyer, whose speed is chosen in settings rather than measured from the operator.
function RunStats({ input, holding, result, targetLetters, keyerWpm }) {
  const { startedAt, lastEnd, pausedMs, pauseAfterMs, lettersSent, letterUnits } = input
  const running = startedAt !== null && result === null
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (!running) return
    const tick = () => setNow(performance.now())
    tick()
    const interval = setInterval(tick, 100)
    return () => clearInterval(interval)
  }, [running])

  // The clock stops once a silence passes the pause threshold, and never runs backwards.
  const pausingNow = running && !holding && lastEnd !== null ? Math.max(0, now - lastEnd - pauseAfterMs) : 0
  const elapsedMs = result ? result.elapsedMs : running ? Math.max(0, now - startedAt - pausedMs - pausingNow) : 0
  const liveWpm = elapsedMs > 1200 ? wordsPerMinute(letterUnits, elapsedMs) : 0
  const wpm = Math.round(result ? result.wpm : liveWpm)
  const sent = Math.min(lettersSent, targetLetters)
  const progress = Math.min(100, Math.round((100 * sent) / Math.max(1, targetLetters)))

  return (
    <div className="flex flex-wrap gap-2.5">
      <Stat label="Time" value={formatClock(elapsedMs)} />
      {result?.keyerMode === 'iambic' || (!result && keyerWpm) ? (
        <Stat label="Keyer" value={`${result?.keyerWpm ?? keyerWpm} wpm`} />
      ) : (
        <Stat label="Pace" value={`${wpm} wpm`} />
      )}
      <div className="flex-[2_1_200px] rounded-tile border-2 border-edge bg-card px-3.5 py-[11px] shadow-card">
        <div className="eyebrow flex justify-between">
          <span>Sent</span>
          <span>
            {sent} / {targetLetters}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Letters sent"
          aria-valuemin={0}
          aria-valuemax={targetLetters}
          aria-valuenow={sent}
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

const Backdrop = memo(function Backdrop() {
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
})
