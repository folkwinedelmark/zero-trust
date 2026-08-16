import { useState } from 'react'
import {
  ArrowLeft,
  Cpu,
  Crosshair,
  Gavel,
  Headset,
  Loader2,
  Package,
  ShieldAlert,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDebug } from '../debug/DebugContext'
import { useNightTruce } from '../hooks/useNightTruce'
import { useAudio } from '../hooks/useAudio'
import { NIGHT_TRUCE_DENIED } from '../lib/nightTruce'
import {
  HARDWARE_ITEMS,
  HELPDESK_SERVICES,
  INVENTORY_SLOTS,
  SOFTWARE_ITEMS,
  catalogMarketText,
  parseOwnedHardware,
  softwareInventory,
} from '../lib/afterlifeCatalog'
import { parseEquippedHardware } from '../lib/hardware'
import {
  afterlifeBuy,
  afterlifeHelpdesk,
} from '../lib/afterlifeApi'
import { isEffectActive } from '../lib/abilities'
import { MAX_PA } from '../lib/constants'
import { calculatePrice, clampReputation, priceDeltaLabel } from '../lib/pricing'
import { writeLog } from '../lib/logging'
import GigsBoard from './GigsBoard'
import AuctionHouse from './AuctionHouse'
import ItemModeBadge from './ItemModeBadge'
import ConfirmModal from './ConfirmModal'

export default function AfterlifeView({
  node,
  onBack,
  initialSection = 'helpdesk',
  gigsState = null,
}) {
  const { profile, refreshProfile } = useAuth()
  const debug = useDebug()
  const { playClick, playSuccess, playError } = useAudio()
  const { locked: actionsLocked } = useNightTruce()
  const [section, setSection] = useState(initialSection)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)
  const [purchase, setPurchase] = useState(null)

  const reputation = clampReputation(profile?.reputation ?? 3)
  const heat = profile?.heat ?? 0
  const softwareInv = softwareInventory(profile?.inventory)
  const ownedHw = parseOwnedHardware(profile?.owned_hardware)
  const equipped = parseEquippedHardware(profile?.equipped_hardware)
  const creds = profile?.creds ?? 0
  const blocked = Boolean(profile?.is_blocked)
  const pa = profile?.pa ?? 0
  const paAtMax = pa >= MAX_PA

  function priceOf(base) {
    const raw = calculatePrice(base, reputation)
    return debug.creditCost(raw)
  }

  async function run(label, fn) {
    if (!profile || busy) return
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const result = await fn()
      if (result?.error) throw result.error
      await refreshProfile()
      setOk(label)
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

  function requestBuy(item) {
    playClick()
    if (actionsLocked) {
      playError()
      setError(NIGHT_TRUCE_DENIED)
      return
    }
    if (isEffectActive(profile?.frozen_until)) {
      playError()
      setError('Asset Freeze: non puoi spendere crediti per 24h.')
      return
    }
    const price = priceOf(item.basePrice)
    if (creds < price && !debug.bypassCosts) {
      playError()
      setError(`Servono ${price} ₵`)
      return
    }
    setPurchase({ kind: 'shop', item, price })
  }

  async function executeBuy(item) {
    const data = await run(`Acquistato: ${item.name}`, () => afterlifeBuy(item.id))
    if (data && profile) {
      await writeLog({
        eventType: 'afterlife_buy',
        message: `Afterlife: acquistato ${item.name} — ${data.price ?? priceOf(item.basePrice)} ₵`,
        outcome: 'success',
        nodeId: node?.id ?? null,
        actorId: profile.id,
        meta: { item_id: item.id, tone: 'success', node_name: node?.name },
      })
    }
  }

  function requestHelpdesk(service) {
    playClick()
    if (actionsLocked) {
      playError()
      setError(NIGHT_TRUCE_DENIED)
      return
    }
    if (isEffectActive(profile?.frozen_until)) {
      playError()
      setError('Asset Freeze: non puoi spendere crediti per 24h.')
      return
    }
    if (service.id === 'coffee' && paAtMax) {
      playError()
      setError('Operazione negata: Hai già i PA al massimo.')
      return
    }
    setPurchase({
      kind: 'helpdesk',
      item: service,
      price: priceOf(service.basePrice),
    })
  }

  async function executeHelpdesk(service) {
    const data = await run(`${service.name} eseguito`, () =>
      afterlifeHelpdesk(service.id),
    )
    if (data && profile) {
      await writeLog({
        eventType: 'helpdesk_unlock',
        message: `Helpdesk: ${service.name} — ${data.price ?? priceOf(service.basePrice)} ₵`,
        outcome: 'success',
        nodeId: node?.id ?? null,
        actorId: profile.id,
        meta: { service: service.id, tone: 'success', node_name: node?.name },
      })
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <button
        type="button"
        onClick={() => {
          playClick()
          onBack()
        }}
        className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Network Map
      </button>

      <header className="mb-6">
        <img
          src="/afterlife-banner.png"
          alt="Bar Afterlife"
          className="h-auto w-full rounded-xl border border-purple-900/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
        />
        <p className="mt-4 text-left text-base text-zinc-400">
          Zona Neutrale. Niente ICE. Helpdesk, hardware, software, gigs e
          Auction House. Prezzi shop legati alla reputation (
          {priceDeltaLabel(reputation)}).
        </p>
        <p className="mt-2 text-left text-sm text-zinc-500">
          Inventario hardware/software: pulsante{' '}
          <span className="text-fuchsia-300">Loadout</span> in alto. Usabile da
          qualsiasi nodo, anche in slot.
        </p>
      </header>

      {blocked && (
        <p className="mb-4 flex items-center gap-2 border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          <ShieldAlert className="h-4 w-4" />
          Account BLOCKED. Solo l’Helpdesk può sbloccarti.
        </p>
      )}
      {actionsLocked && (
        <p className="mb-4 border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm uppercase tracking-wider text-red-300">
          Night Truce · acquisti Hub disabilitati fino alle 08:00
        </p>
      )}

      <nav className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { id: 'helpdesk', label: 'IT Helpdesk', icon: Headset },
          { id: 'hardware', label: 'Hardware', icon: Cpu },
          { id: 'software', label: 'Software', icon: Package },
          { id: 'gigs', label: 'GIGS BOARD', icon: Crosshair },
          { id: 'auctions', label: 'Auction House', icon: Gavel },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              playClick()
              setSection(tab.id)
            }}
            className={`inline-flex items-center justify-center gap-2 border px-3 py-2 text-sm uppercase tracking-wider transition ${
              section === tab.id
                ? 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-200'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
          </button>
        ))}
      </nav>

      {section === 'helpdesk' && (
        <Section title="IT Helpdesk" subtitle="Trigger istantanei">
          {HELPDESK_SERVICES.map((item) => (
            <ShopRow
              key={item.id}
              item={item}
              price={priceOf(item.basePrice)}
              busy={busy}
              disabled={
                busy ||
                actionsLocked ||
                (item.id === 'unlock' && !blocked) ||
                (item.id === 'wipe' && heat <= 0) ||
                (item.id === 'coffee' && paAtMax)
              }
              cta={
                actionsLocked
                  ? 'Night Truce'
                  : item.id === 'coffee' && paAtMax
                  ? 'PA al massimo'
                  : item.id === 'unlock'
                    ? 'Sblocca'
                    : 'Attiva'
              }
              onBuy={() => requestHelpdesk(item)}
            />
          ))}
        </Section>
      )}

      {section === 'hardware' && (
        <Section
          title="Hardware Store"
          subtitle="Compra qui, equipaggia dal Loadout"
        >
          {HARDWARE_ITEMS.map((item) => {
            const owned = ownedHw.includes(item.id)
            return (
              <ShopRow
                key={item.id}
                item={item}
                price={priceOf(item.basePrice)}
                busy={busy}
                owned={owned}
                equipped={equipped.includes(item.id)}
                disabled={busy || blocked || owned || actionsLocked}
                cta={owned ? 'Posseduto' : actionsLocked ? 'Night Truce' : 'Compra'}
                onBuy={() => requestBuy(item)}
              />
            )
          })}
        </Section>
      )}

      {section === 'software' && (
        <Section
          title="Software Market"
          subtitle={`${softwareInv.length}/${INVENTORY_SLOTS} slot inventario`}
        >
          {SOFTWARE_ITEMS.map((item) => (
            <ShopRow
              key={item.id}
              item={item}
              price={priceOf(item.basePrice)}
              busy={busy}
              disabled={
                busy || blocked || softwareInv.length >= INVENTORY_SLOTS || actionsLocked
              }
              cta={actionsLocked ? 'Night Truce' : 'Compra'}
              onBuy={() => requestBuy(item)}
            />
          ))}
        </Section>
      )}

      {section === 'gigs' && (
        <GigsBoard
          node={node}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setOk={setOk}
          gigsState={gigsState}
        />
      )}

      {section === 'auctions' && (
        <AuctionHouse
          node={node}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setOk={setOk}
        />
      )}

      {error && (
        <p className="mt-4 border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {ok && (
        <p className="mt-4 border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {ok}
        </p>
      )}

      {purchase && (
        <ConfirmModal
          title="Conferma acquisto"
          message={`Sei sicuro di voler acquistare ${purchase.item.name} per ${purchase.price} ₵?`}
          confirmLabel="Acquista"
          busy={busy}
          onClose={() => setPurchase(null)}
          onConfirm={async () => {
            const pending = purchase
            setPurchase(null)
            if (pending.kind === 'helpdesk') await executeHelpdesk(pending.item)
            else await executeBuy(pending.item)
          }}
        />
      )}
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <section className="border border-zinc-700/80 bg-zinc-900/50 p-4">
      <div className="mb-4 text-left">
        <h2 className="font-display text-base uppercase tracking-[0.2em] text-zinc-300">
          {title}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function ShopRow({
  item,
  price,
  busy,
  disabled,
  cta,
  owned,
  equipped,
  onBuy,
}) {
  return (
    <div className="flex flex-col gap-3 border border-zinc-800 bg-zinc-950/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        {item.image && (
          <img
            src={item.image}
            alt=""
            className="h-16 w-16 shrink-0 rounded-md object-contain sm:h-20 sm:w-20"
          />
        )}
        <div className="text-left">
          <p className="text-base text-zinc-100">
            {item.name}
            {equipped && (
              <span className="ml-2 text-xs uppercase tracking-wider text-cyan-400">
                EQUIP
              </span>
            )}
            <ItemModeBadge item={item} className="ml-2 align-middle" />
          </p>
          <MarketBlurb text={catalogMarketText(item)} />
          <p className="mt-1 text-sm text-amber-200/90">
            {price} ₵
            {price !== item.basePrice ? (
              <span className="ml-1 text-zinc-600">base {item.basePrice}</span>
            ) : null}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onBuy}
          className="inline-flex items-center gap-1.5 bg-fuchsia-600 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-zinc-950 hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {owned ? 'Posseduto' : cta}
        </button>
      </div>
    </div>
  )
}

function MarketBlurb({ text }) {
  if (!text) return null
  const parts = String(text).split(/(\*\*[^*]+?\*\*|Attivo:|Passivo:|Effetto:)/)
  return (
    <p className="mt-1 text-sm leading-relaxed text-zinc-400">
      {parts.map((part, index) => {
        const markdown = part.match(/^\*\*(.+)\*\*$/)
        if (markdown) {
          return (
            <strong key={index} className="font-semibold text-zinc-200">
              {markdown[1]}
            </strong>
          )
        }
        if (part === 'Attivo:' || part === 'Passivo:' || part === 'Effetto:') {
          return (
            <strong key={index} className="font-semibold text-zinc-200">
              {part}
            </strong>
          )
        }
        return part
      })}
    </p>
  )
}
