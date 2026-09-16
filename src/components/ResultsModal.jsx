import { useId } from 'react'
import { INPUT_MODES } from '../hooks/useMorseInput.js'
import { formatClock } from '../lib/format.js'
import { Confetti, Stamp } from './Celebration.jsx'
import Modal from './Modal.jsx'

// Keyed on rounded accuracy percentage, best first.
const RATINGS = [
  { min: 98, grade: 'A+', headline: 'Clean signal.', stamp: 'bg-secondary text-on-secondary' },
  { min: 93, grade: 'A', headline: 'Barely a crackle.', stamp: 'bg-secondary text-on-secondary' },
  { min: 85, grade: 'B', headline: 'Readable, mostly.', stamp: 'bg-primary text-on-primary' },
  { min: 75, grade: 'C', headline: 'Static on the line.', stamp: 'bg-accent text-on-accent' },
  { min: 0, grade: 'D', headline: 'The wire got confused.', stamp: 'bg-accent text-on-accent' },
]

const CONFETTI_FROM = 85

// Styles for each alignment op from grade(): matched characters stay plain.
const CELL_STYLES = {
  match: 'bg-card',
  substitute: 'bg-accent text-on-accent',
  insert: 'bg-secondary text-on-secondary',
  delete: 'border-2 border-dashed border-ink-soft',
}

/**
 * `result` carries a snapshot of the passage it was sent against, so the modal
 * stays correct even if the board changes underneath it (tier advancement).
 */
export default function ResultsModal({ open, onClose, result, onNext, onRetry }) {
  const titleId = useId()

  return (
    <Modal open={open} onClose={onClose} width={720} labelledBy={titleId}>
      {result && (
        <Results titleId={titleId} result={result} onNext={onNext} onRetry={onRetry} />
      )}
    </Modal>
  )
}

function Results({ titleId, result, onNext, onRetry }) {
  const { passage, passageNumber, advancedToTier } = result
  const percent = Math.round(result.accuracy)
  const rating = RATINGS.find(r => percent >= r.min)
  const { counts } = result
  const anomalies = result.anomalies ?? []
  const tooShort = anomalies.filter(anomaly => anomaly.type === 'bounce').length
  const repeats = anomalies.filter(anomaly => anomaly.type === 'hold-repeat').length
  const stalls = anomalies.filter(anomaly => anomaly.type === 'keyer-stall').length

  return (
    <div className="flex flex-col gap-[18px]">
      {percent >= CONFETTI_FROM && <Confetti />}

      <div className="relative z-2 flex flex-wrap items-start gap-[18px]">
        <div className="min-w-0 flex-[1_1_240px]">
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-ink-soft">Transmission complete</div>
          <h2 id={titleId} className="mt-1.5 text-[32px] font-extrabold leading-[1.05]">
            {rating.headline}
          </h2>
          <p className="mt-2 text-[14.5px] font-medium leading-[1.45] text-ink-soft">
            Passage {passageNumber} · {passage.title} · {keyingLabel(result)} · {result.anchored ? 'Anchored' : 'Unanchored'}
          </p>
        </div>
        <Stamp value={rating.grade} label="GRADE" className={rating.stamp} />
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Anchored, letter breaks come from the passage: the score is of each letter's dots and dashes. */}
        <BigStat label={result.anchored ? 'Symbol accuracy' : 'Accuracy'} value={`${percent}%`} />
        {/* The iambic keyer's speed is chosen, not earned, so it is never reported as the operator's. */}
        {result.keyerMode === 'iambic' ? (
          <BigStat label="Iambic keyer" value={`${result.keyerWpm} WPM`} />
        ) : (
          <>
            <BigStat label="Words / min" value={Math.round(result.wpm)} />
            <BigStat label="Effective wpm" value={Math.round(result.effectiveWpm)} />
          </>
        )}
        <BigStat label="Time" value={formatClock(result.elapsedMs)} />
      </div>
      <p className="-mt-2.5 text-[12.5px] font-semibold text-ink-soft">
        Paused {formatClock(result.pausedMs ?? 0)}, not counted in your time.
        {result.scrubbedLetters > 0 && ` ${scrubbedNote(result)}`}
      </p>
      {/* What the input did that the operator couldn't see: presses too short to count (graded as missing),
          iambic holds that sent repeats, and the keyer stopping because the device fell behind. Said plainly, so
          the grade doesn't read as the app misreading them. */}
      {(tooShort > 0 || repeats > 0 || stalls > 0) && (
        <p className="-mt-2.5 rounded-box border-2 border-dashed border-edge px-3.5 py-2.5 text-[13px] font-semibold text-ink">
          {tooShort > 0 && <span className="block">{tooShortNote(tooShort)}</span>}
          {repeats > 0 && <span className="block">{repeatsNote(repeats)}</span>}
          {stalls > 0 && <span className="block">{stallsNote(stalls)}</span>}
        </p>
      )}

      <div className="rounded-panel border-2 border-edge bg-card px-5 py-[18px]">
        <div className="eyebrow mb-2">What you just sent</div>
        <p className="font-serif text-[19px] leading-[1.45] text-pretty">{passage.text}</p>
        {passage.blurb && (
          <p className="mt-2.5 font-serif text-[13.5px] font-medium leading-normal text-ink-soft">{passage.blurb}</p>
        )}
        <p className="mt-2 text-[12.5px] font-semibold text-ink-soft">
          {passage.title} · {passage.author} · {passage.culture}
          {passage.era && `, ${passage.era}`}
        </p>
      </div>

      <div className="rounded-panel bg-paper-2 px-5 py-[18px]">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <div className="eyebrow mr-auto">Character review</div>
          <Legend swatch="bg-accent">wrong</Legend>
          <Legend swatch="border-2 border-dashed border-ink-soft">missed</Legend>
          <Legend swatch="bg-secondary">extra</Legend>
        </div>
        <p className="sr-only">
          You sent “{result.sent}”: {counts.match} correct, {counts.substitute} wrong, {counts.delete} missed, {counts.insert}{' '}
          extra.
        </p>
        {/* Words of the passage, so the review reads naturally; spaces themselves are never scored. */}
        <div aria-hidden="true" className="flex flex-wrap gap-x-3 gap-y-1">
          {result.review.map((word, w) => (
            <span key={w} className="flex flex-wrap gap-1">
              {word.map((cell, i) => (
                <span
                  key={i}
                  title={cellTitle(cell)}
                  className={`flex min-w-[19px] flex-col items-center gap-[2px] rounded-chip px-[3px] py-[5px] ${CELL_STYLES[cell.op]}`}
                >
                  <span className="font-serif text-[17px] leading-none">{cell.expected ?? '·'}</span>
                  <span className="font-mono text-[10.5px] font-medium leading-none opacity-80">{cell.actual ?? '—'}</span>
                </span>
              ))}
            </span>
          ))}
        </div>
        <div className="mt-2.5 text-[12px] font-medium text-ink-soft">
          Top row: the passage. Bottom row: what came down the wire.
          {result.anchored && ' Letter breaks follow the passage, so this checks each letter’s dots and dashes, not your spacing.'}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={onNext}
          className="rounded-full bg-secondary px-[22px] py-[14px] text-[15px] font-bold text-on-secondary shadow-button active:translate-y-[5px] active:shadow-none"
        >
          {advancedToTier ? `On to tier ${advancedToTier}` : 'Next passage'}
        </button>
        {/* After a tier-up this passage has left the board, so there's nothing to retry. */}
        {!advancedToTier && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border-2 border-edge bg-transparent px-5 py-[13px] text-[14.5px] font-bold text-ink"
          >
            Send it again
          </button>
        )}
      </div>
    </div>
  )
}

// How the run was keyed, for its subtitle: "Iambic, 20 WPM" rather than a measured speed.
function keyingLabel({ mode, keyerMode, keyerWpm }) {
  return keyerMode === 'iambic' ? `Iambic, ${keyerWpm} WPM` : INPUT_MODES[mode]
}

function scrubbedNote({ scrubbedLetters, prosign }) {
  const letters = scrubbedLetters === 1 ? '1 letter' : `${scrubbedLetters} letters`
  return prosign === 'deletion'
    ? `${letters} disregarded with the error prosign, counted as missed at this tier.`
    : `${letters} disregarded with the error prosign, not counted.`
}

function tooShortNote(count) {
  return count === 1
    ? '1 press was too short to register, so it isn’t in what came down the wire.'
    : `${count} presses were too short to register, so they aren’t in what came down the wire.`
}

function repeatsNote(count) {
  return count === 1
    ? '1 hold sent more than one element — tap once per dot or dash.'
    : `${count} holds sent more than one element — tap once per dot or dash.`
}

function stallsNote(count) {
  const times = count === 1 ? 'once' : `${count} times`
  return `This device fell behind ${times}, so the keyer stopped instead of guessing: a held paddle may have sent fewer elements than you held it for.`
}

function BigStat({ label, value }) {
  return (
    <div className="flex-[1_1_130px] rounded-box bg-paper-2 px-4 py-3.5">
      <div className="eyebrow">{label}</div>
      <div className="text-[30px] font-extrabold leading-[1.1] tabular-nums">{value}</div>
    </div>
  )
}

function Legend({ swatch, children }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-soft">
      <span className={`size-3 rounded-[4px] ${swatch}`} />
      {children}
    </span>
  )
}

function cellTitle({ op, expected, actual }) {
  const show = char => (char === ' ' ? 'space' : char)
  if (op === 'delete') return `missed ${show(expected)}`
  if (op === 'insert') return `extra ${show(actual)}`
  if (op === 'substitute') return `expected ${show(expected)}, sent ${show(actual)}`
  return show(expected)
}
