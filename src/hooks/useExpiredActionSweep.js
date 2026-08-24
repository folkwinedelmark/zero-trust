import { useEffect } from 'react'
import { pingResolveExpiredActions } from '../lib/resolveExpired'

const HEARTBEAT_MS = 10_000
const RESOLVABLE = new Set([
  'attack',
  'defend',
  'farm',
  'extract',
  'trace',
  'kick',
])

function slotEndMs(slot) {
  if (
    !slot?.user_id ||
    !slot?.end_time ||
    !RESOLVABLE.has(String(slot.action_type ?? '').toLowerCase())
  ) {
    return null
  }
  const end = new Date(slot.end_time).getTime()
  return Number.isFinite(end) ? end : null
}

/**
 * Layer 3: heartbeat 10s + ping istantaneo quando un timer visibile (o in mappa) scade.
 * Owner e cron restano attivi; resolve_expired_actions è idempotente.
 */
export function useExpiredActionSweep(slots = []) {
  useEffect(() => {
    const id = setInterval(() => {
      pingResolveExpiredActions()
    }, HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const now = Date.now()
    let next = Infinity
    let expired = false

    for (const slot of slots) {
      const end = slotEndMs(slot)
      if (end == null) continue
      if (end <= now) expired = true
      else if (end < next) next = end
    }

    if (expired) pingResolveExpiredActions()
    if (!Number.isFinite(next)) return undefined

    const id = setTimeout(
      () => pingResolveExpiredActions(),
      Math.max(0, next - Date.now()),
    )
    return () => clearTimeout(id)
  }, [slots])
}
