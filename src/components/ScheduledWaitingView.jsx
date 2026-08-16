import { useEffect, useMemo, useState } from 'react'
import { Loader2, LogOut, Shield } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDebug } from '../debug/DebugContext'
import DebugPanel from '../debug/DebugPanel'
import RulebookButton from './RulebookButton'
import {
  factionBarClass,
  factionBarTag,
  factionById,
  factionLogo,
  factionTitle,
} from '../lib/constants'
import {
  formatScheduleStamp,
  remainingParts,
} from '../lib/matchSchedule'

function Digit({ value, label }) {
  return (
    <div className="flex min-w-[4.5rem] flex-col items-center border border-cyan-500/30 bg-zinc-950/80 px-3 py-3 shadow-[0_0_18px_rgba(34,211,238,0.12)]">
      <span className="font-display text-4xl font-semibold tracking-[0.2em] text-cyan-300 sm:text-5xl">
        {String(value).padStart(2, '0')}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-[0.35em] text-zinc-500">
        {label}
      </span>
    </div>
  )
}

export default function ScheduledWaitingView({ session }) {
  const { profile, signOut } = useAuth()
  const debug = useDebug()
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const startMs = useMemo(() => {
    if (!session.scheduledStartTime) return null
    const t = new Date(session.scheduledStartTime).getTime()
    return Number.isFinite(t) ? t : null
  }, [session.scheduledStartTime])

  const remainingMs = startMs == null ? 0 : startMs - now
  const expired = startMs != null && remainingMs <= 0
  const parts = remainingParts(remainingMs)
  const faction = factionById(profile?.faction)
  const canHost = session.isHost || debug.enabled

  return (
    <div className="relative mx-auto w-full max-w-3xl overflow-hidden border border-cyan-500/20 bg-zinc-900/70 p-6 backdrop-blur sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,211,238,0.35) 3px)',
        }}
      />

      <div className="relative mb-8 flex items-start justify-between gap-3">
        <div className="text-left">
          <p className="font-display text-xs uppercase tracking-[0.35em] text-cyan-400/80">
            Scheduled Waiting
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold tracking-wide text-zinc-100">
            {expired ? 'Sincronizzazione in corso' : 'In attesa del via'}
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Accesso alla Network Map bloccato fino a{' '}
            <span className="text-cyan-200">
              {formatScheduleStamp(session.scheduledStartTime)}
            </span>
            {session.matchDurationDays
              ? ` · ciclo ${session.matchDurationDays} giorni`
              : null}
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RulebookButton />
          <DebugPanel />
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-1.5 border border-zinc-700 px-2 py-2 text-[10px] uppercase tracking-wider text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            title="Logout"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative mb-8 flex flex-wrap justify-center gap-2 sm:gap-3">
        <Digit value={parts.days} label="GG" />
        <Digit value={parts.hours} label="HH" />
        <Digit value={parts.minutes} label="MM" />
        <Digit value={parts.seconds} label="SS" />
      </div>

      <div className="relative mb-6 border border-zinc-700/80 bg-zinc-950/60 p-5 text-left">
        {faction ? (
          <div className="flex items-start gap-4">
            {faction.logo && (
              <img
                src={factionLogo(faction.id)}
                alt=""
                className="h-16 w-16 shrink-0 object-contain"
              />
            )}
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                Fazione assegnata
              </p>
              <p
                className={`font-display mt-1 text-lg tracking-wide ${factionBarClass(faction.id)}`}
              >
                [{factionBarTag(faction.id)}] {factionTitle(faction.id)}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {faction.lore}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            In attesa dell’assegnazione fazione. Resta in linea: il briefing
            partirà al via.
          </p>
        )}
      </div>

      <p className="relative mb-4 text-center text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        {session.players.length} operatori in holding pattern
      </p>

      {session.error && (
        <p className="relative mb-4 border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {session.error}
        </p>
      )}

      {expired && (
        <p className="relative mb-4 flex items-center justify-center gap-2 text-sm text-cyan-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Apertura dei sistemi di rete…
        </p>
      )}

      {canHost && (
        <div className="relative flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={session.busy}
            onClick={() => void session.reset()}
            className="border border-zinc-600 px-4 py-2 text-[11px] uppercase tracking-wider text-zinc-400 hover:border-zinc-400 hover:text-zinc-200 disabled:opacity-50"
          >
            Annulla programmazione
          </button>
          <button
            type="button"
            disabled={session.busy}
            onClick={() => void session.activate(true)}
            className="inline-flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {session.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <Shield className="h-3.5 w-3.5" />
            Forza avvio
          </button>
        </div>
      )}
    </div>
  )
}
