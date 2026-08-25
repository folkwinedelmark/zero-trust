import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rememberNodes } from '../lib/nodeName'
import { WORLD_REFRESH_EVENT } from '../lib/constants'

/**
 * Carica nodes + slots e resta in ascolto Realtime.
 */
function rolesFromRows(rows) {
  const map = {}
  for (const row of rows ?? []) {
    if (row?.id) map[row.id] = row.role ?? null
  }
  return map
}

export function useRealtimeMap() {
  const [nodes, setNodes] = useState([])
  const [slots, setSlots] = useState([])
  const [rolesById, setRolesById] = useState({})
  const [scores, setScores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      await supabase.rpc('zt_sweep_class_effects')
    } catch {
      // RPC assente se phase29 non è ancora applicata
    }
    const [nodesRes, slotsRes, rolesRes, scoresRes] = await Promise.all([
      supabase.from('nodes').select('*').order('name'),
      supabase.from('slots').select('*').order('slot_id'),
      supabase.from('profiles').select('id, role'),
      supabase.from('faction_scores').select('faction, score, updated_at'),
    ])

    if (nodesRes.error || slotsRes.error) {
      setError(nodesRes.error?.message ?? slotsRes.error?.message)
      setLoading(false)
      return
    }

    const nextNodes = nodesRes.data ?? []
    rememberNodes(nextNodes)
    setRolesById(rolesFromRows(rolesRes.data))
    setNodes(nextNodes)
    setSlots(slotsRes.data ?? [])
    setScores(scoresRes.error ? [] : (scoresRes.data ?? []))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()

    const channel = supabase
      .channel('map-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'nodes' },
        (payload) => {
          setNodes((prev) => {
            const next = applyChange(prev, payload)
            rememberNodes(next)
            return next
          })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slots' },
        (payload) => {
          setSlots((prev) => applyChange(prev, payload))
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        (payload) => {
          setRolesById((prev) => applyRoleChange(prev, payload))
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'faction_scores' },
        (payload) => {
          setScores((prev) => applyScoreChange(prev, payload))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  useEffect(() => {
    const onRefresh = () => {
      void load()
    }
    window.addEventListener(WORLD_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(WORLD_REFRESH_EVENT, onRefresh)
  }, [load])

  const servers = useMemo(
    () => nodes.filter((n) => n.type === 'server'),
    [nodes],
  )

  const services = useMemo(
    () => nodes.filter((n) => n.type === 'service'),
    [nodes],
  )

  const slotsByNode = useMemo(() => {
    const map = {}
    for (const slot of slots) {
      if (!map[slot.node_id]) map[slot.node_id] = []
      map[slot.node_id].push(slot)
    }
    for (const id of Object.keys(map)) {
      map[id].sort((a, b) => a.slot_id.localeCompare(b.slot_id))
    }
    return map
  }, [slots])

  const scoreByFaction = useMemo(() => {
    const map = { security: 0, hacktivist: 0, consultant: 0 }
    for (const row of scores) {
      if (row?.faction) map[row.faction] = row.score ?? 0
    }
    return map
  }, [scores])

  const upsertSlot = useCallback((row) => {
    if (!row?.id) return
    setSlots((prev) => {
      const index = prev.findIndex((item) => item.id === row.id)
      if (index === -1) return [...prev, row]
      const next = [...prev]
      next[index] = { ...prev[index], ...row }
      return next
    })
  }, [])

  return {
    nodes,
    servers,
    services,
    slots,
    slotsByNode,
    rolesById,
    scores,
    scoreByFaction,
    loading,
    error,
    reload: load,
    upsertSlot,
  }
}

function applyChange(list, payload) {
  const { eventType, new: row, old } = payload

  if (eventType === 'INSERT') {
    if (list.some((item) => item.id === row.id)) return list
    return [...list, row]
  }

  if (eventType === 'UPDATE') {
    return list.map((item) => {
      if (item.id !== row.id) return item
      const merged = { ...item, ...row }
      // Realtime a volte omette colonne: non cancellare name/node_id
      if (!merged.name && item.name) merged.name = item.name
      if (!merged.node_id && item.node_id) merged.node_id = item.node_id
      if (row && !Object.prototype.hasOwnProperty.call(row, 'owner_faction')) {
        merged.owner_faction = item.owner_faction
      }
      return merged
    })
  }

  if (eventType === 'DELETE') {
    const id = old?.id
    return list.filter((item) => item.id !== id)
  }

  return list
}

function applyScoreChange(list, payload) {
  const { eventType, new: row, old } = payload
  const faction = row?.faction ?? old?.faction
  if (!faction) return list

  if (eventType === 'DELETE') {
    return list.filter((item) => item.faction !== faction)
  }

  if (list.some((item) => item.faction === faction)) {
    return list.map((item) =>
      item.faction === faction ? { ...item, ...row } : item,
    )
  }

  return [...list, row]
}

function applyRoleChange(map, payload) {
  const { eventType, new: row, old } = payload
  if (eventType === 'DELETE') {
    if (!old?.id) return map
    const next = { ...map }
    delete next[old.id]
    return next
  }
  if (!row?.id) return map
  return { ...map, [row.id]: row.role ?? map[row.id] ?? null }
}
