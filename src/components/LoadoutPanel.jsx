import { useEffect, useMemo, useState } from 'react'
import { Cpu, Database, Package, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  CORE_DATA_ITEM,
  HARDWARE_ITEMS,
  INVENTORY_SLOTS,
  coreDataCount,
  getCatalogItem,
  parseOwnedHardware,
  softwareInventory,
  catalogShortText,
} from '../lib/afterlifeCatalog'
import { afterlifeEquip, afterlifeSell, afterlifeUnequip, afterlifeUseItem } from '../lib/afterlifeApi'
import { equipCooldownRemainingMs, maxHardwareSlots, parseEquippedHardware } from '../lib/hardware'
import { formatRemaining } from '../lib/actions'
import { writeLog } from '../lib/logging'
import { msgItemDeployed } from '../lib/logFormat'
import { useNightTruce } from '../hooks/useNightTruce'
import { useAudio } from '../hooks/useAudio'
import { NIGHT_TRUCE_DENIED } from '../lib/nightTruce'
import { sellRefund } from '../lib/pricing'
import { isMercFaction } from '../lib/constants'
import ConfirmModal from './ConfirmModal'
import ItemModeBadge from './ItemModeBadge'
import UseItemModal from './UseItemModal'

export default function LoadoutPanel({
  open,
  onClose,
  nodes = [],
  slotsByNode = {},
}) {
  const { profile, refreshProfile } = useAuth()
  const { playClick, playSuccess, playError } = useAudio()
  const { locked: actionsLocked } = useNightTruce()
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)
  const [usingItem, setUsingItem] = useState(null)
  const [pendingSale, setPendingSale] = useState(null)
  const [pendingEquip, setPendingEquip] = useState(null)

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [open])

  const inventory = softwareInventory(profile?.inventory)
  const cores = coreDataCount(profile?.inventory)
  const ownedHw = parseOwnedHardware(profile?.owned_hardware)
  const equipped = parseEquippedHardware(profile?.equipped_hardware)
  const maxHw = maxHardwareSlots(profile?.role)
  const cooldownMs = equipCooldownRemainingMs(profile, now)
  const servers = useMemo(
    () => (nodes ?? []).filter((n) => n.type === 'server'),
    [nodes],
  )

  if (!open) return null

  async function run(fn, success) {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const result = await fn()
      if (result?.error) throw result.error
      await refreshProfile()
      if (success) setOk(success)
      playSuccess()
      return result?.data
    } catch (err) {
      playError()
      setError(err.message ?? 'Operazione fallita')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function equip(id) {
    if (cooldownMs > 0) {
      playError()
      setError(`Equip in cooldown (${formatRemaining(cooldownMs)})`)
      return
    }
    if (equipped.includes(id)) return
    if (equipped.length >= maxHw) {
      playError()
      setError('Limite hardware raggiunto. Disinstalla un componente attivo.')
      return
    }
    await run(() => afterlifeEquip(id), 'Hardware equipaggiato')
  }

  async function unequip(id) {
    await run(() => afterlifeUnequip(id), 'Hardware disinstallato')
  }

  async function sell(entry) {
    const item = getCatalogItem(entry.itemId)
    const data = await run(
      () => afterlifeSell(entry.id),
      `Venduto ${item?.name ?? entry.itemId}`,
    )
    if (data && profile) {
      await writeLog({
        eventType: 'afterlife_sell',
        message: `Loadout: venduto ${item?.name ?? entry.itemId} — rimborso ${data.refund} ₵`,
        outcome: 'success',
        actorId: profile.id,
        meta: { item_id: entry.itemId, tone: 'info' },
      })
    }
  }

  async function useSoftware(entry, target) {
    if (actionsLocked) {
      playError()
      setError(NIGHT_TRUCE_DENIED)
      return
    }
    const item = getCatalogItem(entry.itemId)
    const data = await run(() => afterlifeUseItem(entry.id, target), null)
    setUsingItem(null)
    if (!data || !profile) return
    const payload = parseRpcJson(data)
    const nodeName = payload.node_name ?? payload.current_node ?? null
    const slotLabel = payload.slot_label ?? payload.slot ?? null
    const stealthMsg =
      'Wiper Scrubber attivo: Impronta digitale mascherata per 3 minuti.'
    const label =
      item?.id === 'wiper'
        ? stealthMsg
        : item?.id === 'intel'
          ? intelLocationLabel(payload, slotsByNode, servers)
          : msgItemDeployed({
              itemName: item?.name ?? payload.item_name,
              itemId: entry.itemId,
              nodeName,
              slotLabel,
            })
    if (item?.id !== 'wiper') setOk(label)
    if (!payload.logged) {
      await writeLog({
        eventType: 'afterlife_use',
        message: item?.id === 'wiper' ? stealthMsg : item?.id === 'intel' ? label : payload.message || label,
        outcome: 'success',
        nodeId: payload.node_id ?? null,
        actorId: profile.id,
        meta: {
          item_id: entry.itemId,
          item_name: item?.name ?? payload.item_name,
          node_name: nodeName,
          slot: slotLabel,
          tone: 'success',
        },
      })
    }
    if (item?.id === 'wiper') onClose()
  }

  const slots = Array.from({ length: INVENTORY_SLOTS }, (_, i) => inventory[i] ?? null)
  const ownedItems = HARDWARE_ITEMS.filter((h) => ownedHw.includes(h.id))
  const pendingSaleItem = pendingSale ? getCatalogItem(pendingSale.itemId) : null
  const pendingSaleRefund = sellRefund(pendingSaleItem?.basePrice)

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-zinc-950/70 pb-16 sm:items-center md:pb-0">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto border border-zinc-600 bg-zinc-900 p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="text-left">
            <p className="font-display text-xs uppercase tracking-[0.3em] text-fuchsia-400/80">
              Loadout
            </p>
            <h2 className="mt-1 text-lg text-zinc-100">Inventario globale</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Equip e software usabili da qualsiasi nodo, anche in slot.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              playClick()
              onClose()
            }}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Chiudi loadout"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {cooldownMs > 0 && (
          <p className="mb-3 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Equip cooldown: {formatRemaining(cooldownMs)}
          </p>
        )}

        {isMercFaction(profile?.faction) && (
        <section className="mb-5">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-400/80">
            <Database className="h-3.5 w-3.5" /> Oggetti chiave
          </p>
          <div className="flex items-center gap-4 border border-amber-500/50 bg-amber-500/10 px-3 py-3 text-left shadow-[0_0_18px_rgba(245,158,11,0.12)]">
            <div className="relative shrink-0">
              <img
                src={CORE_DATA_ITEM.image}
                alt=""
                className="h-16 w-16 object-contain drop-shadow-[0_0_10px_rgba(245,158,11,0.45)]"
              />
              <span className="absolute -right-1 -bottom-1 min-w-[1.5rem] border border-amber-400/60 bg-zinc-950 px-1.5 py-0.5 text-center font-display text-xs text-amber-200">
                ×{cores}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-amber-100">
                {CORE_DATA_ITEM.name}
                <span className="ml-2 font-display text-lg text-amber-200">
                  ×{cores}
                </span>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                {CORE_DATA_ITEM.blurb}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-600">
                Data Storage · non occupa gli slot software
              </p>
            </div>
          </div>
        </section>
        )}

        <section className="mb-5">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
            <Cpu className="h-3.5 w-3.5" /> Hardware posseduto · {equipped.length}/
            {maxHw}
          </p>
          {ownedItems.length === 0 ? (
            <p className="text-xs text-zinc-600">Nessun hardware. Compralo all’Afterlife.</p>
          ) : (
            <ul className="space-y-2">
              {ownedItems.map((item) => {
                const isOn = equipped.includes(item.id)
                return (
                  <li
                    key={item.id}
                    className={`flex items-center justify-between gap-3 px-3 py-2 transition-all ${
                      isOn
                        ? 'border border-cyan-500/50 bg-cyan-500/5 shadow-[0_0_14px_rgba(34,211,238,0.18)]'
                        : 'border border-zinc-800 bg-zinc-950/60'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {item.image && (
                        <img
                          src={item.image}
                          alt=""
                          className={`h-14 w-14 shrink-0 object-contain transition-all ${
                            isOn
                              ? 'drop-shadow-[0_0_8px_rgba(34,211,238,0.55)]'
                              : 'grayscale brightness-50 contrast-75 opacity-50 hover:grayscale-0 hover:opacity-100 hover:brightness-100 hover:contrast-100'
                          }`}
                        />
                      )}
                      <div className="min-w-0 text-left">
                        <p className="text-sm text-zinc-100">
                          {item.name}
                          {isOn && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-cyan-400">
                              ATTIVO
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-zinc-500">{item.blurb}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy || (!isOn && cooldownMs > 0)}
                      onClick={() => {
                        if (isOn) {
                          void unequip(item.id)
                          return
                        }
                        if (equipped.length >= maxHw) {
                          playError()
                          setError(
                            'Limite hardware raggiunto. Disinstalla un componente attivo.',
                          )
                          return
                        }
                        setPendingEquip(item)
                      }}
                      className={`px-2.5 py-1 text-[10px] uppercase tracking-wider disabled:opacity-40 ${
                        isOn
                          ? 'border border-zinc-600 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200'
                          : 'border border-cyan-500/40 text-cyan-300'
                      }`}
                    >
                      {isOn
                        ? 'Disinstalla'
                        : cooldownMs > 0
                          ? formatRemaining(cooldownMs)
                          : 'Equip'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
            <Package className="h-3.5 w-3.5" /> Software · {inventory.length}/
            {INVENTORY_SLOTS}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {slots.map((entry, i) => {
              const item = entry ? getCatalogItem(entry.itemId) : null
              const shortDesc = catalogShortText(item)
              const refund = item ? sellRefund(item.basePrice) : 0
              return (
                <div
                  key={entry?.id ?? `empty-${i}`}
                  className="flex h-full min-h-[7.5rem] flex-col border border-zinc-800 bg-zinc-950/70 p-2 text-left"
                >
                  {item ? (
                    <>
                      {item.image && (
                        <img
                          src={item.image}
                          alt=""
                          className="mx-auto h-16 w-16 object-contain"
                        />
                      )}
                      <div className="mt-1.5 flex items-start justify-between gap-1">
                        <p className="text-[11px] font-medium text-zinc-200">
                          {item.name}
                        </p>
                        <ItemModeBadge item={item} />
                      </div>
                      {shortDesc && (
                        <p className="mt-2 text-xs text-zinc-400">
                          {shortDesc}
                        </p>
                      )}
                      <div className="mt-auto flex flex-col gap-1.5 pt-2">
                        {item.passive ? (
                          <p className="w-full border border-zinc-800 px-2 py-1.5 text-center text-[9px] uppercase tracking-wider text-zinc-500">
                            Attivazione Automatica
                          </p>
                        ) : (
                          <button
                            type="button"
                            disabled={busy || actionsLocked}
                            onClick={() => {
                              if (item.needsTarget) setUsingItem(entry)
                              else void useSoftware(entry, {})
                            }}
                            className="w-full bg-cyan-500 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-950 hover:bg-cyan-400 disabled:opacity-40"
                          >
                            USA
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setPendingSale(entry)}
                          className="w-full border border-zinc-700 px-2 py-1 text-[9px] uppercase leading-tight tracking-wider text-zinc-500 hover:border-zinc-500 hover:text-zinc-400 disabled:opacity-40"
                        >
                          Vendi (+{refund} ₵)
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-zinc-600">Vuoto</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {error && (
          <p className="mt-3 border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
        {ok && (
          <p className="mt-3 border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {ok}
          </p>
        )}
      </div>

      {pendingEquip && (
        <ConfirmModal
          title="Conferma equip"
          message={`Sei sicuro di voler equipaggiare ${pendingEquip.name}? Questo avvierà il tempo di ricarica per il cambio equipaggiamento.`}
          busy={busy}
          onClose={() => setPendingEquip(null)}
          onConfirm={async () => {
            const item = pendingEquip
            setPendingEquip(null)
            await equip(item.id)
          }}
        />
      )}

      {pendingSale && (
        <ConfirmModal
          title="Conferma vendita"
          message={`Sei sicuro di voler vendere ${pendingSaleItem?.name ?? pendingSale.itemId} al mercato nero? Recupererai ${pendingSaleRefund} ₵ (50% del valore base).`}
          busy={busy}
          onClose={() => setPendingSale(null)}
          onConfirm={async () => {
            const entry = pendingSale
            setPendingSale(null)
            await sell(entry)
          }}
        />
      )}

      {usingItem && (
        <UseItemModal
          entry={usingItem}
          servers={servers}
          slotsByNode={slotsByNode}
          onClose={() => setUsingItem(null)}
          onConfirm={(target) => useSoftware(usingItem, target)}
          busy={busy}
        />
      )}
    </div>
  )
}

function parseRpcJson(data) {
  if (!data) return {}
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return {}
    }
  }
  return data
}

function occupyingServerName(targetId, slotsByNode, servers) {
  if (!targetId) return null
  for (const slots of Object.values(slotsByNode ?? {})) {
    const hit = (slots ?? []).find((s) => s.user_id === targetId)
    if (hit) {
      return servers.find((n) => n.id === hit.node_id)?.name ?? null
    }
  }
  return null
}

function intelLocationLabel(payload, slotsByNode, servers) {
  const name = payload.target_name ?? 'Agente'
  const fromSlot = occupyingServerName(
    payload.target_id,
    slotsByNode,
    servers,
  )
  const serverName =
    fromSlot ||
    (payload.on_server ? payload.node_name || payload.current_node : null)
  if (serverName) return `Target ${name} localizzato su ${serverName}.`
  return `Target ${name} è attualmente nella Global Network (Mappa/Hub).`
}
