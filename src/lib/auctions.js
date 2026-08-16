/** Auction House — Core Data, escrow, Faction Score. */

export const AUCTION_MIN_PRICE = 10
export const AUCTION_MAX_PRICE = 5000

export const AUCTION_DURATIONS = [
  { id: '15m', seconds: 15 * 60, label: '15 min' },
  { id: '1h', seconds: 60 * 60, label: '1 ora' },
  { id: '6h', seconds: 6 * 60 * 60, label: '6 ore' },
  { id: '24h', seconds: 24 * 60 * 60, label: '24 ore' },
]

export function nextBidMin(auction) {
  const current = Number(auction?.current_bid)
  if (Number.isFinite(current) && current > 0) return current + 1
  const start = Number(auction?.start_price)
  return Number.isFinite(start) && start > 0 ? start : AUCTION_MIN_PRICE
}

/**
 * OFFERTA è abilitata solo se:
 * - amount > 0
 * - creds >= amount
 * - amount > current_bid, oppure amount >= start_price se non c'è offerta
 */
export function canPlaceOffer(bidAmount, creds, auction) {
  const amount = Number(bidAmount)
  const userCreds = Number(creds)
  if (!Number.isFinite(amount) || amount <= 0) return false
  if (!Number.isFinite(userCreds) || userCreds < amount) return false

  const currentRaw = auction?.current_bid
  const currentBid = Number(currentRaw)
  const hasCurrent =
    currentRaw !== null &&
    currentRaw !== undefined &&
    currentRaw !== '' &&
    Number.isFinite(currentBid) &&
    currentBid > 0

  if (hasCurrent) return amount > currentBid

  const startPrice = Number(auction?.start_price)
  const floor = Number.isFinite(startPrice) && startPrice > 0 ? startPrice : 0
  return amount >= floor
}

export function auctionStatusLabel(status) {
  if (status === 'SOLD') return 'Venduta'
  if (status === 'EXPIRED') return 'Scaduta'
  return 'Aperta'
}
