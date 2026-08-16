import { supabase } from './supabase'

/** Finestra di presenza: last_seen più vecchio di questo = offline. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000

export function isPlayerOnline(player, now = Date.now()) {
  if (!player) return false
  // Colonna non ancora migrata: non nascondere nessuno.
  if (!('last_seen' in player)) return true
  if (!player.last_seen) return false
  const ts = new Date(player.last_seen).getTime()
  if (!Number.isFinite(ts)) return false
  return now - ts <= ONLINE_WINDOW_MS
}

export async function heartbeatPresence(userId) {
  const { error } = await supabase.rpc('heartbeat_presence')
  if (!error) return { error: null }
  if (
    userId &&
    /schema cache|does not exist|could not find/i.test(error.message ?? '')
  ) {
    return supabase
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', userId)
  }
  return { error }
}

export async function clearPresence(userId) {
  const { error } = await supabase.rpc('clear_presence')
  if (!error) return { error: null }
  if (userId) {
    return supabase
      .from('profiles')
      .update({ last_seen: null })
      .eq('id', userId)
  }
  return { error }
}
