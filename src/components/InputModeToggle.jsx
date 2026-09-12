import { INPUT_MODES } from '../hooks/useMorseInput.js'

export default function InputModeToggle({ mode, onChange }) {
  return (
    <div role="group" aria-label="Input mode" className="flex items-center gap-[9px] rounded-full bg-paper-2 p-[5px] shadow-well">
      {Object.entries(INPUT_MODES).map(([value, label]) => {
        const selected = value === mode
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(value)}
            className={`rounded-full px-[17px] py-[11px] text-[13.5px] font-bold transition-transform duration-120 ${
              selected ? 'bg-card text-ink shadow-button' : 'bg-transparent text-ink-soft'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
