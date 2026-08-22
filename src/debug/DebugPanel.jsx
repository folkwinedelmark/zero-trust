import { Terminal, X } from 'lucide-react'
import { useDebug } from './DebugContext'
import { DEBUG_CREDIT_BOOST } from './debugConfig'
import { HEAT_MAX, PA_MAX, FACTIONS, ROLES, isMercFaction } from '../lib/constants'
import { useAuth } from '../context/AuthContext'
import { useAudio } from '../hooks/useAudio'

/**
 * Pannello God Mode — rimuovere insieme a `src/debug/`.
 */
export default function DebugPanel() {
  const debug = useDebug()
  const { profile } = useAuth()
  const { playClick, playSuccess, playError } = useAudio()

  if (!debug.uiEnabled) return null

  const rep = profile?.reputation ?? 3
  const heat = profile?.heat ?? 0
  const role = profile?.role ?? ''
  const faction = profile?.faction ?? ''

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => debug.setEnabled(!debug.enabled)}
        className={`inline-flex items-center gap-1.5 border px-2 py-1.5 text-[10px] uppercase tracking-wider transition ${
          debug.enabled
            ? 'border-lime-500/50 bg-lime-500/15 text-lime-300'
            : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
        }`}
        title="Toggle Debug / God Mode"
      >
        <Terminal className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">
          {debug.enabled ? 'DEBUG ON' : 'DEBUG'}
        </span>
      </button>

      {debug.enabled && (
        <div className="absolute top-full right-0 z-50 mt-2 max-h-[min(70vh,32rem)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-lime-500/40 bg-zinc-950 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-display text-[10px] uppercase tracking-[0.25em] text-lime-400">
              God Mode
            </p>
            <button
              type="button"
              onClick={() => debug.setEnabled(false)}
              className="text-zinc-500 hover:text-zinc-300"
              aria-label="Chiudi debug"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <Section title="Toggles">
            <Toggle
              checked={debug.bypassCosts}
              onChange={debug.setBypassCosts}
              label="Bypass costi PA / ₵"
            />
            <Toggle
              checked={debug.autoRefillPa}
              onChange={debug.setAutoRefillPa}
              label="Auto-ricarica PA a 0"
            />
            <Toggle
              checked={debug.instantTravel}
              onChange={debug.setInstantTravel}
              label="Instant Travel (0ms)"
            />
            <Toggle
              checked={debug.instantActions}
              onChange={debug.setInstantActions}
              label="Instant Actions (0ms)"
            />
          </Section>

          <Section title="Simulazione">
            <button
              type="button"
              disabled={debug.busy}
              onClick={() => void debug.simulateDailyTick()}
              className="w-full border border-violet-500/60 bg-violet-500/15 px-2 py-2 text-left text-[11px] uppercase tracking-wider text-violet-200 hover:border-violet-400 hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Simula +24 Ore (Daily Tick)
            </button>
            <button
              type="button"
              disabled={debug.busy}
              onClick={() => {
                playClick({ force: true })
                void (async () => {
                  const result = await debug.concludeMatchSim()
                  if (result?.cancelled) return
                  if (result?.error) {
                    playError({ force: true })
                    window.setTimeout(() => {
                      window.alert(
                        result.message ??
                          result.error.message ??
                          'Fine partita fallita — preview locale End Game.',
                      )
                    }, 50)
                  } else {
                    playSuccess({ force: true })
                  }
                })()
              }}
              className="w-full border border-amber-400/80 bg-amber-500/20 px-2 py-2 text-left text-[11px] uppercase tracking-wider text-amber-200 shadow-[0_0_14px_rgba(245,158,11,0.35)] hover:border-amber-300 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Simula Fine Partita (Chiudi ciclo)
            </button>
            <button
              type="button"
              disabled={debug.busy}
              onClick={() => void debug.resetLobby()}
              className="w-full border border-orange-500/60 bg-orange-500/15 px-2 py-2 text-left text-[11px] uppercase tracking-wider text-orange-200 hover:border-orange-400 hover:bg-orange-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Torna a Stato Lobby
            </button>
            <button
              type="button"
              disabled={debug.busy}
              onClick={() => void debug.forceActivateMatch()}
              className="w-full border border-cyan-500/60 bg-cyan-500/15 px-2 py-2 text-left text-[11px] uppercase tracking-wider text-cyan-200 hover:border-cyan-400 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Forza avvio match
            </button>
            <button
              type="button"
              disabled={debug.busy}
              onClick={() => void debug.resetTotal()}
              className="w-full border border-red-500/60 bg-red-500/15 px-2 py-2 text-left text-[11px] uppercase tracking-wider text-red-200 hover:border-red-400 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset Totale (Nuova Partita)
            </button>
          </Section>

          <Section title="Player Stats">
            <div className="flex gap-1.5">
              <StatBtn
                disabled={debug.busy}
                onClick={() => void debug.refillPa()}
              >
                PA → {PA_MAX}
              </StatBtn>
              <StatBtn
                disabled={debug.busy}
                onClick={() => void debug.addCredits()}
              >
                +{DEBUG_CREDIT_BOOST} ₵
              </StatBtn>
            </div>
            <StatBtn
              disabled={debug.busy}
              onClick={() => void debug.clearBlock()}
            >
              Sblocca account
            </StatBtn>
            <StatBtn
              disabled={debug.busy}
              onClick={() => void debug.clearDebuffs()}
            >
              Rimuovi Malus (Clear Debuffs)
            </StatBtn>
            <StatBtn
              disabled={debug.busy}
              onClick={() => void debug.clearIntelArchive()}
            >
              Svuota Archivio Intel
            </StatBtn>
            {isMercFaction(faction) && (
              <StatBtn
                disabled={debug.busy || !profile}
                onClick={() => void debug.giveCoreData()}
              >
                +1 Core Data
              </StatBtn>
            )}

            <RowLabel>Rep {rep}/5</RowLabel>
            <div className="flex gap-1.5">
              <StatBtn
                disabled={debug.busy || rep >= 5}
                onClick={() => void debug.bumpReputation(1)}
              >
                Rep +1
              </StatBtn>
              <StatBtn
                disabled={debug.busy || rep <= 1}
                onClick={() => void debug.bumpReputation(-1)}
              >
                Rep −1
              </StatBtn>
            </div>

            <RowLabel>
              Heat {heat}/{HEAT_MAX}
            </RowLabel>
            <div className="flex gap-1.5">
              <StatBtn
                disabled={debug.busy || heat >= HEAT_MAX}
                onClick={() => void debug.bumpHeat(1)}
              >
                Heat +1
              </StatBtn>
              <StatBtn
                disabled={debug.busy || heat <= 0}
                onClick={() => void debug.bumpHeat(-1)}
              >
                Heat −1
              </StatBtn>
              <StatBtn
                disabled={debug.busy || heat <= 0}
                onClick={() => void debug.clearHeat()}
              >
                Clear
              </StatBtn>
            </div>
          </Section>

          <Section title="Identity">
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500">
              Change Faction
              <select
                value={faction}
                disabled={debug.busy || !profile}
                onChange={(e) => void debug.setFaction(e.target.value)}
                className="mt-1 w-full border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-lime-500/50 disabled:opacity-50"
              >
                {!faction && <option value="">—</option>}
                {FACTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.barTag}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500">
              Change Class
              <select
                value={role}
                disabled={debug.busy || !profile}
                onChange={(e) => void debug.setRole(e.target.value)}
                className="mt-1 w-full border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-lime-500/50 disabled:opacity-50"
              >
                {!role && <option value="">—</option>}
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <StatBtn
              disabled={debug.busy}
              onClick={() => void debug.resetCooldowns()}
            >
              Reset Cooldowns
            </StatBtn>
          </Section>

          {debug.message && (
            <p className="mt-2 flex items-start justify-between gap-2 text-[10px] text-lime-300/90">
              <span>{debug.message}</span>
              <button
                type="button"
                onClick={debug.clearMessage}
                className="shrink-0 text-zinc-500 hover:text-zinc-300"
              >
                ×
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-3 border-t border-zinc-800 pt-2 first:border-t-0 first:pt-0">
      <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.2em] text-lime-500/70">
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-lime-400"
      />
      {label}
    </label>
  )
}

function RowLabel({ children }) {
  return (
    <p className="pt-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
      {children}
    </p>
  )
}

function StatBtn({ children, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex-1 border border-zinc-700 px-2 py-1.5 text-left text-[11px] text-zinc-200 hover:border-lime-500/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}
