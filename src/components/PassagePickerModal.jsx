import { useId } from 'react'
import Modal from './Modal.jsx'

export default function PassagePickerModal({ open, onClose, passages, currentIndex, onPick }) {
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
        <ul className="flex flex-wrap items-start justify-center gap-3.5">
          {passages.map((passage, i) => {
            const current = i === currentIndex
            return (
              <li key={passage.id} className={`flex w-[150px] flex-none flex-col items-center gap-[9px] ${i % 2 ? 'mt-[34px]' : ''}`}>
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  aria-current={current || undefined}
                  aria-label={`Passage ${i + 1}: ${passage.title}, ${passage.author}`}
                  className={`flex size-[86px] flex-col items-center justify-center gap-[2px] rounded-full shadow-button active:translate-y-[5px] active:shadow-none ${
                    current ? 'bg-primary text-on-primary' : 'bg-secondary text-on-secondary'
                  }`}
                >
                  <span className="text-[26px] font-extrabold leading-none">{i + 1}</span>
                  <span className="max-w-[70px] text-center text-[10px] font-bold uppercase leading-[1.1] tracking-[.08em] opacity-85">
                    {passage.culture}
                  </span>
                </button>
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
