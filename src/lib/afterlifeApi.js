import { supabase } from './supabase'
import { assertDaytime } from './nightTruce'

export async function afterlifeHelpdesk(service) {
  assertDaytime()
  return supabase.rpc('afterlife_helpdesk', { p_service: service })
}

export async function afterlifeBuy(itemId) {
  assertDaytime()
  return supabase.rpc('afterlife_buy', { p_item_id: itemId })
}

export async function afterlifeSell(inventoryId) {
  return supabase.rpc('afterlife_sell', { p_inventory_id: inventoryId })
}

export async function afterlifeEquip(hardwareId) {
  return supabase.rpc('afterlife_equip', { p_hardware_id: hardwareId })
}

export async function afterlifeUnequip(hardwareId) {
  return supabase.rpc('afterlife_unequip', { p_hardware_id: hardwareId })
}

export async function afterlifeUseItem(
  inventoryId,
  { targetId = null, targetSlotId = null } = {},
) {
  assertDaytime()
  return supabase.rpc('afterlife_use_item', {
    p_inventory_id: inventoryId,
    p_target_id: targetId,
    p_target_slot_id: targetSlotId,
  })
}
