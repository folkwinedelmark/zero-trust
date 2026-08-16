import { HEAT_DURATION_PENALTY, HEAT_MAX } from './constants'
import { clampReputation } from './pricing'

const REPUTATION_TOOLTIPS = {
  5: '5 Stelle (Professionista): -20% ai prezzi (Negozi e Helpdesk).',
  4: '4 Stelle (Affidabile): -10% ai prezzi (Negozi e Helpdesk).',
  3: '3 Stelle (Neutrale): Prezzi standard. Nessun bonus o malus.',
  2: '2 Stelle (Rischioso): +10% ai prezzi (Negozi e Helpdesk).',
  1: '1 Stella (Inaffidabile): +20% ai prezzi (Negozi e Helpdesk).',
}

export function reputationTooltip(reputation) {
  return REPUTATION_TOOLTIPS[clampReputation(reputation)]
}

export function heatTooltip(heat) {
  const n = Math.max(0, Math.min(HEAT_MAX, Number(heat) || 0))
  if (n === 0) {
    return 'Sospetto 0/5: Nessun malus. Sicurezza di rete ottimale.'
  }
  const pct = Math.round(n * HEAT_DURATION_PENALTY * 100)
  return `Sospetto ${n}/5: Traccia Digitale rilevata. I nemici impiegano il ${pct}% di tempo in meno per eseguire Trace e Kick contro di te.`
}
