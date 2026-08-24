import { supabase } from './supabase'

let inFlight = false
let lastAt = 0
const MIN_GAP_MS = 800

/** Ping invisibile: FOR UPDATE sul backend rende i doppioni innocui. */
export function pingResolveExpiredActions() {
  const now = Date.now()
  if (inFlight || now - lastAt < MIN_GAP_MS) return
  lastAt = now
  inFlight = true
  void supabase
    .rpc('resolve_expired_actions')
    .catch(() => {})
    .finally(() => {
      inFlight = false
    })
}
