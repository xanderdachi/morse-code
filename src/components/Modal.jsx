import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useEffectEvent, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Shared shell for every dialog: backdrop, card, close button, focus and Escape handling. */
export default function Modal({ open, onClose, width = 600, labelledBy, children }) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <ModalFrame key="modal" onClose={onClose} width={width} labelledBy={labelledBy}>
          {children}
        </ModalFrame>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function ModalFrame({ onClose, width, labelledBy, children }) {
  const cardRef = useRef(null)
  const close = useEffectEvent(() => onClose())

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cardRef.current?.focus({ preventScroll: true })

    const onKeyDown = event => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  const trapTab = event => {
    if (event.key !== 'Tab') return
    const focusable = [...cardRef.current.querySelectorAll(FOCUSABLE)]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-60 flex items-start justify-center overflow-auto bg-scrim px-4 py-[34px] backdrop-blur-[7px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18, delay: 0.04 } }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={trapTab}
        style={{ width }}
        className="relative max-w-full overflow-hidden rounded-modal border-2 border-edge bg-card px-5 pb-6 pt-6 text-ink shadow-modal outline-none sm:px-[30px] sm:pb-[28px] sm:pt-[30px]"
        initial={{ opacity: 0, y: 26, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.97, transition: { duration: 0.16, ease: 'easeIn' } }}
        transition={{ duration: 0.32, ease: [0.2, 1.3, 0.4, 1] }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-3 grid size-[38px] place-items-center rounded-full bg-paper-2 text-[16px] font-bold text-ink active:translate-y-[3px]"
        >
          ×
        </button>
        {children}
      </motion.div>
    </motion.div>
  )
}
