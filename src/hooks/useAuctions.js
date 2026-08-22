import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { WORLD_REFRESH_EVENT } from '../lib/constants'
import { supabase } from '../lib/supabase'
import {
  auctionSweep,
  fetchAuctions,
  fetchFactionScores,
} from '../lib/auctionsApi'

const SWEEP_MS = 15_000

/**
 * Aste visibili + Faction Score. Sweep periodico a end_time.
 */
export function useAuctions() {
  const { user, refreshProfile } = useAuth()
  const userId = user?.id ?? null
  const refreshRef = useRef(refreshProfile)
  refreshRef.current = refreshProfile

  const [auctions, setAuctions] = useState([])
  const [scores, setScores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!userId) {
      setAuctions([])
      setScores([])
      setLoading(false)
      return
    }

    setError(null)
    try {
      await auctionSweep()
    } catch {
      // RPC assente se phase33 non è ancora applicata
    }

    const [auctionsRes, scoresRes] = await Promise.all([
      fetchAuctions(),
      fetchFactionScores(),
    ])

    if (auctionsRes.error) {
      setError(auctionsRes.error.message)
      setLoading(false)
      return
    }

    setAuctions(auctionsRes.data ?? [])
    setScores(scoresRes.data ?? [])
    setLoading(false)
    await refreshRef.current?.()
  }, [userId])

  useEffect(() => {
    load()
    if (!userId) return undefined

    const channel = supabase
      .channel('auctions-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auctions' },
        () => {
          void load()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'faction_scores' },
        () => {
          void load()
        },
      )
      .subscribe()

    const interval = setInterval(() => {
      void load()
    }, SWEEP_MS)

    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [load, userId])

  useEffect(() => {
    const onRefresh = () => {
      setAuctions([])
      void load()
    }
    window.addEventListener(WORLD_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(WORLD_REFRESH_EVENT, onRefresh)
  }, [load])

  const openBoard = useMemo(
    () => auctions.filter((a) => a.status === 'OPEN'),
    [auctions],
  )

  const mine = useMemo(
    () =>
      auctions.filter(
        (a) => a.seller_id === userId || a.highest_bidder_id === userId,
      ),
    [auctions, userId],
  )

  const scoreByFaction = useMemo(() => {
    const map = { security: 0, hacktivist: 0, consultant: 0 }
    for (const row of scores) {
      if (row?.faction) map[row.faction] = row.score ?? 0
    }
    return map
  }, [scores])

  return {
    auctions,
    openBoard,
    mine,
    scores,
    scoreByFaction,
    loading,
    error,
    reload: load,
    userId,
  }
}
