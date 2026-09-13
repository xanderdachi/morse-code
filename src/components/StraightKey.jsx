/** One big key: hold time decides dot or dash. Input handling comes from useMorseInput. */
export default function StraightKey({ isDown, dashFormed, keyProps }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        aria-label="Morse key: hold briefly for a dot, longer for a dash"
        {...keyProps}
        className={`relative grid size-[138px] touch-key place-items-center rounded-full bg-paper-2 transition-[translate,box-shadow] duration-70 sm:size-[186px] ${
          isDown ? 'translate-y-[6px] shadow-key-down' : 'shadow-button'
        }`}
      >
        <span
          className={`grid size-[74%] place-items-center rounded-full bg-primary ${isDown ? 'shadow-cap-down' : 'shadow-cap'}`}
        >
          <span
            className={`block h-4 rounded-full bg-glyph transition-[width] duration-350 ease-[cubic-bezier(.2,1.3,.4,1)] ${
              dashFormed ? 'w-[62px]' : 'w-4'
            }`}
          />
        </span>
      </button>
      <p className="max-w-[260px] text-center text-[12.5px] font-semibold text-pretty text-ink-soft">
        Short press makes a dot, long press makes a dash.
      </p>
    </div>
  )
}
