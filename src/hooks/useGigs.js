import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { WORLD_REFRESH_EVENT } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { executorGigs } from '../lib/gigs'
import { fetchGigs, gigAutoResolve, gigSweepExpired } from '../lib/gigsApi'

const SWEEP_MS = 20_000

/**
 * Carica i gigs visibili via RLS e resta in ascolto Realtime.
 * Sweep periodico: IN_PROGRESS oltre deadline → FAILED
 * (rimborso creator + penale a scaglioni sull’esecutore).
 */
export function useGigs() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [gigs, setGigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!userId) {
      setGigs([])
      setLoading(false)
      return
    }

    setError(null)
    await gigSweepExpired()
    await gigAutoResolve()
    const { data, error: fetchError } = await fetchGigs()
    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }
    setGigs(data ?? [])
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
    if (!userId) return undefined

    const channel = supabase
      .channel('gigs-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gigs' },
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
      setGigs([])
      void load()
    }
    window.addEventListener(WORLD_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(WORLD_REFRESH_EVENT, onRefresh)
  }, [load])

  const openBoard = useMemo(
    () => gigs.filter((g) => g.status === 'OPEN' && g.creator_id !== userId),
    [gigs, userId],
  )

  const myActive = useMemo(
    () =>
      gigs.filter(
        (g) =>
          (g.creator_id === userId || g.executor_id === userId) &&
          (g.status === 'OPEN' || g.status === 'IN_PROGRESS'),
      ),
    [gigs, userId],
  )

  const myExecuting = useMemo(
    () => executorGigs(gigs, userId),
    [gigs, userId],
  )

  const myClosed = useMemo(
    () =>
      gigs.filter(
        (g) =>
          (g.creator_id === userId || g.executor_id === userId) &&
          (g.status === 'COMPLETED' || g.status === 'FAILED'),
      ),
    [gigs, userId],
  )

  return {
    gigs,
    openBoard,
    myActive,
    myExecuting,
    myClosed,
    loading,
    error,
    reload: load,
    userId,
  }
}
