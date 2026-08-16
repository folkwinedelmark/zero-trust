import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { WORLD_REFRESH_EVENT } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { fetchIntelReports } from '../lib/intelArchive'

export function useIntelReports(enabled) {
  const { profile } = useAuth()
  const analyst = Boolean(enabled && profile?.role === 'analyst' && profile?.id)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!analyst) {
      setReports([])
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await fetchIntelReports()
    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }
    setReports(data ?? [])
    setLoading(false)
  }, [analyst])

  useEffect(() => {
    if (!analyst) return undefined
    void load()
    const channel = supabase
      .channel(`intel-reports-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'intel_reports',
          filter: `analyst_id=eq.${profile.id}`,
        },
        () => {
          void load()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [analyst, load, profile?.id])

  useEffect(() => {
    const onRefresh = () => {
      void load()
    }
    window.addEventListener(WORLD_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(WORLD_REFRESH_EVENT, onRefresh)
  }, [load])

  return { reports, loading, error, reload: load }
}
