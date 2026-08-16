import { useEffect, useRef } from 'react'
import { AlertTriangle, OctagonX } from 'lucide-react'
import { formatRemaining } from '../lib/actions'
import { useAudio } from '../hooks/useAudio'

/**
 * Banner urgente per Trace/Kick in arrivo sul proprio slot.
 */
export default function ThreatAlertBanner({ threats, onAbort, aborting }) {
  const { playError } = useAudio()
  const seenRef = useRef(new Set())

  useEffect(() => {
    if (!threats?.length) return
    const id = threats[0].id
    if (seenRef.current.has(id)) return
    seenRef.current.add(id)
    playError()
  }, [threats, playError])

  if (!threats?.length) return null

  const primary = threats[0]
  const isKick = primary.type === 'kick'

  return (
    <div
      className={`threat-pulse mt-3 border px-3 py-2.5 ${
        isKick
          ? 'border-red-500 bg-red-600/30 text-red-50'
          : 'border-amber-500 bg-amber-500/25 text-amber-50'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-left">
          <AlertTriangle
            className={`mt-0.5 h-5 w-5 shrink-0 ${isKick ? 'text-red-200' : 'text-amber-200'}`}
          />
          <div>
            <p className="text-xs font-semibold tracking-wide uppercase">
              {isKick
                ? 'ALLARME: Tentativo di Kick rilevato!'
                : 'WARNING: Trace in corso sul tuo slot!'}
            </p>
            <p className="mt-0.5 text-[11px] opacity-90">
              Contromisura da slot {primary.slotLabel} ·{' '}
              {formatRemaining(primary.remainingMs)} rimanenti
              {threats.length > 1 ? ` · +${threats.length - 1} altre` : ''}.
              Abortisci ora per fuggire.
            </p>
            <div className="mt-2 h-1 overflow-hidden bg-black/30">
              <div
                className={`h-full transition-[width] duration-200 ${
                  isKick ? 'bg-red-300' : 'bg-amber-200'
                }`}
                style={{
                  width: `${Math.round(primary.progress * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>

        {onAbort && (
          <button
            type="button"
            disabled={aborting}
            onClick={onAbort}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 border border-white/30 bg-black/30 px-3 py-2 text-[11px] font-medium uppercase tracking-wider hover:bg-black/50 disabled:opacity-50"
          >
            <OctagonX className="h-3.5 w-3.5" />
            Abort Operation
          </button>
        )}
      </div>
    </div>
  )
}
