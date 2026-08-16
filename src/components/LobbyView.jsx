import { useMemo, useState } from 'react'
import { Check, Loader2, LogOut, Shield, Users, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDebug } from '../debug/DebugContext'
import DebugPanel from '../debug/DebugPanel'
import RulebookButton from './RulebookButton'
import { factionBarClass, factionBarTag } from '../lib/constants'
import {
  defaultScheduledStart,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '../lib/matchSchedule'

export default function LobbyView({ session }) {
  const { profile, signOut } = useAuth()
  const debug = useDebug()
  const {
    players,
    busy,
    error,
    readyCount,
    isHost,
    setReady,
    start,
    schedule,
  } = session

  const ready = Boolean(profile?.is_ready)
  const canHost = Boolean(isHost || debug.enabled)
  const canStart = readyCount >= 2 || debug.enabled
  const startDisabled = busy || !canStart || !canHost
  const [startLocal, setStartLocal] = useState(() =>
    toDatetimeLocalValue(defaultScheduledStart()),
  )
  const [durationDays, setDurationDays] = useState(7)

  const minLocal = useMemo(() => toDatetimeLocalValue(new Date()), [])

  async function handleSchedule() {
    const when = fromDatetimeLocalValue(startLocal)
    if (!when) return
    await schedule({
      startTime: when,
      durationDays: Number(durationDays) || 7,
      allowSolo: Boolean(debug.enabled),
    })
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="text-left">
          <p className="font-display text-xs uppercase tracking-[0.35em] text-cyan-400/80">
            Pre-Game Lobby
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold tracking-wide text-zinc-100">
            {session.gameState === 'COMPLETED'
              ? 'Partita conclusa'
              : 'In attesa dell’host'}
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Segna PRONTO: lo stato resta salvato anche se chiudi il browser.
            L’host avvia quando i PRONTO gli bastano.
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

      <div className="mb-4 flex items-center justify-between gap-3 border border-zinc-700/80 bg-zinc-900/70 px-4 py-3">
        <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-400">
          <Users className="h-4 w-4 text-cyan-400" />
          {players.length} in lobby · {readyCount} pronti
        </p>
        {isHost && (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-300">
            <Shield className="h-3 w-3" />
            Host
          </span>
        )}
      </div>

      <ul className="divide-y divide-zinc-800 border border-zinc-700/80 bg-zinc-900/70">
        {players.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-zinc-500">
            Nessun operatore in lobby.
          </li>
        ) : (
          players.map((player) => {
            const isMe = player.id === profile?.id
            return (
              <li
                key={player.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 text-left">
                  <p className="truncate text-sm font-medium text-zinc-100">
                    {player.name}
                    {isMe ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-500">
                        tu
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                    {player.is_admin ? 'Host · ' : ''}
                    {player.is_ready ? 'PRONTO' : 'In attesa'}
                    {player.faction ? (
                      <>
                        {' · '}
                        <span className={factionBarClass(player.faction)}>
                          {factionBarTag(player.faction)}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1 border px-2 py-1 text-[10px] uppercase tracking-wider ${
                    player.is_ready
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-700 bg-zinc-950/80 text-zinc-500'
                  }`}
                >
                  {player.is_ready ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                  {player.is_ready ? 'READY' : 'NOT READY'}
                </span>
              </li>
            )
          })
        )}
      </ul>

      {error && (
        <p className="mt-4 border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          disabled={busy || !profile}
          onClick={() => void setReady(!ready)}
          className={`flex items-center justify-center gap-2 border px-5 py-2.5 text-sm font-medium uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-60 ${
            ready
              ? 'border-zinc-600 text-zinc-300 hover:border-zinc-400'
              : 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
          }`}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {ready ? 'NON PRONTO' : 'PRONTO'}
        </button>
      </div>

      {canHost && (
        <div className="mt-6 space-y-4 border border-cyan-500/20 bg-zinc-900/70 p-4">
          <p className="font-display text-[10px] uppercase tracking-[0.3em] text-cyan-400/80">
            Programma il via
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-left text-[10px] uppercase tracking-wider text-zinc-500">
              Data e ora di inizio
              <input
                type="datetime-local"
                min={minLocal}
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="mt-1.5 w-full border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/70"
              />
            </label>
            <label className="block text-left text-[10px] uppercase tracking-wider text-zinc-500">
              Durata (giorni)
              <input
                type="number"
                min={1}
                max={60}
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                className="mt-1.5 w-full border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/70"
              />
            </label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={startDisabled}
              onClick={() => void start(Boolean(debug.enabled))}
              className="inline-flex items-center justify-center gap-2 border border-zinc-600 px-5 py-2.5 text-sm font-medium uppercase tracking-wider text-zinc-300 transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60"
              title={
                canStart
                  ? 'Avvia subito senza countdown'
                  : 'Servono almeno 2 giocatori PRONTO (Debug: bypass)'
              }
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Avvia ora
            </button>
            <button
              type="button"
              disabled={startDisabled || !startLocal}
              onClick={() => void handleSchedule()}
              className="flex items-center justify-center gap-2 bg-amber-500 px-5 py-2.5 text-sm font-medium uppercase tracking-wider text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              title={
                canStart
                  ? 'Assegna le fazioni e avvia il countdown'
                  : 'Servono almeno 2 giocatori PRONTO (Debug: bypass)'
              }
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Programma partita
            </button>
          </div>
        </div>
      )}

      {canHost && !canStart && (
        <p className="mt-3 text-xs text-zinc-500">
          Servono almeno 2 giocatori PRONTO. In God Mode i bottoni ignorano il
          minimo.
        </p>
      )}
    </div>
  )
}
