import { Crosshair, Timer } from 'lucide-react'
import { formatRemaining } from '../lib/actions'
import {
  formatGigTitle,
  gigActionMeta,
  gigDeadlineMs,
  isGigExpired,
} from '../lib/gigs'

export default function GigObjectiveBanner({
  gigs = [],
  catalogs,
  now = Date.now(),
  compact = false,
}) {
  if (!gigs.length) return null

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {gigs.map((gig) => (
        <GigObjectiveRow
          key={gig.id}
          gig={gig}
          catalogs={catalogs}
          now={now}
          compact={compact}
        />
      ))}
    </div>
  )
}

function GigObjectiveRow({ gig, catalogs, now, compact }) {
  const action = gigActionMeta(gig.target_action)
  const title = formatGigTitle(gig, catalogs)
  const remaining = gigDeadlineMs(gig, now)
  const expired = isGigExpired(gig, now)

  if (compact) {
    return (
      <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-wider text-fuchsia-200">
        <Crosshair className="h-3 w-3 shrink-0" />
        <span>GIG · {title}</span>
        <span className="text-amber-200/90">{gig.reward} ₵</span>
        {remaining != null && (
          <span className={expired ? 'text-red-300' : 'text-zinc-400'}>
            {expired ? 'Scaduto' : formatRemaining(remaining)}
          </span>
        )}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1 border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-left sm:flex-row sm:items-center sm:justify-between">
      <p className="inline-flex items-center gap-2 text-xs text-fuchsia-100">
        <Crosshair className="h-3.5 w-3.5 shrink-0 text-fuchsia-300" />
        <span>
          <span className="font-display uppercase tracking-[0.2em] text-fuchsia-300/90">
            Contratto
          </span>
          <span className="ml-2 text-zinc-100">{title}</span>
        </span>
      </p>
      <p className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-zinc-400">
        <span className="text-amber-200/90">{gig.reward} ₵</span>
        {action?.kind === 'server' && (
          <span>Esegui {action.verb.toLowerCase()} su questo nodo</span>
        )}
        {action?.kind === 'player' && (
          <span>Esegui {action.verb} sul bersaglio</span>
        )}
        {remaining != null && (
          <span
            className={`inline-flex items-center gap-1 ${
              expired ? 'text-red-300' : 'text-fuchsia-200'
            }`}
          >
            <Timer className="h-3 w-3" />
            {expired ? 'Scaduto' : formatRemaining(remaining)}
          </span>
        )}
      </p>
    </div>
  )
}
