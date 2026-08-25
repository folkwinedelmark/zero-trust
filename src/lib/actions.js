import {
  ACTION_PA_COST,
  TIME_ACTION,
  TIME_DEEP_SCAN,
  TIME_EXTRACT,
  TIME_KICK,
  TIME_TRACE,
} from './constants'
import { isBackdoorRestricted } from './abilities'
import {
  applyDefenderHardwareDuration,
  applyTargetHeatDuration,
  iceDeltaForAction as iceDeltaWithHardware,
  isSlotLocked,
  getFarmGain as farmGainWithHardware,
} from './hardware'

export const CONFIRM_ABORT_ACTION =
  "Sei sicuro di voler annullare l'operazione in corso? I Punti Azione (PA) spesi non verranno rimborsati."

/** Payload per liberare uno slot */
export const EMPTY_SLOT = {
  user_id: null,
  action_type: null,
  start_time: null,
  end_time: null,
  is_decoy: false,
  is_spoofed: false,
  spoofed_as_user_id: null,
  spoofed_action: null,
  target_slot_id: null,
  is_immune: false,
}

/**
 * Durata effettiva dell'azione, con passivi di classe.
 * Playtest: Attack 20m · Trace 6m · Kick 3m · Extract 40m · Deep Scan 3m.
 *   - Ghost Attack: 20m × 0.80 = 16m
 *   - SysAdmin Defend/Trace/Kick: −20%
 *   - Analyst Trace: 6m × 0.60 = 3m 36s
 */
export function getActionDurationMs(
  actionType,
  role,
  { defenderHardware = null, defenderHeat = 0, instant = false } = {},
) {
  // end_time > start_time è vincolo SQL: 1ms basta per il resolve immediato
  if (instant) return 1

  let ms = TIME_ACTION

  if (actionType === 'trace') ms = TIME_TRACE
  else if (actionType === 'kick') ms = TIME_KICK
  else if (actionType === 'extract') ms = TIME_EXTRACT
  else if (actionType === 'deep_scan') ms = TIME_DEEP_SCAN

  // Ghost: −20% su Attack
  if (role === 'ghost' && actionType === 'attack') {
    ms = Math.round(ms * 0.8)
  }

  // SysAdmin: −20% su Defend, Trace e Kick (executor)
  if (
    role === 'sysadmin' &&
    (actionType === 'defend' ||
      actionType === 'trace' ||
      actionType === 'kick')
  ) {
    ms = Math.round(ms * 0.8)
  }

  // Analyst: Trace −40%
  if (role === 'analyst' && actionType === 'trace') {
    ms = Math.round(ms * 0.6)
  }

  if (actionType === 'trace' || actionType === 'kick') {
    ms = applyTargetHeatDuration(ms, defenderHeat)
    ms = applyDefenderHardwareDuration(ms, defenderHardware)
  }

  return ms
}

export function getFarmGain(role, hardwareId = null) {
  return farmGainWithHardware(role, hardwareId)
}

export function clampIce(value) {
  return Math.max(0, Math.min(100, value))
}

export function iceDeltaForAction(actionType, hardwareId = null) {
  return iceDeltaWithHardware(actionType, hardwareId)
}

/** Clock MM:SS fino a 59:59, poi HH:MM:SS. Extract 40m → 40:00. */
export function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.ceil((Number(ms) || 0) / 1000))
  const days = Math.floor(totalSec / 86_400)
  const remain = totalSec % 86_400
  const h = Math.floor(remain / 3600)
  const m = Math.floor((remain % 3600) / 60)
  const s = remain % 60
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  if (days >= 1) {
    return `${days}d ${hh}:${mm}:${ss}`
  }
  if (h > 0) {
    return `${hh}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}

export function actionProgress(slot, now = Date.now()) {
  if (!slot?.start_time || !slot?.end_time) {
    return { progress: 0, remainingMs: 0, done: false }
  }
  const start = new Date(slot.start_time).getTime()
  const end = new Date(slot.end_time).getTime()
  const duration = Math.max(1, end - start)
  const remainingMs = Math.max(0, end - now)
  const progress = Math.min(1, Math.max(0, (now - start) / duration))
  return { progress, remainingMs, done: now >= end }
}

const FOG_EARLY = 'Stato: Appena connesso'
const FOG_MID = 'Stato: Connessione stabile'
const FOG_LATE = 'Stato: Operazione avanzata'

function occupancyElapsedPct(slot, now = Date.now()) {
  const start = slot?.start_time ? new Date(slot.start_time).getTime() : NaN
  if (!Number.isFinite(start)) return null
  const end = slot?.end_time ? new Date(slot.end_time).getTime() : NaN
  const duration =
    Number.isFinite(end) && end > start ? end - start : TIME_ACTION
  if (duration <= 0) return null
  return Math.min(1, Math.max(0, (now - start) / duration))
}

/**
 * Fog of war sulla durata dello slot nemico.
 * Analyst: timer esatto residuo. Altri: stima a tre fasce.
 */
export function occupancyFogLabel(
  slot,
  now = Date.now(),
  { isAnalyst = false } = {},
) {
  if (isAnalyst) {
    if (slot?.start_time && slot?.end_time) {
      const remainingMs = actionProgress(slot, now).remainingMs
      return `${formatRemaining(remainingMs)} residui`
    }
    const start = slot?.start_time ? new Date(slot.start_time).getTime() : NaN
    if (!Number.isFinite(start)) return null
    return `connesso da ${formatRemaining(Math.max(0, now - start))}`
  }

  const elapsedPct = occupancyElapsedPct(slot, now)
  if (elapsedPct == null) return null
  if (elapsedPct < 0.33) return FOG_EARLY
  if (elapsedPct <= 0.66) return FOG_MID
  return FOG_LATE
}

/** True when the slot timer has elapsed (end_time <= now). */
export function isSlotTimerExpired(slot, now = Date.now()) {
  if (!slot?.end_time) return false
  return new Date(slot.end_time).getTime() <= now
}

/** Azioni core ancorate al server: uniche cacciabili con Trace/Kick. */
export const CORE_ACTIONS = ['attack', 'defend', 'farm', 'extract']

export function isHuntableAction(actionType) {
  return CORE_ACTIONS.includes(String(actionType ?? '').toLowerCase())
}

/**
 * Trace/Kick solo su chi esegue un'azione core.
 * Decoy che finge Farm resta cacciabile. Trace/Kick/idle = segnale instabile.
 */
export function isHuntableSlot(slot) {
  if (!slot) return false
  if (slot.is_decoy) {
    return isHuntableAction(slot.action_type || slot.spoofed_action || 'farm')
  }
  if (!slot.user_id) return false
  return isHuntableAction(slot.action_type)
}

export function findFreeSlot(slots, profile = null) {
  return (
    (slots ?? []).find((s) => {
      if (s.user_id || s.is_decoy || isSlotLocked(s)) return false
      if (isBackdoorRestricted(s, profile)) return false
      return true
    }) ?? null
  )
}

export { ACTION_PA_COST }
