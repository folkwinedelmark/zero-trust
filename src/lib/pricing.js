/**
 * Prezzi Afterlife in funzione della reputation (1–5).
 * 5: −20% · 4: −10% · 3: base · 2: +10% · 1: +20%
 */

export const REPUTATION_MIN = 1
export const REPUTATION_MAX = 5
export const REPUTATION_DEFAULT = 3

const REPUTATION_DELTA = {
  5: -0.2,
  4: -0.1,
  3: 0,
  2: 0.1,
  1: 0.2,
}

export function clampReputation(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return REPUTATION_DEFAULT
  return Math.min(REPUTATION_MAX, Math.max(REPUTATION_MIN, Math.round(n)))
}

export function reputationModifier(reputation) {
  return REPUTATION_DELTA[clampReputation(reputation)] ?? 0
}

export function calculatePrice(basePrice, userReputation) {
  const base = Math.max(0, Number(basePrice) || 0)
  const price = Math.round(base * (1 + reputationModifier(userReputation)))
  return Math.max(0, price)
}

/** Rimborso mercato nero: sempre 50% del valore base (no sconto reputazione). */
export const SELL_REFUND_RATE = 0.5

export function sellRefund(basePrice) {
  const base = Math.max(0, Number(basePrice) || 0)
  return Math.floor(base * SELL_REFUND_RATE)
}

export function priceDeltaLabel(userReputation) {
  const pct = Math.round(reputationModifier(userReputation) * 100)
  if (pct === 0) return 'prezzo base'
  return pct < 0 ? `${pct}%` : `+${pct}%`
}
