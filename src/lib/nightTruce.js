/** Night Truce / curfew: azioni bloccate 23:00–07:59 Europe/Rome. */

export const NIGHT_TRUCE_TZ = 'Europe/Rome'
export const NIGHT_TRUCE_START_HOUR = 23
export const NIGHT_TRUCE_END_HOUR = 8

export const NIGHT_TRUCE_DENIED =
  'Operazione negata: I server sono in modalità manutenzione notturna (23:00 - 08:00).'

/** Contromisure ammesse in tregua se il bersaglio ha già un'operazione in corso. */
export const REACTIVE_HUNT_ACTIONS = ['trace', 'kick']

export function isReactiveHuntAction(actionType) {
  return REACTIVE_HUNT_ACTIONS.includes(String(actionType ?? '').toLowerCase())
}

function toDate(value) {
  if (value instanceof Date) return value
  if (value == null) return new Date()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

export function romeParts(date = new Date()) {
  try {
    const d = toDate(date)
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: NIGHT_TRUCE_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)

    let hour = Number(parts.find((p) => p.type === 'hour')?.value)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value)

    // Alcuni runtime riportano mezzanotte come 24
    if (hour === 24) hour = 0

    return {
      hour: Number.isFinite(hour) ? hour : 12,
      minute: Number.isFinite(minute) ? minute : 0,
    }
  } catch {
    return { hour: 12, minute: 0 }
  }
}

/** True tra 23:00 e 07:59 (Europe/Rome). In caso di errore → false (app usabile). */
export function isNightTruceActive(date = new Date()) {
  try {
    const { hour } = romeParts(date)
    if (!Number.isFinite(hour)) return false
    return hour >= NIGHT_TRUCE_START_HOUR || hour < NIGHT_TRUCE_END_HOUR
  } catch {
    return false
  }
}

export function assertDaytime(date = new Date()) {
  if (isNightTruceActive(date)) {
    throw new Error(NIGHT_TRUCE_DENIED)
  }
}

/** Blocca le nuove ops in tregua; Trace/Kick reattivi passano (il backend verifica il target). */
export function assertDaytimeUnlessReactiveHunt(actionType, date = new Date()) {
  if (!isNightTruceActive(date)) return
  if (isReactiveHuntAction(actionType)) return
  throw new Error(NIGHT_TRUCE_DENIED)
}
