import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Crosshair,
  IdCard,
  Loader2,
  Shield,
  Sparkles,
  Timer,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAbilities } from '../hooks/useAbilities'
import { formatRemaining, isHuntableSlot } from '../lib/actions'
import { isSlotLocked } from '../lib/hardware'
import {
  ABILITY_DAILY_MS,
  ABILITY_WEEKLY_MS,
  EXECUTION_CONTEXTUAL,
  EXECUTION_GLOBAL,
  abilitiesByExecution,
  abilityConfirmCopy,
  isBackdoorRestricted,
  passivesForRole,
} from '../lib/abilities'
import {
  factionBarClass,
  factionBarTag,
  factionById,
  factionLore,
  roleById,
  roleLabel,
} from '../lib/constants'
import { useNightTruce } from '../hooks/useNightTruce'
import { useAudio } from '../hooks/useAudio'
import PaCost from './PaCost'
import ConfirmModal from './ConfirmModal'

export default function CharacterModal({
  open,
  onClose,
  nodes = [],
  slotsByNode = {},
  onOpenArchive = null,
}) {
  const abilities = useAbilities()
  const { playClick } = useAudio()
  const { locked: actionsLocked } = useNightTruce()
  const [now, setNow] = useState(Date.now())
  const [pending, setPending] = useState(null)
  const [confirmJob, setConfirmJob] = useState(null)
  const [ok, setOk] = useState(null)

  useEffect(() => {
    if (!open) return undefined
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [open])

  const servers = useMemo(
    () => (nodes ?? []).filter((n) => n.type === 'server'),
    [nodes],
  )

  const profile = abilities.profile
  const faction = factionById(profile?.faction)
  const role = roleById(abilities.role)
  const lore = factionLore(profile?.faction)
  const passives = passivesForRole(abilities.role)
  const globalAbilities = abilitiesByExecution(abilities.role, EXECUTION_GLOBAL)
  const tacticalAbilities = abilitiesByExecution(
    abilities.role,
    EXECUTION_CONTEXTUAL,
  )

  if (!open) return null

  function close() {
    playClick()
    onClose()
  }

  async function run(ability, targets) {
    setOk(null)
    const { error } = await abilities.activate(ability.id, targets)
    setConfirmJob(null)
    if (error) return false
    setPending(null)
    if (ability.id === 'background_check' || ability.id === 'doxxing') {
      setOk('Report acquisito. Dati disponibili nell\'Archivio Intel.')
    } else if (ability.id === 'immunity') {
      setOk(
        'Scudo Legale attivato: la prossima operazione base sarà protetta.',
      )
    } else {
      setOk(`${ability.name} attivata.`)
    }
    return true
  }

  function queueAbility(ability, targets = {}) {
    abilities.setError(null)
    setOk(null)
    setConfirmJob({ ability, targets })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-end bg-zinc-950/70">
      <button
        type="button"
        className="h-full flex-1 cursor-default"
        aria-label="Chiudi profilo"
        onClick={close}
      />
      <aside className="flex h-full w-full max-w-md flex-col border-l border-zinc-700 bg-zinc-900 pb-16 shadow-2xl md:pb-0">
        <div className="relative isolate h-56 shrink-0 overflow-hidden border-b border-zinc-800">
          {faction?.banner && (
            <img
              src={faction.banner}
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/50 to-transparent" />
          <div className="relative flex h-full flex-col justify-between p-6">
            <div className="flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="text-zinc-200 hover:text-white"
                aria-label="Chiudi"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-w-0 text-left">
              <p className="font-display text-xs uppercase tracking-[0.3em] text-amber-400/80">
                Profilo Personaggio
              </p>
              <h2 className="font-display mt-1 flex items-center gap-2 text-xl text-zinc-100">
                <IdCard className="h-4 w-4 shrink-0 text-amber-300" />
                <span className="truncate">{profile?.name ?? 'Agente'}</span>
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {faction && (
                  <span
                    className={`inline-flex items-center gap-1.5 border border-zinc-700 bg-zinc-950/80 px-2 py-0.5 text-[11px] uppercase tracking-wider ${factionBarClass(faction.id)}`}
                  >
                    {faction.logo && (
                      <img
                        src={faction.logo}
                        alt=""
                        className="h-6 w-6 rounded-sm object-contain"
                      />
                    )}
                    [{factionBarTag(faction.id)}]
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 border border-zinc-700 bg-zinc-950/80 px-2 py-0.5 text-[11px] uppercase tracking-wider text-zinc-300">
                  {role?.iconSrc ? (
                    <img
                      src={role.iconSrc}
                      alt=""
                      className="h-6 w-6 rounded-sm object-contain"
                    />
                  ) : (
                    <IdCard className="h-3 w-3" strokeWidth={1.75} />
                  )}
                  {abilities.role ? roleLabel(abilities.role) : 'Nessuna classe'}
                </span>
                {abilities.role ? (
                  <PaCost cost={abilities.profile?.pa ?? 0} className="text-xs" />
                ) : null}
              </div>
              {lore && (
                <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                  {lore}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {abilities.error && (
            <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {abilities.error}
            </p>
          )}
          {actionsLocked && (
            <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs uppercase tracking-wider text-red-300">
              Night Truce · abilità disabilitate fino alle 08:00
            </p>
          )}
          {ok && (
            <p className="border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {ok}
            </p>
          )}

          {!abilities.role ? (
            <p className="text-base text-zinc-500">
              Nessuna classe assegnata.
            </p>
          ) : (
            <>
              {passives.length > 0 && (
                <SheetSection
                  icon={Shield}
                  title="Abilità Passive"
                  accent="text-emerald-300"
                >
                  {passives.map((passive) => (
                    <PassiveCard key={passive.id} passive={passive} />
                  ))}
                </SheetSection>
              )}

              <SheetSection
                icon={Sparkles}
                title="Abilità Globali"
                accent="text-amber-300"
              >
                {abilities.role === 'analyst' && onOpenArchive && (
                  <ArchiveIntelCard
                    onOpen={() => {
                      playClick()
                      onOpenArchive()
                    }}
                  />
                )}
                {globalAbilities.length === 0 &&
                !(abilities.role === 'analyst' && onOpenArchive) ? (
                  <p className="text-sm text-zinc-500">
                    Nessuna abilità globale per questa classe.
                  </p>
                ) : (
                  globalAbilities.map((ability) => {
                    const cd = abilities.remainingMs(ability.id, now)
                    const ready = abilities.canUse(ability.id, now)
                    return (
                      <GlobalAbilityCard
                        key={ability.id}
                        ability={ability}
                        cd={cd}
                        ready={ready}
                        busy={abilities.busy}
                        pendingId={pending?.id}
                        actionsLocked={actionsLocked}
                        onActivate={() => {
                          abilities.setError(null)
                          setOk(null)
                          if (ability.target === 'none') {
                            queueAbility(ability, {})
                          } else {
                            setPending(ability)
                          }
                        }}
                      />
                    )
                  })
                )}
              </SheetSection>

              {tacticalAbilities.length > 0 && (
                <SheetSection
                  icon={Crosshair}
                  title="Abilità Tattiche"
                  accent="text-zinc-400"
                >
                  {tacticalAbilities.map((ability) => (
                    <TacticalAbilityCard
                      key={ability.id}
                      ability={ability}
                      cd={abilities.remainingMs(ability.id, now)}
                    />
                  ))}
                </SheetSection>
              )}
            </>
          )}
        </div>
      </aside>

      {pending && (
        <AbilityTargetModal
          ability={pending}
          servers={servers}
          slotsByNode={slotsByNode}
          profileId={abilities.profile?.id}
          busy={abilities.busy || actionsLocked || Boolean(confirmJob)}
          onClose={() => setPending(null)}
          onConfirm={(targets) => queueAbility(pending, targets)}
        />
      )}

      {confirmJob && (
        <ConfirmModal
          title={abilityConfirmCopy(confirmJob.ability).title}
          message={abilityConfirmCopy(confirmJob.ability).message}
          confirmLabel={abilityConfirmCopy(confirmJob.ability).confirmLabel}
          busy={abilities.busy}
          onClose={() => setConfirmJob(null)}
          onConfirm={async () => {
            await run(confirmJob.ability, confirmJob.targets)
          }}
        />
      )}
    </div>
  )
}

function SheetSection({ icon: Icon, title, accent, children }) {
  return (
    <section>
      <h3
        className={`mb-3 flex items-center gap-2 font-display text-xs uppercase tracking-[0.22em] ${accent}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function PassiveCard({ passive }) {
  return (
    <div className="group border border-emerald-900/50 bg-emerald-950/20 p-4">
      <div className="flex flex-row items-start gap-4">
        {passive.iconSrc ? (
          <img
            src={passive.iconSrc}
            alt=""
            className={`h-14 w-14 shrink-0 object-contain ${passive.glowClass ?? ''}`}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-emerald-100">{passive.name}</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">
            {passive.blurb}
          </p>
          {passive.usageHint && (
            <p className="mt-3 inline-flex border border-emerald-800/70 bg-emerald-950/40 px-2 py-1 text-[10px] uppercase tracking-wider text-emerald-400/80">
              [ {passive.usageHint} ]
            </p>
          )}
          <p className="mt-2 text-[10px] uppercase tracking-wider text-emerald-500/70">
            Sempre attiva
          </p>
        </div>
      </div>
    </div>
  )
}

function ArchiveIntelCard({ onOpen }) {
  return (
    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-left">
          <p className="flex items-center gap-2 text-base font-medium text-zinc-100">
            <Archive className="h-4 w-4 shrink-0 text-cyan-300" />
            Archivio Intel
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">
            Accesso al database crittografato. Contiene i report persistenti dei
            tuoi Background Check e Doxxing.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/20"
        >
          Apri Archivio
        </button>
      </div>
    </div>
  )
}

function GlobalAbilityCard({
  ability,
  cd,
  ready,
  busy,
  pendingId,
  actionsLocked,
  onActivate,
}) {
  return (
    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="flex flex-row items-start gap-4">
        {ability.iconSrc ? (
          <img
            src={ability.iconSrc}
            alt=""
            className={`h-14 w-14 shrink-0 object-contain ${ability.glowClass ?? ''}`}
          />
        ) : null}
        <div className="min-w-0 flex-1 text-left">
          <p className="text-base font-medium text-zinc-100">{ability.name}</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">
            {ability.blurb}
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-500">
            <PaCost cost={ability.paCost} className="text-xs" />
            <span>{ability.cooldown === 'weekly' ? '3 giorni' : 'Daily'}</span>
          </p>
        </div>
        <button
          type="button"
          disabled={!ready || busy || actionsLocked}
          onClick={onActivate}
          className="shrink-0 border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && pendingId === ability.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : cd > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {formatRemaining(cd)}
            </span>
          ) : actionsLocked ? (
            'Offline'
          ) : (
            'Esegui'
          )}
        </button>
      </div>
      {cd > 0 && (
        <CooldownBar ability={ability} cd={cd} accent="bg-amber-500/70" />
      )}
    </div>
  )
}

function TacticalAbilityCard({ ability, cd }) {
  return (
    <div className="border border-zinc-800/80 bg-zinc-950/40 p-4 opacity-80">
      <div className="flex flex-row items-start gap-4">
        {ability.iconSrc ? (
          <img
            src={ability.iconSrc}
            alt=""
            className={`h-12 w-12 shrink-0 object-contain ${ability.glowClass ?? ''}`}
          />
        ) : null}
        <div className="min-w-0 flex-1 text-left">
          <p className="text-base font-medium text-zinc-300">{ability.name}</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-500">
            {ability.blurb}
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-600">
            <PaCost cost={ability.paCost} className="text-xs text-zinc-500" />
            <span>{ability.cooldown === 'weekly' ? '3 giorni' : 'Daily'}</span>
          </p>
        </div>
        <span className="shrink-0 border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
          {cd > 0 ? formatRemaining(cd) : 'Info'}
        </span>
      </div>
      {ability.usageHint && (
        <p className="mt-3 inline-flex border border-zinc-700/80 bg-zinc-900/80 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
          [ {ability.usageHint} ]
        </p>
      )}
      {cd > 0 && (
        <CooldownBar ability={ability} cd={cd} accent="bg-zinc-600" />
      )}
    </div>
  )
}

function CooldownBar({ ability, cd, accent }) {
  const total = ability.cooldown === 'weekly' ? ABILITY_WEEKLY_MS : ABILITY_DAILY_MS
  return (
    <div className="mt-3 h-1 overflow-hidden bg-zinc-800">
      <div
        className={`h-full ${accent}`}
        style={{
          width: `${Math.min(100, Math.round((1 - cd / total) * 100))}%`,
        }}
      />
    </div>
  )
}

function AbilityTargetModal({
  ability,
  servers,
  slotsByNode,
  profileId,
  busy,
  onClose,
  onConfirm,
}) {
  const [players, setPlayers] = useState([])
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [nodeId, setNodeId] = useState(servers[0]?.id ?? '')
  const [slotId, setSlotId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [iceSign, setIceSign] = useState(1)

  const needsPlayer = ability.target === 'player'
  const needsNode =
    ability.target === 'node' ||
    ability.target === 'node_ice' ||
    ability.target === 'full_node'
  const needsSlot =
    ability.target === 'occupied_slot' ||
    ability.target === 'empty_slot' ||
    ability.target === 'any_slot'

  const slots = slotsByNode[nodeId] ?? []
  const slotChoices = slots.filter((s) => {
    if (isBackdoorRestricted(s, { role: ability.role, id: profileId }) && ability.target === 'empty_slot') {
      return false
    }
    if (ability.target === 'empty_slot') {
      return !s.user_id && !s.is_decoy && !isSlotLocked(s)
    }
    if (ability.target === 'occupied_slot') {
      return isHuntableSlot(s) && s.user_id !== profileId
    }
    return true
  })

  useEffect(() => {
    if (!needsPlayer || !profileId) return undefined
    let cancelled = false
    setLoadingPlayers(true)
    supabase
      .from('profiles')
      .select('id, name')
      .neq('id', profileId)
      .order('name')
      .then(({ data }) => {
        if (!cancelled) {
          setPlayers(data ?? [])
          setLoadingPlayers(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [needsPlayer, profileId])

  const canConfirm =
    (needsPlayer && targetId) ||
    (needsNode && nodeId) ||
    (needsSlot && slotId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 px-4">
      <div className="w-full max-w-md border border-zinc-600 bg-zinc-900 p-5">
        <p className="font-display flex items-center gap-3 text-sm uppercase tracking-wider text-amber-300">
          {ability.iconSrc ? (
            <img
              src={ability.iconSrc}
              alt=""
              className={`h-10 w-10 object-contain ${ability.glowClass ?? ''}`}
            />
          ) : null}
          {ability.name}
        </p>
        <p className="mt-1 text-xs text-zinc-500">{ability.blurb}</p>
        <div className="mt-2">
          <PaCost cost={ability.paCost} className="text-xs" />
        </div>

        {needsPlayer && (
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={busy || loadingPlayers}
            className="mt-4 w-full border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/70"
          >
            <option value="">
              {loadingPlayers ? 'Scan agenti…' : 'Seleziona un agente'}
            </option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        {(needsNode || needsSlot) && (
          <select
            value={nodeId}
            onChange={(e) => {
              setNodeId(e.target.value)
              setSlotId('')
            }}
            disabled={busy}
            className="mt-4 w-full border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/70"
          >
            {servers.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        )}

        {ability.target === 'node_ice' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setIceSign(1)}
              className={`border px-3 py-2 text-xs uppercase tracking-wider ${
                iceSign > 0
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                  : 'border-zinc-700 text-zinc-400'
              }`}
            >
              ICE +5%
            </button>
            <button
              type="button"
              onClick={() => setIceSign(-1)}
              className={`border px-3 py-2 text-xs uppercase tracking-wider ${
                iceSign < 0
                  ? 'border-red-500/60 bg-red-500/10 text-red-200'
                  : 'border-zinc-700 text-zinc-400'
              }`}
            >
              ICE −5%
            </button>
          </div>
        )}

        {needsSlot && (
          <select
            value={slotId}
            onChange={(e) => setSlotId(e.target.value)}
            disabled={busy}
            className="mt-3 w-full border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/70"
          >
            <option value="">Seleziona slot</option>
            {slotChoices.map((s) => (
              <option key={s.id} value={s.id}>
                Slot {s.slot_id}
                {s.is_decoy ? ' · Decoy' : s.user_id ? ' · Occupato' : ' · Libero'}
                {s.is_backdoor ? ' · Backdoor' : ''}
              </option>
            ))}
          </select>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
          >
            Annulla
          </button>
          <button
            type="button"
            disabled={busy || !canConfirm}
            onClick={() =>
              onConfirm({
                targetId: targetId || null,
                targetSlotId: slotId || null,
                nodeId: nodeId || null,
                iceSign,
              })
            }
            className="border border-amber-500/40 px-3 py-1.5 text-xs uppercase tracking-wider text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
          >
            Conferma
          </button>
        </div>
      </div>
    </div>
  )
}
