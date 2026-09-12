/** Pip, the carrier pigeon. Decorative. */
export default function Pip() {
  return (
    <div aria-hidden="true" className="relative h-[70px] w-[78px] flex-none motion-safe:animate-bob">
      <span className="absolute left-[8px] top-[26px] h-[40px] w-[58px] rounded-[50%_46%_44%_52%] bg-pip-body" />
      <span className="absolute left-[2px] top-[36px] h-[22px] w-[30px] rounded-[50%_8%_50%_50%] bg-pip-wing" />
      <span className="absolute left-[44px] top-[10px] size-[30px] rounded-full bg-pip-head" />
      <span className="absolute left-[70px] top-[22px] size-0 border-y-[6px] border-l-[11px] border-y-transparent border-l-primary" />
      <span className="absolute left-[62px] top-[19px] size-[5px] rounded-full bg-pip-eye" />
      <span className="absolute left-[42px] top-[34px] h-[9px] w-[26px] rounded-full bg-accent" />
    </div>
  )
}
