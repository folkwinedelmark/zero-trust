import { Zap } from 'lucide-react'

export default function PaCost({ cost, variant = 'inline', className = '' }) {
  const label = `${cost} PA`

  if (variant === 'badge') {
    return (
      <div
        className={`absolute top-3 right-3 flex items-center gap-1 rounded border border-cyan-800/50 bg-cyan-950/40 px-2 py-1 text-xs font-bold text-cyan-400 ${className}`}
      >
        <Zap size={14} className="fill-cyan-400/20" />
        <span>{label}</span>
      </div>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1 font-bold text-cyan-400 ${className}`}
    >
      <Zap size={14} className="fill-cyan-400/20" />
      <span>{label}</span>
    </span>
  )
}
