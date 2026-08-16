export default function StatTooltip({ text, align = 'center', children }) {
  if (!text) return children

  const pos =
    align === 'right'
      ? 'right-0'
      : align === 'left'
        ? 'left-0'
        : 'left-1/2 -translate-x-1/2'

  return (
    <div className="group relative">
      {children}
      <div
        role="tooltip"
        className={`pointer-events-none absolute top-full z-40 mt-2 hidden w-64 border border-cyan-500/30 bg-zinc-950 px-3 py-2 text-left shadow-lg shadow-black/50 group-hover:block ${pos}`}
      >
        <p className="text-[11px] leading-relaxed text-zinc-200">{text}</p>
      </div>
    </div>
  )
}
