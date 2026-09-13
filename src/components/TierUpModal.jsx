import { useId } from 'react'
import { Confetti, Stamp } from './Celebration.jsx'
import Modal from './Modal.jsx'

/** The tier-up celebration; with `complete`, the same moment for clearing the last tier. */
export default function TierUpModal({ open, tier, complete = false, onClose }) {
  const titleId = useId()

  return (
    <Modal open={open} onClose={onClose} width={560} labelledBy={titleId}>
      <div className="flex flex-col gap-[18px]">
        <Confetti />

        <div className="relative z-2 flex flex-wrap items-start gap-[18px]">
          <div className="min-w-0 flex-[1_1_240px]">
            <div className="text-[11px] font-bold uppercase tracking-[.12em] text-ink-soft">
              {complete ? 'Every tier cleared' : 'Tier cleared'}
            </div>
            <h2 id={titleId} className="mt-1.5 text-[32px] font-extrabold leading-[1.05]">
              {complete ? 'The whole club, cleared.' : `Tier ${tier} unlocked.`}
            </h2>
            <p className="mt-2 text-[14.5px] font-medium leading-[1.45] text-ink-soft">
              {complete
                ? 'Every passage on every tier has come through. Keep sending them, for speed or for the pleasure of it.'
                : `Tier ${tier - 1} is behind you. A fresh set of passages is on the wire.`}
            </p>
          </div>
          <Stamp value={tier} label="TIER" className="bg-secondary text-on-secondary" />
        </div>

        <div className="relative z-2 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-primary px-[26px] py-[15px] text-[17px] font-extrabold text-on-primary shadow-button active:translate-y-[5px] active:shadow-none"
          >
            {complete ? 'Keep sending' : `Start tier ${tier}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
