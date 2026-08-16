import { supabase } from './supabase'

/** Cache id → nome reale, popolata dalla mappa e dalle view. */
const cache = new Map()

const SENTINELS = new Set([
  '',
  'server',
  'server (nome non risolto)',
  'unknown',
])

export function isRealNodeName(value) {
  if (value == null) return false
  const s = String(value).trim()
  if (!s) return false
  return !SENTINELS.has(s.toLowerCase())
}

export function rememberNodeName(nodeId, name) {
  if (!nodeId || !isRealNodeName(name)) return
  cache.set(nodeId, String(name).trim())
}

export function rememberNodes(nodes) {
  for (const n of nodes ?? []) {
    rememberNodeName(n?.id, n?.name)
  }
}

export function cachedNodeName(nodeId) {
  if (!nodeId) return null
  return cache.get(nodeId) ?? null
}

/**
 * Nome server da usare nei log/RPC: cache → array mappa → fetch DB.
 * Non restituisce mai il placeholder "Server".
 */
export async function lookupNodeName(nodeId, nodes = []) {
  const cached = cachedNodeName(nodeId)
  if (isRealNodeName(cached)) return cached

  const fromMap = (nodes ?? []).find((n) => n.id === nodeId)?.name
  if (isRealNodeName(fromMap)) {
    rememberNodeName(nodeId, fromMap)
    return String(fromMap).trim()
  }

  if (!nodeId) return isRealNodeName(fromMap) ? String(fromMap).trim() : null

  const { data, error } = await supabase
    .from('nodes')
    .select('name')
    .eq('id', nodeId)
    .maybeSingle()

  if (!error && isRealNodeName(data?.name)) {
    rememberNodeName(nodeId, data.name)
    return String(data.name).trim()
  }

  if (isRealNodeName(fromMap)) return String(fromMap).trim()
  return cached ?? null
}

/** Prima candidata reale da un log (join nodes + meta). */
export function resolveLogNodeName(log) {
  const candidates = [
    log?.node?.name,
    log?.meta?.node_name,
    log?.node_name,
  ]
  for (const c of candidates) {
    if (isRealNodeName(c)) return String(c).trim()
  }
  const nodeId = log?.node_id
  if (nodeId && isRealNodeName(cachedNodeName(nodeId))) {
    return cachedNodeName(nodeId)
  }
  return null
}
