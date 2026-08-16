import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { cachedNodeName, rememberNodeName } from '../lib/nodeName'
import { logVisibleToViewer } from '../lib/logFormat'
import { WORLD_REFRESH_EVENT } from '../lib/constants'

const LOG_LIMIT = 80

/**
 * Cronologia log PERSONALE + Realtime.
 * RLS (phase6): solo actor_id / target_id = me, oppure is_public.
 * Il filtro .or() lato client rinforza la privacy anche se la policy manca.
 */
export function useSystemLogs() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!userId) {
      setLogs([])
      setLoading(false)
      return
    }

    setError(null)

    const selectWithJoins = `
      id,
      node_id,
      actor_id,
      target_id,
      event_type,
      message,
      outcome,
      meta,
      is_public,
      created_at,
      actor:profiles!actor_id(name),
      target:profiles!target_id(name),
      node:nodes!node_id(name)
    `

    let query = supabase
      .from('logs')
      .select(selectWithJoins)
      .or(
        `actor_id.eq.${userId},target_id.eq.${userId},is_public.eq.true`,
      )
      .order('created_at', { ascending: false })
      .limit(LOG_LIMIT)

    let { data, error: fetchError } = await query

    if (fetchError) {
      // Fallback: senza join / senza colonna is_public (pre-migrazione)
      const plain = await supabase
        .from('logs')
        .select('*')
        .or(`actor_id.eq.${userId},target_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(LOG_LIMIT)

      if (plain.error) {
        setError(plain.error.message)
        setLoading(false)
        return
      }
      setLogs(visibleLogs(hydrateLogNodes(plain.data ?? []), userId))
      setLoading(false)
      return
    }

    setLogs(visibleLogs(hydrateLogNodes(data ?? []), userId))
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()

    if (!userId) return

    const channel = supabase
      .channel(`personal-logs-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'logs' },
        (payload) => {
          const row = payload.new
          const mine =
            row?.actor_id === userId ||
            row?.target_id === userId ||
            row?.is_public === true
          if (mine) void load()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, userId])

  useEffect(() => {
    const onRefresh = () => {
      void load()
    }
    window.addEventListener(WORLD_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(WORLD_REFRESH_EVENT, onRefresh)
  }, [load])

  return { logs, loading, error, reload: load, viewerId: userId }
}

function hydrateLogNodes(rows) {
  return (rows ?? []).map((log) => {
    if (log.node?.name) {
      rememberNodeName(log.node_id, log.node.name)
      return log
    }
    const cached = log.node_id ? cachedNodeName(log.node_id) : null
    if (!cached) return log
    return { ...log, node: { ...(log.node ?? {}), name: cached } }
  })
}

function visibleLogs(rows, userId) {
  const scoped = (rows ?? []).filter((log) => logVisibleToViewer(log, userId))
  const seen = new Set()
  return scoped.filter((log) => {
    const stamp = Math.floor(new Date(log.created_at).getTime() / 2000)
    const key = `${log.event_type}|${log.message}|${log.outcome}|${stamp}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
