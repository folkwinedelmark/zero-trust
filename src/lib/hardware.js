import { HEAT_DURATION_PENALTY, HEAT_MAX, TIME_TRAVEL } from './constants'
import { HARDWARE_IDS } from './afterlifeCatalog'

export const HARDWARE_SLOTS_DEFAULT = 1
export const HARDWARE_SLOTS_EXECUTIVE = 2

/** Normalizza stringa legacy o array → lista di ID. */
export function parseEquippedHardware(raw) {
  if (Array.isArray(raw)) return raw.filter((id) => typeof id === 'string' && id)
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()]
  if (raw && typeof raw === 'object' && 'equipped_hardware' in raw) {
    return parseEquippedHardware(raw.equipped_hardware)
  }
  return []
}

export function equippedHardware(profile) {
  return parseEquippedHardware(profile?.equipped_hardware)
}

export function maxHardwareSlots(role) {
  return role === 'executive' ? HARDWARE_SLOTS_EXECUTIVE : HARDWARE_SLOTS_DEFAULT
}

export function hasHardware(source, hardwareId) {
  if (!hardwareId) return false
  return parseEquippedHardware(source).includes(hardwareId)
}

/** Farming: base 50, Exec ×1.75, poi +30% se RAM equipaggiata. */
export function getFarmGain(role, equipped = null) {
  let gain = 50
  if (role === 'executive') {
    gain = Math.round(gain * 1.75)
  }
  if (hasHardware(equipped, HARDWARE_IDS.ram)) {
    gain = Math.round(gain * 1.3)
  }
  return gain
}

export function iceDeltaForAction(actionType, equipped = null) {
  const boosted = hasHardware(equipped, HARDWARE_IDS.heuristic)
  if (actionType === 'attack') return boosted ? -15 : -10
  if (actionType === 'defend') return boosted ? 15 : 10
  return 0
}

export function getTravelTimeMs(equipped = null, { ddosActive = false } = {}) {
  let ms = TIME_TRAVEL
  if (hasHardware(equipped, HARDWARE_IDS.crypto_nic)) ms = Math.round(ms * 0.5)
  if (ddosActive) ms = Math.round(ms * 2)
  return ms
}

/** Trace/Kick lanciati CONTRO chi ha GPS Spoofer: +30% durata. */
export function applyDefenderHardwareDuration(ms, defenderEquipped) {
  if (hasHardware(defenderEquipped, HARDWARE_IDS.gps)) {
    return Math.round(ms * 1.3)
  }
  return ms
}

/** Heat del bersaglio: −10% durata Trace/Kick per punto (cap 5). */
export function applyTargetHeatDuration(ms, heat = 0) {
  const points = Math.max(0, Math.min(HEAT_MAX, Number(heat) || 0))
  if (points <= 0) return ms
  return Math.max(1, Math.round(ms * (1 - HEAT_DURATION_PENALTY * points)))
}

export function stealthRemainingMs(profile, now = Date.now()) {
  const until = profile?.stealth_until
  if (!until) return 0
  return Math.max(0, new Date(until).getTime() - now)
}

export function isStealthed(profile, now = Date.now()) {
  return stealthRemainingMs(profile, now) > 0
}

export function equipCooldownRemainingMs(profile, now = Date.now()) {
  const until = profile?.equipment_cooldown_until
  if (!until) return 0
  return Math.max(0, new Date(until).getTime() - now)
}

export function isNodeDdosActive(node, now = Date.now()) {
  if (!node?.ddos_until) return false
  return new Date(node.ddos_until).getTime() > now
}

export function isSlotLocked(slot, now = Date.now()) {
  if (!slot?.locked_until) return false
  return new Date(slot.locked_until).getTime() > now
}
