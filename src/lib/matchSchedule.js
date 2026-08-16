/** Helper countdown / programmazione partita. */

export function pad2(n) {
  return String(Math.max(0, n)).padStart(2, '0')
}

export function remainingParts(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return { days, hours, minutes, seconds, totalSeconds: total }
}

export function toDatetimeLocalValue(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (!Number.isFinite(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  const hh = pad2(d.getHours())
  const mi = pad2(d.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

export function fromDatetimeLocalValue(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

/** Prossimo lunedì 08:00 locale. Se è lunedì prima delle 08:00, usa oggi. */
export function defaultScheduledStart() {
  const d = new Date()
  const target = new Date(d)
  target.setHours(8, 0, 0, 0)
  const day = d.getDay()
  if (day === 1 && d < target) return target
  const daysUntilMonday = (1 - day + 7) % 7 || 7
  target.setDate(target.getDate() + daysUntilMonday)
  return target
}

export function formatScheduleStamp(iso, locale = 'it-IT') {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toLocaleString(locale, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}
