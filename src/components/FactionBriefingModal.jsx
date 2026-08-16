import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import DebugPanel from '../debug/DebugPanel'
import {
  factionBarClass,
  factionBarTag,
  factionBriefing,
  factionById,
  factionTitle,
  factionWinCondition,
} from '../lib/constants'

function BannerImage({ faction }) {
  if (!faction) return null
  return (
    <img
      src={faction.banner}
      alt=""
      className="absolute inset-0 h-full w-full object-cover object-center"
      onError={(event) => {
        const img = event.currentTarget
        if (img.dataset.fallback === '1') return
        img.dataset.fallback = '1'
        if (faction.bannerJpg) img.src = faction.bannerJpg
      }}
    />
  )
}

export default function FactionBriefingModal({ session }) {
  const { profile, signOut } = useAuth()
  const faction = factionById(profile?.faction)

  async function proceed() {
    await session.acknowledgeBriefing()
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-zinc-950">
      <div className="relative min-h-svh">
        <BannerImage faction={faction} />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-zinc-950/40" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(180deg, transparent, transparent 3px, rgba(255,255,255,0.25) 4px)',
          }}
        />

        <div className="relative mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-end px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-start justify-between gap-3">
            <p className="font-display text-xs uppercase tracking-[0.4em] text-amber-400/85">
              Faction Briefing
            </p>
            <DebugPanel />
          </div>

          <div className="flex items-center gap-4">
            {faction?.logo && (
              <img
                src={faction.logo}
                alt=""
                className={`h-20 w-20 shrink-0 object-contain ${faction.glowClass ?? ''}`}
              />
            )}
            <div className="min-w-0 text-left">
              <p
                className={`text-[11px] uppercase tracking-[0.3em] ${faction ? factionBarClass(faction.id) : 'text-zinc-400'}`}
              >
                {faction
                  ? `[${factionBarTag(faction.id)}]`
                  : '[ UNASSIGNED ]'}
              </p>
              <h1 className="font-display mt-1 text-3xl font-semibold tracking-wide text-zinc-50 sm:text-4xl">
                {factionTitle(profile?.faction)}
              </h1>
            </div>
          </div>

          <p className="mt-6 max-w-2xl text-left text-sm leading-relaxed text-zinc-300 sm:text-base">
            {factionBriefing(profile?.faction) ||
              'I sistemi di rete sono online. Attendi l’assegnazione fazione e procedi al briefing operativo.'}
          </p>

          <div className="mt-8 border border-amber-500/40 bg-amber-500/10 p-4 text-left">
            <p className="text-[10px] uppercase tracking-[0.35em] text-amber-400">
              Win Condition
            </p>
            <p className="font-display mt-2 text-lg leading-snug tracking-wide text-amber-100">
              {factionWinCondition(profile?.faction) ||
                'Obiettivo di fazione in attesa di assegnazione.'}
            </p>
          </div>

          {(session.error) && (
            <p className="mt-4 border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {session.error}
            </p>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={signOut}
              className="text-sm text-zinc-500 hover:text-zinc-300"
            >
              Esci dall’account
            </button>
            <button
              type="button"
              disabled={session.busy}
              onClick={() => void proceed()}
              className="flex items-center justify-center gap-2 bg-amber-500 px-6 py-3 text-sm font-medium uppercase tracking-[0.2em] text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {session.busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Accedi ai sistemi di rete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
