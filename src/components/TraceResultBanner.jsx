import { actionLabel } from '../lib/logFormat'

export default function TraceResultBanner({ result, onClose, className = '' }) {
  if (!result) return null

  const failed = result.outcome === 'failure'
  const action = result.targetAction ? actionLabel(result.targetAction) : null

  return (
    <div
      className={`flex items-start justify-between gap-3 border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-left ${className}`}
    >
      <div>
        <p className="text-[11px] uppercase tracking-wider text-cyan-400/80">
          Trace result · {result.nodeName}
          {failed ? ' · FAILED' : ''}
        </p>
        <p className="mt-1 font-display text-lg text-cyan-100">
          {result.revealed || 'Unknown'}
        </p>
        {!failed && action && (
          <p className="mt-0.5 text-sm text-cyan-200/80">Azione: {action}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="text-xs text-cyan-400/70 hover:text-cyan-200"
      >
        Chiudi
      </button>
    </div>
  )
}
