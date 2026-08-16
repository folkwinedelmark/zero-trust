/**
 * Cache client-side delle identità scoperte via Trace.
 * Intel è valido solo per la sessione di occupancy corrente
 * (stesso slot + stesso user + start_time) e per un tempo recente.
 */

/** Intel "recente": 1h. Copre Trace + Kick sulla stessa occupancy. */
export const INTEL_MAX_AGE_MS = 60 * 60 * 1000

const HIDDEN_HANDLES = new Set([
  'Unknown',
  'Segnale perso',
  'ENCRYPTED ID',
  'ID CRIPTATO',
  '',
])

function storageKey(userId) {
  return `zt-slot-intel:${userId}`
}

function readAll(userId) {
  if (!userId || typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId)) || '{}')
  } catch {
    return {}
  }
}

function writeAll(userId, data) {
  if (!userId || typeof localStorage === 'undefined') return
  localStorage.setItem(storageKey(userId), JSON.stringify(data))
}

function occupancyMs(value) {
  if (!value) return null
  const n = typeof value === 'number' ? value : new Date(value).getTime()
  return Number.isFinite(n) ? n : null
}

/**
 * Intel attivo solo se appartiene alla occupancy corrente del bersaglio.
 */
export function isActiveIntel(
  entry,
  { targetSlotId = null, targetUserId = null, occupancyStartedAt = null } = {},
) {
  if (!entry?.handle) return false
  const handle = String(entry.handle).trim()
  if (!handle || HIDDEN_HANDLES.has(handle)) return false

  if (entry.at && Date.now() - entry.at > INTEL_MAX_AGE_MS) return false

  if (targetUserId && entry.targetUserId && entry.targetUserId !== targetUserId) {
    return false
  }

  if (targetSlotId && entry.targetSlotId && entry.targetSlotId !== targetSlotId) {
    return false
  }

  const currentOcc = occupancyMs(occupancyStartedAt)
  const entryOcc = occupancyMs(entry.occupancyStartedAt)
  if (currentOcc != null && entryOcc != null && entryOcc !== currentOcc) {
    return false
  }
  if (currentOcc != null && entry.at && entry.at < currentOcc - 2000) {
    return false
  }

  return true
}

/**
 * @returns {{ handle: string, targetUserId?: string, targetSlotId?: string, nodeId?: string, nodeName?: string, targetAction?: string, targetSlotLabel?: string, occupancyStartedAt?: string, at: number } | null}
 */
export function getSlotIntel(userId, targetSlotId) {
  if (!userId || !targetSlotId) return null
  return readAll(userId)[targetSlotId] ?? null
}

export function getIntelByUserId(userId, targetUserId) {
  if (!userId || !targetUserId) return null
  const all = readAll(userId)
  return all[`user:${targetUserId}`] ?? null
}

/**
 * Memorizza l'identità rivelata da un Trace riuscito, legata alla occupancy.
 */
export function rememberSlotIntel(
  userId,
  {
    targetSlotId,
    handle,
    targetUserId = null,
    nodeId = null,
    nodeName = null,
    targetAction = null,
    targetSlotLabel = null,
    occupancyStartedAt = null,
  },
) {
  if (!userId || !targetSlotId) return
  const trimmed = (handle ?? '').trim()
  if (!trimmed || HIDDEN_HANDLES.has(trimmed)) return

  const all = readAll(userId)
  const entry = {
    handle: trimmed,
    targetUserId,
    targetSlotId,
    nodeId,
    nodeName,
    targetAction,
    targetSlotLabel,
    occupancyStartedAt: occupancyStartedAt || null,
    at: Date.now(),
  }
  all[targetSlotId] = entry
  if (targetUserId) {
    all[`user:${targetUserId}`] = { ...entry }
  }
  writeAll(userId, all)
}

export function clearSlotIntel(userId, targetSlotId) {
  if (!userId || !targetSlotId) return
  const all = readAll(userId)
  const prev = all[targetSlotId]
  delete all[targetSlotId]
  if (prev?.targetUserId) delete all[`user:${prev.targetUserId}`]
  writeAll(userId, all)
}

/**
 * Intel completo (handle + azione) se il Trace è ancora valido sulla sessione.
 * Senza Trace → null. Non usare mai i campi raw dello slot come fallback.
 */
export function getActiveSlotIntel(
  userId,
  targetSlotId,
  { targetUserId = null, occupancyStartedAt = null } = {},
) {
  const ctx = { targetSlotId, targetUserId, occupancyStartedAt }

  const bySlot = getSlotIntel(userId, targetSlotId)
  if (isActiveIntel(bySlot, ctx)) return bySlot

  if (targetUserId) {
    const byUser = getIntelByUserId(userId, targetUserId)
    if (isActiveIntel(byUser, ctx)) return byUser
  }

  return null
}

/**
 * Handle noto per Kick / UI, solo se l'intel è ancora valido sulla sessione.
 * Senza Trace attivo → null (il caller mostra "Unknown" / OCCUPIED).
 */
export function resolveKnownHandle(
  userId,
  targetSlotId,
  {
    targetUserId = null,
    occupancyStartedAt = null,
    fallback = null,
  } = {},
) {
  const intel = getActiveSlotIntel(userId, targetSlotId, {
    targetUserId,
    occupancyStartedAt,
  })
  if (intel?.handle) return intel.handle

  if (fallback && !HIDDEN_HANDLES.has(String(fallback).trim())) {
    return fallback
  }
  return null
}

export function hasActiveIntel(userId, targetSlotId, opts = {}) {
  return Boolean(getActiveSlotIntel(userId, targetSlotId, opts))
}

/**
 * SysAdmin: su un server della propria fazione, Attack/Extract non restano
 * generici OCCUPIED — solo la natura ostile, mai handle o classe.
 */
export function isSysAdminIntrusionVisible(viewer, node, slot) {
  if (viewer?.role !== 'sysadmin') return false
  if (!node?.owner_faction || node.owner_faction !== viewer.faction) return false
  if (!slot || slot.user_id === viewer.id) return false
  if (!slot.user_id && !slot.is_decoy) return false
  const action = String(slot.action_type || '').toLowerCase()
  return action === 'attack' || action === 'extract'
}
