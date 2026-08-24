import { useState, useEffect, useMemo } from 'react'
import { Loader2, Radio, ScanSearch, ShieldAlert, Wine } from 'lucide-react'
import { useAudio } from '../hooks/useAudio'
import { actionProgress, formatRemaining, isSlotTimerExpired } from '../lib/actions'
import { radarOccupancyLabel, sanitizeRadarSlot } from '../lib/abilities'
import { gigsTargetingNode } from '../lib/gigs'
import { isNodeDdosActive } from '../lib/hardware'
import { factionLogo, serverOwnerPresentation } from '../lib/constants'
import GigObjectiveBanner from './GigObjectiveBanner'
import LogTerminal from './LogTerminal'
import {
  formatCycleCountdown,
  resolveMatchEndMs,
} from '../lib/matchSchedule'

export default function Dashboard({
  servers,
  services,
  slotsByNode = {},
  rolesById = {},
  viewerRole = null,
  loading,
  error,
  isBlocked,
  onSelectServer,
  onSelectAfterlife,
  logs = [],
  logsLoading = false,
  logsError = null,
  viewerId = null,
  traveling = false,
  travelLabel = null,
  travelRemainingMs = 0,
  travelError = null,
  onAbortTravel = null,
  executorGigs = [],
  scoreByFaction = { security: 0, hacktivist: 0 },
  matchEndTime = null,
  startedAt = null,
  matchDurationDays = null,
}) {
  const { playClick } = useAudio()
  const [now, setNow] = useState(Date.now())
  const isAnalyst = viewerRole === 'analyst'
  const radarByNode = useMemo(() => {
    if (!isAnalyst) return {}
    const next = {}
    for (const [nodeId, slots] of Object.entries(slotsByNode)) {
      next[nodeId] = (slots ?? [])
        .map((slot) => sanitizeRadarSlot(slot, rolesById))
        .filter(Boolean)
    }
    return next
  }, [isAnalyst, slotsByNode, rolesById])

  useEffect(() => {
    const hasGigTimer = executorGigs.some((g) => g.deadline)
    if (!hasGigTimer && !isAnalyst) return undefined
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [executorGigs, isAnalyst])

  const playerGigs = executorGigs.filter((g) => {
    const action = g.target_action
    return action === 'TRACE' || action === 'KICK'
  })
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-sm text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
        Collegamento alla rete…
      </div>
    )
  }

  if (error) {
    return (
      <p className="border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {error}
      </p>
    )
  }

  const afterlife =
    services.find((s) => s.name.toLowerCase().includes('afterlife')) ?? null
  const mapServices = services.filter(
    (s) => !s.name.toLowerCase().includes('helpdesk'),
  )

  return (
    <div className="mx-auto w-full max-w-5xl">
      {isBlocked && (
        <div className="mb-6 flex flex-col gap-3 border border-red-500/40 bg-red-500/10 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-red-200">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            Account BLOCKED dopo un Kick. Vai all’Afterlife per l’Helpdesk.
          </p>
          {afterlife && (
            <button
              type="button"
              onClick={() => {
                playClick()
                onSelectAfterlife?.(afterlife.id)
              }}
              className="border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs uppercase tracking-wider text-amber-200 hover:bg-amber-500/20"
            >
              Apri Afterlife
            </button>
          )}
        </div>
      )}

      <div className="mb-6 text-left">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-zinc-100 sm:text-3xl">
          Network Map
        </h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          {isAnalyst
            ? 'Panopticon attivo: occupancy sulla mappa e timer esatti sugli slot nemici, senza login. I Ghost non compaiono sul radar.'
            : 'Seleziona un nodo per accedere agli slot. Contromisure Trace/Kick sugli slot altrui.'}
        </p>
        {isAnalyst && (
          <p className="mt-2 inline-flex items-center gap-1.5 border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-wider text-cyan-200">
            <ScanSearch className="h-3 w-3" />
            Panopticon
          </p>
        )}
      </div>

      {traveling && (
        <div className="mb-6 border border-fuchsia-500/40 bg-fuchsia-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-fuchsia-200">
            <Loader2 className="h-4 w-4 animate-spin" />
            Connecting / Traveling
            {travelLabel ? ` · ${travelLabel}` : ''}
          </p>
          <p className="mt-1 text-xs text-fuchsia-200/70">
            Login al server tra {formatRemaining(travelRemainingMs)}. Gli slot
            saranno visibili a timer scaduto.
          </p>
          {onAbortTravel && (
            <button
              type="button"
              onClick={() => void onAbortTravel()}
              className="mt-3 text-[11px] uppercase tracking-wider text-zinc-400 hover:text-red-300"
            >
              Annulla
            </button>
          )}
        </div>
      )}

      {travelError && (
        <p className="mb-6 border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {travelError}
        </p>
      )}

      {playerGigs.length > 0 && (
        <div className="mb-6">
          <GigObjectiveBanner
            gigs={playerGigs}
            catalogs={{ servers }}
            now={now}
          />
        </div>
      )}

      <div className="relative mb-6 overflow-hidden rounded-xl border border-slate-800 bg-[url('/city-banner.png')] bg-cover bg-center">
        <div className="absolute inset-0 z-0 bg-slate-950/60" />
        <div className="relative z-10 p-6 sm:p-8">
          <MatchEndCountdown
            matchEndTime={matchEndTime}
            startedAt={startedAt}
            matchDurationDays={matchDurationDays}
          />
          <WarStatusBar
            corpVp={scoreByFaction.security ?? 0}
            rebelVp={scoreByFaction.hacktivist ?? 0}
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {servers.map((server) => {
              const nodeGigs = gigsTargetingNode(executorGigs, server.id)
              const hasGig = nodeGigs.length > 0
              const owner = serverOwnerPresentation(server.owner_faction)
              const disabled = isBlocked || traveling
              return (
                <button
                  key={server.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    playClick()
                    onSelectServer(server.id)
                  }}
                  className={`group border p-5 text-left transition ${
                    disabled
                      ? 'cursor-not-allowed border-zinc-800 bg-zinc-950/40 opacity-50 backdrop-blur-md'
                      : `${owner.cardClass} bg-zinc-900/60 backdrop-blur-md hover:bg-zinc-900/75 ${
                          hasGig ? 'ring-1 ring-fuchsia-500/40' : ''
                        }`
                  }`}
                >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-4">
                  <img
                    src={owner.logo || '/mercenary-logo.png'}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-sm object-contain"
                    onError={(event) => {
                      if (event.currentTarget.dataset.fallback === '1') return
                      event.currentTarget.dataset.fallback = '1'
                      event.currentTarget.src = '/mercenary-logo.png'
                    }}
                  />
                  <div>
                    <h2 className="font-display text-lg tracking-wide text-zinc-100">
                      {server.name}
                    </h2>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
                      <Radio className="h-3 w-3 text-emerald-400" />
                      Live
                    </p>
                    <p
                      className={`mt-1 text-[10px] font-medium uppercase tracking-[0.16em] ${owner.badgeClass}`}
                    >
                      {owner.badge}
                    </p>
                  </div>
                </div>
              </div>

              <IceBar
                ice={server.ice ?? 0}
                ownerFaction={server.owner_faction}
              />
              {isAnalyst && (
                <PanopticonSlots
                  slots={radarByNode[server.id] ?? []}
                  now={now}
                  viewerId={viewerId}
                />
              )}
              {isNodeDdosActive(server) && (
                <p className="mt-2 text-[10px] uppercase tracking-wider text-red-400">
                  DDoS attivo — travel ×2
                </p>
              )}
              {hasGig && (
                <div className="mt-3">
                  <GigObjectiveBanner
                    gigs={nodeGigs}
                    catalogs={{ servers }}
                    now={now}
                    compact
                  />
                </div>
              )}

              <div className="mt-4 flex items-center justify-end text-xs text-zinc-500">
                <span className={hasGig ? 'text-fuchsia-300' : 'text-cyan-400/80'}>
                  {hasGig ? 'Obiettivo GIG →' : 'Accedi →'}
                </span>
              </div>
            </button>
          )
        })}
          </div>
        </div>
      </div>

      {mapServices.length > 0 && (
        <>
          <h2 className="font-display mt-10 mb-4 text-left text-sm uppercase tracking-[0.2em] text-zinc-500">
            Servizi
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {mapServices.map((service) => {
              const name = service.name.toLowerCase()
              const isAfterlife = name.includes('afterlife')
              const open = isAfterlife
                ? () => onSelectAfterlife?.(service.id)
                : null
              const enabled =
                Boolean(open) && !traveling && (!isBlocked || isAfterlife)
              if (isAfterlife) {
                return (
                  <button
                    key={service.id}
                    type="button"
                    disabled={!enabled}
                    onClick={() => {
                      playClick()
                      open?.()
                    }}
                    className={`relative h-32 overflow-hidden rounded-lg border text-left transition-colors sm:col-span-2 ${
                      enabled
                        ? 'border-fuchsia-500/40 hover:border-purple-500'
                        : 'cursor-not-allowed border-zinc-800 opacity-60'
                    }`}
                  >
                    <span
                      aria-hidden
                      className="absolute inset-0 bg-[url('/afterlife-button.png')] bg-cover bg-center"
                    />
                    <span
                      aria-hidden
                      className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-900/60 to-transparent"
                    />
                    <span className="relative flex h-full flex-col justify-center px-5">
                      <h3 className="font-display text-lg tracking-wide text-zinc-100">
                        {service.name}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-300">
                        Helpdesk · Hardware · Gigs · Auction House
                      </p>
                    </span>
                  </button>
                )
              }
              return (
                <button
                  key={service.id}
                  type="button"
                  disabled={!enabled}
                  onClick={() => {
                    playClick()
                    open?.()
                  }}
                  className={`border p-5 text-left transition ${
                    enabled
                      ? 'border-fuchsia-500/40 bg-zinc-900/70 hover:border-fuchsia-400/60'
                      : 'cursor-not-allowed border-zinc-800 bg-zinc-950/40 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300">
                      <Wine className="h-5 w-5" strokeWidth={1.5} />
                    </div>
                    <div>
                      <h3 className="font-display text-lg text-zinc-100">
                        {service.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Disponibile in una fase successiva
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      <LogTerminal
        logs={logs}
        loading={logsLoading}
        error={logsError}
        viewerId={viewerId}
      />
    </div>
  )
}

function PanopticonSlots({ slots, now, viewerId }) {
  if (!slots.length) return null
  return (
    <ul className="mt-3 space-y-1.5 border-t border-zinc-800/80 pt-3">
      {slots.map((slot) => {
        const expiredOwn =
          Boolean(viewerId) &&
          slot.user_id === viewerId &&
          isSlotTimerExpired(slot, now)
        const label = expiredOwn ? null : radarOccupancyLabel(slot)
        const occupied = Boolean(label)
        const showTimer = label === 'OCCUPATO' && slot.end_time
        const prog = showTimer ? actionProgress(slot, now) : null
        return (
          <li
            key={slot.id}
            className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider"
          >
            <span className="text-zinc-500">Slot {slot.slot_id}</span>
            {occupied ? (
              <span
                className={
                  label === 'SEGNALE INSTABILE'
                    ? 'text-amber-400/90'
                    : 'text-cyan-300'
                }
              >
                {label}
                {prog ? ` · ${formatRemaining(prog.remainingMs)}` : ''}
              </span>
            ) : (
              <span className="text-zinc-600">Libero</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function MatchEndCountdown({ matchEndTime, startedAt, matchDurationDays }) {
  const [now, setNow] = useState(Date.now())
  const endMs = resolveMatchEndMs({
    matchEndTime,
    startedAt,
    matchDurationDays,
  })

  useEffect(() => {
    if (endMs == null) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [endMs])

  if (endMs == null) return null

  const remaining = endMs - now
  const expired = remaining <= 0

  return (
    <div className="mb-6 border border-red-500/50 bg-red-500/10 p-3 text-center font-mono text-xl font-bold tracking-widest text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)] md:text-2xl rounded-lg">
      <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-[0.35em] text-red-400/80">
        Fine ciclo
      </p>
      {expired ? (
        <p>[ CICLO CONCLUSO / CALCOLO IN CORSO ]</p>
      ) : (
        <p>{formatCycleCountdown(remaining)}</p>
      )}
    </div>
  )
}

function WarStatusBar({ corpVp, rebelVp }) {
  const corp = Math.max(0, Number(corpVp) || 0)
  const rebel = Math.max(0, Number(rebelVp) || 0)
  const total = corp + rebel
  const corpPct = total === 0 ? 50 : (corp / total) * 100
  const rebelPct = 100 - corpPct

  return (
    <section className="mb-6 border border-zinc-700/80 bg-zinc-900/70 p-4">
      <p className="mb-3 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
        Global War Status
      </p>
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-wider">
        <span className="flex items-center gap-2 text-blue-400">
          <img
            src={factionLogo('security')}
            alt=""
            className="h-7 w-7 shrink-0 rounded-sm object-contain drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]"
          />
          CORP: {corp} VP
        </span>
        <span className="text-zinc-600">vs</span>
        <span className="flex items-center gap-2 text-red-400">
          REBEL: {rebel} VP
          <img
            src={factionLogo('hacktivist')}
            alt=""
            className="h-7 w-7 shrink-0 rounded-sm object-contain drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]"
          />
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden bg-zinc-800">
        <div
          className="bg-blue-500 transition-all duration-500"
          style={{ width: `${corpPct}%` }}
        />
        <div
          className="bg-red-500 transition-all duration-500"
          style={{ width: `${rebelPct}%` }}
        />
      </div>
    </section>
  )
}

function IceBar({ ice, ownerFaction }) {
  const clamped = Math.max(0, Math.min(100, ice))
  const tone =
    clamped > 50 ? 'bg-emerald-400' : clamped > 20 ? 'bg-amber-400' : 'bg-red-400'
  const owner =
    ownerFaction === 'security'
      ? 'Corp'
      : ownerFaction === 'hacktivist'
        ? 'Rebel'
        : 'Merc'

  return (
    <div>
      <div className="mb-1.5 flex items-end justify-between">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">
          ICE · {owner}
        </span>
        <span className="font-display text-xl text-zinc-100">{clamped}%</span>
      </div>
      <div className="h-2 overflow-hidden bg-zinc-800">
        <div
          className={`h-full transition-all duration-500 ${tone}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
