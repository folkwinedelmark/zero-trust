import { supabase } from './supabase'
import { assertDaytime } from './nightTruce'

export async function auctionCreate({ startPrice, durationSeconds }) {
  assertDaytime()
  return supabase.rpc('auction_create', {
    p_start_price: startPrice,
    p_duration_seconds: durationSeconds,
  })
}

export async function auctionBid(auctionId, bid) {
  assertDaytime()
  return supabase.rpc('auction_bid', {
    p_auction_id: auctionId,
    p_bid: bid,
  })
}

export async function auctionSweep() {
  return supabase.rpc('auction_sweep')
}

const AUCTION_SELECT = `
  id,
  seller_id,
  start_price,
  highest_bidder_id,
  current_bid,
  end_time,
  status,
  created_at,
  resolved_at,
  highest_bidder:profiles!highest_bidder_id(id, name, faction)
`

export async function fetchAuctions() {
  return supabase
    .from('auctions')
    .select(AUCTION_SELECT)
    .order('end_time', { ascending: true })
}

export async function fetchFactionScores() {
  return supabase.from('faction_scores').select('faction, score, updated_at')
}
