import { supabase } from './supabase'
import { getTravelTimeMs, isNodeDdosActive } from './hardware'

export const CONFIRM_LEAVE_SERVER =
  'ATTENZIONE: Stai per abbandonare il server. Qualsiasi operazione in corso verrà immediatamente ANNULLATA. Vuoi procedere?'

export function travelRemainingMs(profile, now = Date.now()) {
  if (profile?.status !== 'traveling' || !profile.travel_until) return 0
  return Math.max(0, new Date(profile.travel_until).getTime() - now)
}

export function isTraveling(profile) {
  return profile?.status === 'traveling' && Boolean(profile.travel_until)
}

export function resolveTravelMs(profile, node) {
  return getTravelTimeMs(profile?.equipped_hardware, {
    ddosActive: isNodeDdosActive(node),
  })
}

/** Avvia il login verso un server (dalla mappa). Non occupa slot. */
export async function beginTravel({ profile, node, intent, travelMs }) {
  const until = new Date(Date.now() + travelMs).toISOString()
  const { data, error } = await supabase
    .from('profiles')
    .update({
      status: 'traveling',
      travel_until: until,
      travel_intent: intent,
      current_node_id: null,
    })
    .eq('id', profile.id)
    .eq('status', 'idle')
    .eq('is_blocked', false)
    .select('*')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Impossibile avviare il travel (non IDLE).')
  return data
}

export async function abortTravel(profile) {
  const { error } = await supabase
    .from('profiles')
    .update({
      status: 'idle',
      travel_until: null,
      travel_intent: null,
      current_node_id: null,
    })
    .eq('id', profile.id)
    .eq('status', 'traveling')
  if (error) throw error
}

/** Fine travel: torna IDLE e sblocca la Server View. Nessuno slot occupato. */
export async function completeTravel({ profile }) {
  const intent = profile.travel_intent
  if (!intent?.nodeId) {
    throw new Error('Travel intent mancante')
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({
      status: 'idle',
      travel_until: null,
      travel_intent: null,
      current_node_id: intent.nodeId,
    })
    .eq('id', profile.id)
    .eq('status', 'traveling')
    .eq('is_blocked', false)
    .select('*')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Login al server fallito.')
  return { intent, profile: data }
}

/** Torna alla Global Map: non sei più connesso a un server. */
export async function disconnectToMap(profile) {
  if (!profile?.id) return
  const { error } = await supabase
    .from('profiles')
    .update({ current_node_id: null })
    .eq('id', profile.id)
  if (error) throw error
}
