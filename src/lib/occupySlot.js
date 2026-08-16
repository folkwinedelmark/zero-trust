import { supabase } from './supabase'
import { EMPTY_SLOT, getActionDurationMs, isHuntableAction } from './actions'
import { EXTRACT_ICE_MAX, canExtractServer } from './constants'
import { isBackdoorRestricted } from './abilities'
import { assertDaytimeUnlessReactiveHunt } from './nightTruce'

export function slotCollisionMessage(slotLabel, serverName) {
  return `Connessione fallita allo Slot ${slotLabel} su ${serverName}: un altro utente ha occupato la connessione per primo.`
}

/**
 * Claim atomico di uno slot vuoto + passaggio a BUSY.
 * Se un altro agente ha già preso lo slot, ritorna { collided: true }.
 * Preferisce l’RPC start_action (PA = base + 1 su Slot D).
 */
export async function occupySlot({
  profile,
  node,
  occupySlotId,
  actionId,
  targetSlotId = null,
  paCost,
  instant = false,
}) {
  assertDaytimeUnlessReactiveHunt(actionId)

  if (actionId === 'extract') {
    if ((node?.ice ?? 0) > EXTRACT_ICE_MAX) {
      throw new Error(`Extract disponibile solo con ICE ≤ ${EXTRACT_ICE_MAX}%.`)
    }
    if (!canExtractServer(node?.ice, node?.owner_faction, profile?.faction)) {
      throw new Error(
        'Non puoi estrarre un server già sotto il controllo della tua fazione.',
      )
    }
  }

  let defenderHardware = null
  let defenderHeat = 0
  if ((actionId === 'kick' || actionId === 'trace') && targetSlotId) {
    const { data: targetSlot } = await supabase
      .from('slots')
      .select('user_id, action_type, is_decoy, spoofed_action')
      .eq('id', targetSlotId)
      .maybeSingle()
    if (!targetSlot?.user_id && !targetSlot?.is_decoy) {
      throw new Error('Il bersaglio non è più sullo slot.')
    }
    const targetAction = targetSlot?.is_decoy
      ? targetSlot.action_type || targetSlot.spoofed_action || 'farm'
      : targetSlot?.action_type
    if (!isHuntableAction(targetAction)) {
      throw new Error(
        'Segnale instabile: il bersaglio non è ancorato a un’azione core.',
      )
    }
    if (targetSlot?.user_id) {
      const { data: targetProf } = await supabase
        .from('profiles')
        .select('equipped_hardware, heat')
        .eq('id', targetSlot.user_id)
        .maybeSingle()
      defenderHardware = targetProf?.equipped_hardware ?? null
      defenderHeat = targetProf?.heat ?? 0
    }
  }

  const durationMs = getActionDurationMs(actionId, profile.role, {
    defenderHardware,
    defenderHeat,
    instant,
  })
  const start = new Date()
  const end = new Date(start.getTime() + durationMs)
  const basePa = paCost === 0 ? 0 : 1

  const { data, error } = await supabase.rpc('start_action', {
    p_slot_id: occupySlotId,
    p_action_type: actionId,
    p_start: start.toISOString(),
    p_end: end.toISOString(),
    p_target_slot_id: targetSlotId,
    p_node_id: node.id,
    p_base_pa: basePa,
  })

  if (!error) {
    const payload = data && typeof data === 'object' ? data : {}
    if (payload.collided) return { collided: true, claimed: null }
    return { collided: false, claimed: payload.claimed ?? payload }
  }

  if (!isMissingRpc(error)) throw error
  return occupySlotClient({
    profile,
    node,
    occupySlotId,
    actionId,
    targetSlotId,
    paCost,
    start,
    end,
  })
}

function isMissingRpc(error) {
  const msg = String(error?.message ?? error?.details ?? '')
  return (
    error?.code === 'PGRST202' ||
    /start_action/i.test(msg) && /not (found|exist)/i.test(msg)
  )
}

async function occupySlotClient({
  profile,
  node,
  occupySlotId,
  actionId,
  targetSlotId,
  paCost,
  start,
  end,
}) {
  const { data: slotRow } = await supabase
    .from('slots')
    .select('id, is_backdoor, slot_id')
    .eq('id', occupySlotId)
    .maybeSingle()

  if (isBackdoorRestricted(slotRow, profile)) {
    throw new Error('Solo i Ghost possono usare Slot D.')
  }

  const consumeShield =
    Boolean(profile.has_legal_shield) &&
    (actionId === 'attack' || actionId === 'defend' || actionId === 'farm')

  const { data: claimed, error: claimError } = await supabase
    .from('slots')
    .update({
      user_id: profile.id,
      action_type: actionId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      is_decoy: false,
      is_spoofed: false,
      spoofed_as_user_id: null,
      spoofed_action: null,
      target_slot_id: targetSlotId,
      is_immune: consumeShield,
    })
    .eq('id', occupySlotId)
    .is('user_id', null)
    .select('*')
    .maybeSingle()

  if (claimError) throw claimError
  if (!claimed) {
    return { collided: true, claimed: null }
  }

  const { data: busyProfile, error: profileError } = await supabase
    .from('profiles')
    .update({
      status: 'busy',
      pa: Math.max(0, profile.pa - paCost),
      current_node_id: node.id,
      ...(consumeShield ? { has_legal_shield: false } : {}),
    })
    .eq('id', profile.id)
    .eq('status', 'idle')
    .eq('is_blocked', false)
    .select('*')
    .maybeSingle()

  if (profileError || !busyProfile) {
    await supabase
      .from('slots')
      .update(EMPTY_SLOT)
      .eq('id', occupySlotId)
      .eq('user_id', profile.id)
    throw profileError ?? new Error('Impossibile passare a BUSY.')
  }

  return { collided: false, claimed }
}
