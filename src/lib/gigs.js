import { UNBLOCK_COST } from './constants'

/** Mercenary Gigs — costi, limiti e formattazione (GDD §6 / §10). */

export const GIG_MIN_REWARD = 10
export const GIG_MAX_REWARD = 5000
export const GIG_EXEC_DISCOUNT = 0.25

export const GIG_ACTIONS = [
  { id: 'ATTACK', label: 'Attacca Server', verb: 'Attacca', kind: 'server' },
  { id: 'DEFEND', label: 'Difendi Server', verb: 'Difendi', kind: 'server' },
  { id: 'TRACE', label: 'Trace Utente', verb: 'Trace', kind: 'player' },
  { id: 'KICK', label: 'Kick Utente', verb: 'Kick', kind: 'player' },
]

export const GIG_TIME_LIMITS = [
  { seconds: 120, label: '2 min' },
  { seconds: 300, label: '5 min' },
  { seconds: 900, label: '15 min' },
  { seconds: 1800, label: '30 min' },
  { seconds: 3600, label: '1 ora' },
  { seconds: 21600, label: '6 ore' },
]

/** Minuti minimi di deadline dopo accept (travel + azione + buffer). */
export const GIG_MIN_DEADLINE_MINUTES = {
  ATTACK: 30,
  DEFEND: 30,
  FARM: 30,
  TRACE: 15,
  KICK: 15,
}

export function gigMinDeadlineMinutes(actionId) {
  const key = String(actionId ?? '').toUpperCase()
  return GIG_MIN_DEADLINE_MINUTES[key] ?? 15
}

export function gigMinDeadlineSeconds(actionId) {
  return gigMinDeadlineMinutes(actionId) * 60
}

export function isGigDeadlineTooShort(actionId, timeLimitSeconds) {
  return Number(timeLimitSeconds) < gigMinDeadlineSeconds(actionId)
}

export function gigDeadlineInsufficientMessage(actionId) {
  const min = gigMinDeadlineMinutes(actionId)
  return `Il tempo concesso è insufficiente per eseguire questa operazione. Minimo richiesto: ${min} minuti.`
}

export function gigCreateCost(reward, role) {
  const n = Math.max(0, Math.round(Number(reward) || 0))
  if (role === 'executive') {
    return Math.max(1, Math.round(n * (1 - GIG_EXEC_DISCOUNT)))
  }
  return n
}

export function formatGigDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  if (s < 60) return `${s}s`
  if (s < 3600) {
    const m = Math.round(s / 60)
    return `${m} min`
  }
  const h = s / 3600
  return Number.isInteger(h) ? `${h} ore` : `${h.toFixed(1)} ore`
}

export function gigDeadlineMs(gig, now = Date.now()) {
  if (!gig?.deadline) return null
  return new Date(gig.deadline).getTime() - now
}

export function isGigExpired(gig, now = Date.now()) {
  if (gig?.status !== 'IN_PROGRESS' || !gig?.deadline) return false
  return new Date(gig.deadline).getTime() <= now
}

export function gigActionMeta(actionId) {
  return GIG_ACTIONS.find((a) => a.id === actionId) ?? null
}

export function resolveGigTargetName(gig, { servers = [], players = [] } = {}) {
  if (!gig?.target_entity_id) return null
  const action = gigActionMeta(gig.target_action)
  if (action?.kind === 'player') {
    return players.find((p) => p.id === gig.target_entity_id)?.name ?? null
  }
  return servers.find((s) => s.id === gig.target_entity_id)?.name ?? null
}

/** Titolo UI: "Attacca Aegis Prime" — fallback sulla description auto-generata. */
export function formatGigTitle(gig, catalogs) {
  const action = gigActionMeta(gig?.target_action)
  const name = resolveGigTargetName(gig, catalogs)
  if (action && name) return `${action.verb} ${name}`
  return gig?.description || 'Contratto'
}

export function isServerGigAction(actionId) {
  return actionId === 'ATTACK' || actionId === 'DEFEND'
}

export function gigsTargetingNode(gigs, nodeId) {
  if (!nodeId) return []
  return (gigs ?? []).filter(
    (g) => isServerGigAction(g.target_action) && g.target_entity_id === nodeId,
  )
}

export function executorGigs(gigs, userId) {
  if (!userId) return []
  return (gigs ?? []).filter(
    (g) => g.executor_id === userId && g.status === 'IN_PROGRESS',
  )
}

export const GIG_FAIL_REASONS = {
  executorAbort: 'Annullato dal Merc',
  creatorAbort: 'Annullato dal Client',
  expired: 'Tempo Scaduto',
  withdrawn: 'Ritirato',
}

export function gigStatusLabel(status) {
  switch (status) {
    case 'OPEN':
      return 'OPEN'
    case 'IN_PROGRESS':
      return 'IN CORSO'
    case 'COMPLETED':
      return 'COMPLETATO'
    case 'FAILED':
      return 'FALLITO'
    default:
      return status ?? '—'
  }
}

export function clampGigReputation(reputation) {
  const n = Math.round(Number(reputation))
  if (!Number.isFinite(n)) return 3
  return Math.max(1, Math.min(5, n))
}

export function gigAbortWillBlock(reputation) {
  return clampGigReputation(reputation) <= 2
}

/** Testo del prompt di conferma Abort/Ritira, in base a status e stelle. */
export function gigAbortConfirmCopy(reputation, gig, userId) {
  const isCancel = gig?.status === 'OPEN' && gig?.creator_id === userId
  if (isCancel) {
    return {
      title: 'Ritira il gig',
      message: `L’escrow di ${gig.paid_amount ?? gig.reward} ₵ torna sul tuo conto.`,
      confirmLabel: 'Ritira',
      okLabel: 'Gig ritirato · escrow rimborsato',
    }
  }

  const stars = clampGigReputation(reputation)
  if (stars >= 3) {
    return {
      title: 'ATTENZIONE',
      message:
        'ATTENZIONE: Stai per annullare un contratto in corso. Avendo una reputazione alta, perderai 1 Stella di Reputazione ma il tuo Account NON verrà bloccato. Confermi l’annullamento?',
      confirmLabel: 'Abort',
      okLabel: 'Gig abortito · −1 reputazione',
    }
  }
  if (stars === 2) {
    return {
      title: 'ATTENZIONE',
      message: `ATTENZIONE: Stai per annullare un contratto in corso. Perderai 1 Stella di Reputazione e il tuo Account verrà BLOCCATO all’Helpdesk (richiede ${UNBLOCK_COST} ₵ per lo sblocco). Confermi?`,
      confirmLabel: 'Abort',
      okLabel: 'Gig abortito · account bloccato',
    }
  }
  return {
    title: 'ATTENZIONE',
    message:
      'ATTENZIONE: Stai per annullare un contratto in corso. Avendo già una reputazione minima (1 Stella), il tuo Account verrà immediatamente BLOCCATO all’Helpdesk. Confermi?',
    confirmLabel: 'Abort',
    okLabel: 'Gig abortito · account bloccato',
  }
}

export const GHOST_BOARD_HANDLE = '[ ENCRYPTED ID ]'

/**
 * Stealth Protocol sulla Gigs Board.
 * Analyst vede sempre il nome reale. Gli altri vedono i Ghost mascherati.
 */
export function maskGhostName(
  name,
  targetClass,
  currentUserClass,
  { isSelf = false } = {},
) {
  const raw = String(name ?? '').trim()
  if (isSelf) return raw || 'Unknown'
  const viewer = String(currentUserClass ?? '').toLowerCase()
  if (viewer === 'analyst') return raw || 'Unknown'
  const target = String(targetClass ?? '').toLowerCase()
  if (target === 'ghost') return GHOST_BOARD_HANDLE
  return raw || 'Unknown'
}
