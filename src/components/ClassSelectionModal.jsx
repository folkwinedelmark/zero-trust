import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import DebugPanel from '../debug/DebugPanel'
import ConfirmModal from './ConfirmModal'
import {
  ROLES,
  factionBarClass,
  factionBarTag,
  factionById,
} from '../lib/constants'
import {
  abilitiesForRole,
  abilityCooldownLabel,
  passivesForRole,
} from '../lib/abilities'

function selectionAbilities(roleId) {
  const actives = abilitiesForRole(roleId)
  const extra = passivesForRole(roleId).filter((p) => p.iconSrc)
  if (roleId === 'ghost' && extra.length) {
    const [first, ...rest] = actives
    return [first, ...extra, ...rest].filter(Boolean)
  }
  return [...actives, ...extra]
}

export default function ClassSelectionModal({ session }) {
  const { profile, error, setError, signOut } = useAuth()
  const [pending, setPending] = useState(null)
  const faction = factionById(profile?.faction) ?? null

  const cards = useMemo(() => ROLES, [])

  async function confirmClass() {
    if (!pending) return
    setError(null)
    const { error: chooseError } = await session.chooseClass(pending.id)
    if (chooseError) return
    setPending(null)
  }

  return (
    <div className="relative mx-auto w-full max-w-5xl px-1 py-4">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="text-left">
          <p className="font-display text-xs uppercase tracking-[0.35em] text-amber-400/80">
            Class Selection
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold tracking-wide text-zinc-100">
            Scegli la classe
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Quattro ruoli. Una scelta. Conferma e vieni catapultato sulla
            Network Map.
          </p>
          {faction && (
            <p
              className={`mt-3 inline-flex border px-2 py-1 text-[11px] uppercase tracking-wider ${factionBarClass(faction.id)} border-zinc-600 bg-zinc-900/80`}
            >
              [{factionBarTag(faction.id)}] {faction.label}
            </p>
          )}
        </div>
        <DebugPanel />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((role) => {
          const passives = passivesForRole(role.id)
          const abilities = selectionAbilities(role.id)
          return (
            <button
              key={role.id}
              type="button"
              disabled={session.busy}
              onClick={() => setPending(role)}
              className="flex flex-col gap-4 border border-zinc-700 bg-zinc-950/70 p-4 text-left transition hover:border-amber-500/50 hover:bg-amber-500/5 disabled:opacity-60"
            >
              <div className="flex items-start gap-3">
                {role.iconSrc && (
                  <img
                    src={role.iconSrc}
                    alt=""
                    className="h-16 w-16 shrink-0 object-contain sm:h-20 sm:w-20"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-display text-lg tracking-wide text-zinc-100">
                    {role.label}
                  </p>
                  <p className="mt-1 text-[11px] uppercase tracking-wider text-amber-300/80">
                    {role.style}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                    {role.lore}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                  Passive
                </p>
                <ul className="mt-2 space-y-1.5">
                  {passives
                    .filter((passive) => !passive.iconSrc)
                    .map((passive) => (
                    <li key={passive.id} className="text-xs leading-relaxed text-zinc-300">
                      <span className="text-cyan-300">{passive.name}.</span>{' '}
                      {passive.blurb}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                  Active abilities
                </p>
                <ul className="mt-2 space-y-2">
                  {abilities.map((ability) => (
                    <li
                      key={ability.id}
                      className="flex items-start gap-2 text-xs leading-relaxed text-zinc-300"
                    >
                      {ability.iconSrc && (
                        <img
                          src={ability.iconSrc}
                          alt=""
                          className={`h-8 w-8 shrink-0 object-contain ${ability.glowClass ?? ''}`}
                        />
                      )}
                      <span>
                        <span className="font-medium text-zinc-100">
                          {ability.name}
                        </span>
                        {ability.cooldown ? (
                          <span className="ml-1 text-[10px] uppercase tracking-wider text-zinc-500">
                            · {abilityCooldownLabel(ability)}
                          </span>
                        ) : null}
                        <span className="mt-0.5 block text-zinc-400">
                          {ability.blurb}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          )
        })}
      </div>

      {(error || session.error) && (
        <p className="mt-4 border border-red-500/40 bg-red-500/10 px-3 py-2 text-left text-sm text-red-300">
          {error || session.error}
        </p>
      )}

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={signOut}
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          Esci dall’account
        </button>
      </div>

      {pending && (
        <ConfirmModal
          title={`Conferma ${pending.label}`}
          message={`Arruolarti come ${pending.label}? La classe resta fissa per tutta la durata della partita.`}
          confirmLabel={session.busy ? 'Sincronizzazione…' : 'Conferma classe'}
          busy={session.busy}
          onClose={() => setPending(null)}
          onConfirm={() => void confirmClass()}
        />
      )}

      {session.busy && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/40">
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
        </div>
      )}
    </div>
  )
}
