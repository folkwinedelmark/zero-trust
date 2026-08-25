import { useEffect, useMemo, useState } from 'react'
import { Gavel, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isEffectActive } from '../lib/abilities'
import { formatRemaining } from '../lib/actions'
import {
  coreDataCount,
  CORE_DATA_ITEM,
} from '../lib/afterlifeCatalog'
import {
  AUCTION_ANON_SELLER,
  AUCTION_DURATIONS,
  AUCTION_MAX_PRICE,
  AUCTION_MIN_PRICE,
  auctionStatusLabel,
  canPlaceOffer,
  nextBidMin,
} from '../lib/auctions'
import { auctionBid, auctionCreate } from '../lib/auctionsApi'
import { isMercFaction } from '../lib/constants'
import { writeLog } from '../lib/logging'
import { useAuctions } from '../hooks/useAuctions'
import { useNightTruce } from '../hooks/useNightTruce'
import { useAudio } from '../hooks/useAudio'
import { NIGHT_TRUCE_DENIED } from '../lib/nightTruce'
import ConfirmModal from './ConfirmModal'

export default function AuctionHouse({
  node,
  busy,
  setBusy,
  setError,
  setOk,
}) {
  const { profile, refreshProfile } = useAuth()
  const { playSuccess, playError } = useAudio()
  const { locked: actionsLocked } = useNightTruce()
  const state = useAuctions()
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const faction = profile?.faction
  const merc = isMercFaction(faction)
  const cores = coreDataCount(profile?.inventory)
  const creds = Number(profile?.creds)
  const blocked = Boolean(profile?.is_blocked)
  const frozen = isEffectActive(profile?.frozen_until)

  async function run(label, fn, log) {
    if (!profile || busy) return null
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const result = await fn()
      if (result?.error) throw result.error
      await refreshProfile()
      await state.reload()
      setOk(label)
      playSuccess()
      if (log && profile) {
        await writeLog({
          eventType: log.eventType,
          message: log.message,
          outcome: log.outcome ?? 'success',
          nodeId: node?.id ?? null,
          actorId: profile.id,
          meta: { tone: log.outcome ?? 'success', node_name: node?.name },
        })
      }
      return result?.data
    } catch (err) {
      playError()
      setError(err.message ?? 'Operazione fallita')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate({ startPrice, durationSeconds }) {
    if (actionsLocked) {
      playError()
      setError(NIGHT_TRUCE_DENIED)
      return null
    }
    if (!merc) {
      playError()
      setError('Solo i Mercenary possono creare aste.')
      return null
    }
    if (cores < 1) {
      playError()
      setError('Serve 1× Core Data in inventario.')
      return null
    }
    return run(`Asta pubblicata · base ${startPrice} ₵`, () =>
      auctionCreate({ startPrice, durationSeconds }),
    )
  }

  async function handleBid(auction, bid) {
    if (actionsLocked) {
      playError()
      setError(NIGHT_TRUCE_DENIED)
      return null
    }
    if (frozen) {
      playError()
      setError('Asset Freeze: non puoi spendere crediti per 24h.')
      return null
    }
    const amount = Number(bid)
    return run(`Offerta ${amount} ₵ in escrow`, () =>
      auctionBid(auction.id, amount),
    )
  }

  const openLive = useMemo(
    () =>
      [...state.openBoard].sort(
        (a, b) => new Date(a.end_time) - new Date(b.end_time),
      ),
    [state.openBoard],
  )

  return (
    <section className="border border-zinc-700/80 bg-zinc-900/50 p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-left">
          <h2 className="font-display flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-zinc-300">
            <Gavel className="h-4 w-4 text-amber-300" />
            Auction House
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Core Data sul Black Market. Escrow immediato, rimborso se superati.
            I Mercenary possono speculare: vincono il Core Data, non i VP.
          </p>
        </div>
        <FactionScoreBar scores={state.scoreByFaction} />
      </div>

      {state.error && (
        <p className="mb-3 border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      {merc && (
        <CreateAuctionForm
          cores={cores}
          blocked={blocked}
          busy={busy || actionsLocked}
          onCreate={handleCreate}
        />
      )}

      {!merc && (
        <p className="mb-4 border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-500">
          L’offerta scala i crediti all’istante. Se vieni superato, l’escrow
          torna sul conto. Corp/Rebel: +1 VP. Merc: recuperano il Core Data.
        </p>
      )}

      <h3 className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
        Aste live
      </h3>
      {state.loading && openLive.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Collegamento al mercato nero…
        </p>
      ) : openLive.length === 0 ? (
        <p className="text-xs text-zinc-600">Nessuna asta aperta.</p>
      ) : (
        <div className="space-y-3">
          {openLive.map((auction) => (
            <AuctionRow
              key={auction.id}
              auction={auction}
              now={now}
              userId={state.userId}
              creds={creds}
              onBid={handleBid}
              locked={actionsLocked}
            />
          ))}
        </div>
      )}

      {state.mine.some((a) => a.status !== 'OPEN') && (
        <div className="mt-5">
          <h3 className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
            Le tue aste chiuse
          </h3>
          <div className="space-y-2">
            {state.mine
              .filter((a) => a.status !== 'OPEN')
              .slice(0, 6)
              .map((auction) => (
                <p
                  key={auction.id}
                  className="border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-500"
                >
                  {auctionStatusLabel(auction.status)}
                  {' · '}
                  <span className="text-slate-500">{AUCTION_ANON_SELLER}</span>
                  {' · '}
                  {auction.current_bid > 0
                    ? `${auction.current_bid} ₵`
                    : `base ${auction.start_price} ₵`}
                  {auction.highest_bidder?.name
                    ? ` · ${auction.highest_bidder.name}`
                    : ''}
                </p>
              ))}
          </div>
        </div>
      )}
    </section>
  )
}

function FactionScoreBar({ scores }) {
  return (
    <div className="flex gap-2 text-[10px] uppercase tracking-wider">
      <ScoreChip label="Corp" value={scores.security ?? 0} tone="text-cyan-300" />
      <ScoreChip
        label="Rebel"
        value={scores.hacktivist ?? 0}
        tone="text-fuchsia-300"
      />
    </div>
  )
}

function ScoreChip({ label, value, tone }) {
  return (
    <span className="border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-zinc-500">
      {label}{' '}
      <span className={tone}>{value} VP</span>
    </span>
  )
}

function CreateAuctionForm({ cores, blocked, busy, onCreate }) {
  const { playClick } = useAudio()
  const [price, setPrice] = useState(String(AUCTION_MIN_PRICE * 5))
  const [duration, setDuration] = useState(AUCTION_DURATIONS[1].seconds)
  const [confirmOpen, setConfirmOpen] = useState(false)

  function submit(e) {
    e.preventDefault()
    const startPrice = Number(price)
    if (!Number.isFinite(startPrice) || startPrice <= 0) return
    playClick()
    setConfirmOpen(true)
  }

  const disabled = busy || blocked || cores < 1

  return (
    <>
    <form
      onSubmit={submit}
      className="mb-4 border border-amber-500/30 bg-amber-500/5 p-3"
    >
      <p className="text-xs text-amber-100/90">
        Inventario: {cores}× {CORE_DATA_ITEM.name}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-left text-[10px] uppercase tracking-wider text-zinc-500">
          Prezzo di partenza
          <input
            type="number"
            min={AUCTION_MIN_PRICE}
            max={AUCTION_MAX_PRICE}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="mt-1 w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
          />
        </label>
        <label className="flex-1 text-left text-[10px] uppercase tracking-wider text-zinc-500">
          Durata
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="mt-1 w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
          >
            {AUCTION_DURATIONS.map((d) => (
              <option key={d.id} value={d.seconds}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={disabled}
          className="bg-amber-500 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Metti all’asta
        </button>
      </div>
    </form>
      {confirmOpen && (
        <ConfirmModal
          title="Avvia asta"
          message="Sei sicuro di voler avviare l'asta? Verrà consumato 1x Core Data dal tuo inventario e non potrai annullare l'operazione."
          confirmLabel="Avvia asta"
          busy={busy}
          onClose={() => setConfirmOpen(false)}
          onConfirm={async () => {
            setConfirmOpen(false)
            const startPrice = Number(price)
            if (!Number.isFinite(startPrice) || startPrice <= 0) return
            await onCreate({ startPrice, durationSeconds: duration })
          }}
        />
      )}
    </>
  )
}

function AuctionRow({ auction, now, userId, creds, onBid, locked = false }) {
  const { playClick } = useAudio()
  const [bidAmount, setBidAmount] = useState(() => String(nextBidMin(auction)))

  useEffect(() => {
    setBidAmount(String(nextBidMin(auction)))
  }, [auction.current_bid, auction.start_price])

  const remaining = Math.max(0, new Date(auction.end_time).getTime() - now)
  const bidderName = auction.highest_bidder?.name ?? null
  const isSeller = auction.seller_id === userId
  const isWinning = auction.highest_bidder_id === userId
  const amount = Number(bidAmount)
  const offerEnabled =
    !locked && !isSeller && canPlaceOffer(bidAmount, creds, auction)

  return (
    <div className="border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-left">
          <p className="text-sm text-zinc-100">
            {CORE_DATA_ITEM.name}
            {isWinning && (
              <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-400">
                La tua offerta
              </span>
            )}
            {isSeller && (
              <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400">
                Tua asta
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Venditore: {AUCTION_ANON_SELLER}
          </p>
          <p className="mt-1 text-xs text-amber-200/90">
            {Number(auction.current_bid) > 0
              ? `Offerta attuale ${auction.current_bid} ₵`
              : `Base ${auction.start_price} ₵`}
            {bidderName ? ` · ${bidderName}` : ' · nessuna offerta'}
          </p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-zinc-500">
            Chiude tra {formatRemaining(remaining)}
          </p>
        </div>

        {isSeller ? (
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">
            In vendita
          </p>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!offerEnabled) return
              playClick()
              void onBid(auction, amount)
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
              className="w-24 border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
              aria-label="Importo offerta"
            />
            <button
              type="submit"
              disabled={!offerEnabled}
              className="bg-fuchsia-600 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-950 hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Offerta
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
