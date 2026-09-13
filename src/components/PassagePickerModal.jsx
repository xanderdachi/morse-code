import { useId } from 'react'
import { BOARD_SIZE } from '../lib/passages.js'
import Modal from './Modal.jsx'

export default function PassagePickerModal({ open, onClose, passages, loading, currentId, isCleared, onPick }) {
  const titleId = useId()

  return (
    <Modal open={open} onClose={onClose} width={700} labelledBy={titleId}>
      <div className="flex flex-col gap-[18px]">
        <div>
          <h2 id={titleId} className="text-[28px] font-extrabold leading-[1.1]">
            Pick your passage
          </h2>
          <p className="mt-2 text-[14.5px] font-medium leading-[1.45] text-ink-soft">Passages get longer, not louder.</p>
        </div>
        <ul aria-busy={loading} className="flex flex-wrap items-start justify-center gap-3.5">
          {loading
            ? Array.from({ length: BOARD_SIZE }, (_, i) => <SkeletonSlot key={i} index={i} />)
            : passages.map((passage, i) => {
                const current = passage.id === currentId
                const cleared = isCleared(passage.id)
                return (
                  <li key={passage.id} className={slotClass(i)}>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => onPick(passage.id)}
                        aria-current={current || undefined}
                        aria-label={`Passage ${i + 1}: ${passage.title}, ${passage.author}${cleared ? ', cleared' : ''}`}
                        className={`flex size-[86px] flex-col items-center justify-center gap-[2px] rounded-full shadow-button active:translate-y-[5px] active:shadow-none ${
                          current ? 'bg-primary text-on-primary' : 'bg-secondary text-on-secondary'
                        } ${cleared ? 'opacity-50' : ''}`}
                      >
                        <span className="text-[26px] font-extrabold leading-none">{i + 1}</span>
                        <span className="max-w-[70px] text-center text-[10px] font-bold uppercase leading-[1.1] tracking-[.08em] opacity-85">
                          {passage.culture}
                        </span>
                      </button>
                      {cleared && <ClearedCheck />}
                    </div>
                    <div className="max-w-[140px] text-center">
                      <div className="text-[14px] font-bold">{passage.title}</div>
                      <div className="text-[12px] font-medium leading-[1.35] text-ink-soft">{passage.author}</div>
                    </div>
                  </li>
                )
              })}
        </ul>
      </div>
    </Modal>
  )
}

const slotClass = i => `flex w-[150px] flex-none flex-col items-center gap-[9px] ${i % 2 ? 'mt-[34px]' : ''}`

function ClearedCheck() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -right-1 -top-1 grid size-[30px] place-items-center rounded-full border-2 border-edge bg-card text-secondary"
    >
      <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    </span>
  )
}

function SkeletonSlot({ index }) {
  return (
    <li aria-hidden="true" className={slotClass(index)}>
      <span className="block size-[86px] rounded-full bg-paper-2 motion-safe:animate-pulse" />
      <div className="flex flex-col items-center gap-1.5">
        <span className="block h-3.5 w-24 rounded-full bg-paper-2 motion-safe:animate-pulse" />
        <span className="block h-3 w-16 rounded-full bg-paper-2 motion-safe:animate-pulse" />
      </div>
    </li>
  )
}
