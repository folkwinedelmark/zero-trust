/**
 * Intelligence Operativa — formattazione messaggi e toni colore.
 * Regola: ogni messaggio include sempre Server + Slot quando noti.
 */

import { isRealNodeName, resolveLogNodeName } from './nodeName'

export const ACTION_LABELS = {
  attack: 'Attacco',
  defend: 'Difesa',
  farm: 'Farming',
  extract: 'Extract',
  trace: 'Trace',
  kick: 'Kick',
  deep_scan: 'Deep Scan',
  decoy: 'Decoy',
  spoof: 'Spoof',
  ability: 'Ability',
  abort: 'Abort',
  auction: 'Asta',
  auction_global: 'Asta Globale',
  gig_cancel: 'Gigs',
  gig_fail: 'Gigs',
  gig_complete: 'Gigs',
  class_revealed: 'NET',
  class_intel: 'INTEL',
  match_end: 'SYSTEM',
}

/** Categoria UI → palette */
export const LOG_TONES = {
  success: {
    row: 'border-l-emerald-500/80 bg-emerald-500/5',
    tag: 'text-emerald-400',
    text: 'text-emerald-100/90',
  },
  info: {
    row: 'border-l-cyan-500/70 bg-cyan-500/5',
    tag: 'text-cyan-400',
    text: 'text-cyan-50/90',
  },
  warning: {
    row: 'border-l-amber-500/80 bg-amber-500/10',
    tag: 'text-amber-400',
    text: 'text-amber-50/90',
  },
  danger: {
    row: 'border-l-red-500/80 bg-red-500/10',
    tag: 'text-red-400',
    text: 'text-red-50/90',
  },
  neutral: {
    row: 'border-l-zinc-600 bg-transparent',
    tag: 'text-zinc-500',
    text: 'text-zinc-400',
  },
}

export function actionLabel(type) {
  return ACTION_LABELS[type] ?? type ?? 'Operazione'
}

/** Formato spaziale: solo se il nome server è reale. Altrimenti stringa vuota. */
export function spatialRef(nodeName, slotId) {
  if (!isRealNodeName(nodeName)) return ''
  const label = String(nodeName).trim()
  if (slotId) return `Server: ${label} [Slot ${slotId}]`
  return `Server: ${label}`
}

const UNRESOLVED_SPATIAL =
  /\s*[—-]\s*Server:\s*(?:Server(?: \(nome non risolto\))?|sconosciuto)(?:\s*\[Slot [^\]]+\])?\s*$/gi

/** Toglie il suffisso fittizio "— Server: Server (nome non risolto)". */
export function stripUnresolvedSpatial(message) {
  if (!message) return message
  return String(message).replace(UNRESOLVED_SPATIAL, '').trimEnd()
}

/** Sostituisce placeholder "Server: Server" con il nome reale se noto. */
export function applyResolvedNodeName(message, nodeName) {
  const cleaned = stripUnresolvedSpatial(message)
  if (!cleaned) return cleaned
  if (!isRealNodeName(nodeName)) return cleaned
  const name = String(nodeName).trim()
  return String(cleaned)
    .replace(/Server: Server \(nome non risolto\)/gi, `Server: ${name}`)
    .replace(/Server: Server\b/gi, `Server: ${name}`)
}

export function resolveTone(log, viewerId) {
  const type = (log.event_type ?? '').toLowerCase()
  const outcome = log.outcome ?? log.meta?.outcome ?? 'info'
  const iAmTarget =
    viewerId && log.target_id === viewerId && log.actor_id !== viewerId
  const iAmActor = viewerId && log.actor_id === viewerId

  if (log.meta?.tone && LOG_TONES[log.meta.tone]) return log.meta.tone

  if (
    outcome === 'failure' ||
    type === 'kick_received' ||
    type === 'kill_process_received' ||
    type === 'nda_received' ||
    type === 'asset_freeze_received' ||
    type === 'doxxing_received' ||
    type.includes('blocked') ||
    (type === 'kick' && iAmTarget && outcome === 'success')
  ) {
    return 'danger'
  }

  if (
    outcome === 'aborted' ||
    type === 'abort' ||
    type === 'auction_global' ||
    type === 'trace_received' ||
    type === 'deep_scan_received' ||
    type === 'kick_incoming' ||
    type === 'trace_incoming' ||
    (type.endsWith('_start') && iAmTarget) ||
    (type === 'trace' && iAmTarget)
  ) {
    return 'warning'
  }

  if (
    iAmActor &&
    outcome === 'success' &&
    (type === 'defend' ||
      type === 'farm' ||
      type === 'extract' ||
      type === 'helpdesk_unlock' ||
      type === 'escape' ||
      type === 'trace' ||
      type === 'kick')
  ) {
    return type === 'kick' || type === 'trace' ? 'info' : 'success'
  }

  if (iAmActor && outcome === 'success' && type === 'attack') {
    return 'info'
  }

  if (iAmActor && (type.endsWith('_start') || outcome === 'info')) {
    return 'neutral'
  }

  if (outcome === 'success') return 'success'
  return 'neutral'
}

export function displayTag(log) {
  const tagged = String(log?.meta?.tag ?? '').trim()
  if (tagged) return tagged
  const type = (log.event_type ?? 'event').toUpperCase().replace(/_/g, ' ')
  return type
}

const TARGET_ONLY_EVENTS = new Set([
  'trace_incoming',
  'kick_incoming',
  'trace_received',
  'kick_received',
  'kill_process_received',
  'deep_scan_received',
  'nda_received',
  'asset_freeze_received',
  'doxxing_received',
])

const ACTOR_ONLY_EVENTS = new Set([
  'trace',
  'kick',
  'trace_start',
  'kick_start',
  'attack',
  'defend',
  'farm',
  'extract',
  'attack_start',
  'defend_start',
  'farm_start',
  'extract_start',
  'abort',
  'escape',
  'connection_failed',
  'afterlife_use',
  'bailout_consumed',
  'bailout_averted',
  'jammer_consumed',
  'ability',
  'class_intel',
  'auction_create',
  'auction_bid',
])

/**
 * Scoping personale: incoming/received solo al bersaglio;
 * start/completamento solo all'attore.
 */
export function logVisibleToViewer(log, viewerId) {
  if (!log || !viewerId) return false
  if (log.is_public) return true

  const type = (log.event_type ?? '').toLowerCase()
  const iAmActor = log.actor_id === viewerId
  const iAmTarget =
    log.target_id === viewerId && log.actor_id !== viewerId

  if (TARGET_ONLY_EVENTS.has(type) || log.meta?.perspective === 'target') {
    return iAmTarget
  }
  if (ACTOR_ONLY_EVENTS.has(type)) {
    return iAmActor
  }
  return iAmActor || iAmTarget
}

function metaSpatial(log) {
  const node = resolveLogNodeName(log)
  const slot =
    log.meta?.compromised_slot ||
    log.meta?.target_slot ||
    log.meta?.slot ||
    log.meta?.actor_slot ||
    null
  return spatialRef(node, slot)
}

function compromisedOp(log) {
  const raw =
    log.meta?.target_action ||
    log.meta?.compromised_action ||
    log.meta?.action_type
  if (!raw) return null
  if (['trace', 'kick', 'abort', 'escape'].includes(String(raw))) return null
  return actionLabel(raw)
}

/**
 * Messaggio prospettivo. Preferisce log.message (già con spatial);
 * per il bersaglio ricostruisce con operazione compromessa + Server/Slot.
 */
export function displayMessage(log, viewerId) {
  try {
    return formatDisplayMessage(log, viewerId)
  } catch (err) {
    console.error('[displayMessage]', err)
    return log?.message || log?.event_type || 'evento'
  }
}

function isGlobalSystemLog(log) {
  const type = (log?.event_type ?? '').toLowerCase()
  if (
    type === 'daily_tick' ||
    type === 'game_start' ||
    type === 'lobby_reset' ||
    type === 'auction_global'
  ) {
    return true
  }
  if (log?.is_public && !log?.node_id) return true
  const msg = String(log?.message ?? '')
  return msg.startsWith('[SYSTEM]') || msg.startsWith('[ASTA GLOBALE]') || msg.startsWith('[NET]')
}

function formatDisplayMessage(log, viewerId) {
  const type = (log.event_type ?? '').toLowerCase()
  const iAmTarget =
    viewerId && log.target_id === viewerId && log.actor_id !== viewerId
  const where = metaSpatial(log)
  const op = compromisedOp(log)
  const resolved = resolveLogNodeName(log)

  const finish = (msg) => applyResolvedNodeName(msg, resolved)

  if (isGlobalSystemLog(log) && log.message) {
    return stripUnresolvedSpatial(log.message)
  }

  if (
    type === 'afterlife_use' ||
    type === 'bailout_consumed' ||
    type === 'bailout_averted' ||
    type === 'jammer_consumed'
  ) {
    if (type === 'afterlife_use' && log.meta?.item_id === 'wiper') {
      return finish(
        'Wiper Scrubber attivo: Impronta digitale mascherata per 3 minuti.',
      )
    }
    if (log.message) return finish(log.message)
    if (type === 'afterlife_use') {
      return finish(
        msgItemDeployed({
          itemName: log.meta?.item_name,
          itemId: log.meta?.item_id,
          nodeName: resolved,
          slotLabel: log.meta?.slot,
        }),
      )
    }
    return finish(log.event_type)
  }

  // Incoming / esposizione: solo il bersaglio, mai l'attore
  if (type === 'trace_incoming' || type === 'kick_incoming') {
    if (!iAmTarget) {
      return finish(
        type === 'kick_incoming'
          ? `Kick avviato — ${where}`
          : `Trace avviato — ${where}`,
      )
    }
    if (type === 'kick_incoming') {
      return finish(
        op
          ? `ALLARME: Tentativo di Kick sulla tua operazione di ${op} — ${where}`
          : `ALLARME: Tentativo di Kick sul tuo slot — ${where}`,
      )
    }
    return finish(
      op
        ? `WARNING: Trace rilevato sulla tua operazione di ${op} — ${where}`
        : `WARNING: Trace rilevato sul tuo slot — ${where}`,
    )
  }

  if (iAmTarget) {
    if (type === 'trace' || type === 'trace_received') {
      if (log.outcome === 'failure') {
        return finish(`Tentativo di Trace sventato — ${where}`)
      }
      return finish(
        msgTraceReceived({
          nodeName: resolved,
          targetSlot:
            log.meta?.compromised_slot ||
            log.meta?.target_slot ||
            log.meta?.slot,
          targetAction: log.meta?.target_action || log.meta?.compromised_action,
          revealed: log.meta?.revealed,
        }),
      )
    }
    if (type === 'deep_scan_received') {
      return finish(
        'ATTENZIONE: Il tuo nodo ha subito un Deep Scan da un Data Analyst. La tua identità e la tua operazione attuale sono state compromesse.',
      )
    }
    if (type === 'kill_process_received') {
      return finish(
        "Sei stato espulso dal server da un SysAdmin tramite l'abilità Kill Process.",
      )
    }
    if (type === 'asset_freeze_received') {
      return finish(
        "ATTENZIONE: Il tuo conto è stato congelato da un'azione ostile. Non potrai spendere crediti per le prossime 24 ore.",
      )
    }
    if (type === 'nda_received') {
      return finish(
        'ATTENZIONE: Sei stato colpito da un accordo restrittivo (NDA). La tua operatività sui Contratti (Gigs) è bloccata per le prossime 8 ore.',
      )
    }
    if (type === 'doxxing_received') {
      return finish(
        'SICUREZZA COMPROMESSA: I tuoi log privati delle ultime 24 ore sono stati violati da un Data Analyst tramite Doxxing.',
      )
    }
    if (type === 'kick' || type === 'kick_received') {
      if (log.outcome === 'failure') {
        return finish(`Tentativo di Kick sventato — ${where}`)
      }
      const opBit = op ? ` (operazione di ${op} interrotta)` : ''
      return finish(`Kick subito${opBit} — account BLOCKED — ${where}`)
    }
  }

  if (type === 'trace') {
    const revealed =
      log.meta?.revealed || extractTraceTarget(log.message) || 'Unknown'
    const slot =
      log.meta?.target_slot ||
      log.meta?.compromised_slot ||
      log.meta?.slot ||
      log.meta?.actor_slot
    const targetAction =
      log.meta?.target_action || log.meta?.compromised_action || null
    return finish(
      msgTraceDone({
        revealed,
        nodeName: resolved,
        targetSlot: slot,
        outcome: log.outcome,
        targetAction,
        jammed: log.meta?.jammed === true,
        untraceable: log.meta?.untraceable === true,
      }),
    )
  }

  if (type === 'kick_start') {
    const handle = fogKickHandle(log)
    const actorSlot = log.meta?.actor_slot || log.meta?.slot
    const targetSlot = log.meta?.target_slot
    return finish(
      msgKickStart({
        nodeName: resolved,
        actorSlot,
        targetSlot,
        handle,
      }),
    )
  }

  if (type === 'kick') {
    const handle = fogKickHandle(log)
    const slot =
      log.meta?.target_slot ||
      log.meta?.compromised_slot ||
      log.meta?.slot ||
      log.meta?.actor_slot
    return finish(
      msgKickDone({
        handle,
        nodeName: resolved,
        targetSlot: slot,
        outcome: log.outcome,
        bailed: log.meta?.bailed === true,
      }),
    )
  }

  if (type.startsWith('gig_')) {
    if (log.message) return finish(log.message)
    return finish(actionLabel(type))
  }

  if (type === 'extract' && log.outcome !== 'failure') {
    const owner = log.meta?.owner_faction
    if (owner === 'security' || owner === 'hacktivist' || owner === 'consultant') {
      return finish(
        msgExtractCapture({
          nodeName: resolved,
          faction: owner,
        }),
      )
    }
  }

  if (log.message) {
    if (!hasSpatial(log.message) && where) {
      return finish(`${log.message} — ${where}`)
    }
    return finish(log.message)
  }

  if (where) return finish(`${actionLabel(type)} — ${where}`)
  return finish(actionLabel(type))
}

export function msgItemDeployed({
  itemName,
  itemId,
  nodeName,
  slotLabel,
}) {
  const name = itemName || itemId || 'Software'
  if (slotLabel && nodeName) {
    return `Successo: ${name} attivato sullo Slot ${slotLabel} di ${nodeName}. — Server: ${nodeName} [Slot ${slotLabel}]`
  }
  if (nodeName) {
    return `Successo: ${name} attivato su ${nodeName}. — Server: ${nodeName}`
  }
  return `Successo: ${name} attivato.`
}

export function msgSlotCollision({ slotLabel, nodeName }) {
  return `Connessione fallita allo Slot ${slotLabel} su ${nodeName}: un altro utente ha occupato la connessione per primo.`
}

export function msgActionStart({ actionType, nodeName, slotId }) {
  const label = actionLabel(actionType)
  return `${label} avviato — ${spatialRef(nodeName, slotId)}`
}

export function msgAbort({
  actionType,
  nodeName,
  slotId,
  escapedKick,
  escapedTrace,
  targetLost,
}) {
  if (targetLost) {
    return '[ABORT] Bersaglio perso: la connessione del target è stata interrotta. Operazione annullata.'
  }
  const label = actionLabel(actionType)
  const where = spatialRef(nodeName, slotId)
  if (escapedKick) {
    return `Fallito/Abortito: Operazione di ${label} interrotta — Tentativo di Kick sventato — ${where}`
  }
  if (escapedTrace) {
    return `Fallito/Abortito: Operazione di ${label} interrotta — Tentativo di Trace sventato — ${where}`
  }
  return `Fallito/Abortito: Operazione di ${label} interrotta manualmente — ${where}`
}

export function msgActionDone({ actionType, nodeName, slotId, detail }) {
  const label = actionLabel(actionType)
  const where = spatialRef(nodeName, slotId)
  return detail
    ? `Successo: ${label} completato — ${detail} — ${where}`
    : `Successo: ${label} completato — ${where}`
}

export function msgExtractCapture({ nodeName, faction }) {
  const name = isRealNodeName(nodeName)
    ? String(nodeName).trim()
    : 'sconosciuto'
  const factionLabel =
    faction === 'security'
      ? 'Corp'
      : faction === 'hacktivist'
        ? 'Rebel'
        : faction === 'consultant'
          ? 'Mercenary'
          : faction || 'sconosciuta'
  return `Estrazione completata. Il server ${name} è stato riavviato e ora è sotto il controllo della fazione ${factionLabel}.`
}

export function msgTraceDone({
  revealed,
  nodeName,
  targetSlot,
  outcome = 'success',
  targetAction = null,
  jammed = false,
  untraceable = false,
}) {
  const where = spatialRef(nodeName, targetSlot)
  if (untraceable) {
    return `Fallito: Bersaglio digitalmente non tracciabile. — ${where}`
  }
  if (jammed) {
    return `Fallito: Trace fallito: rilevata interferenza di rete. — ${where}`
  }
  if (outcome === 'failure') {
    return `Fallito: Trace (segnale perso) — ${where}`
  }
  const who = revealed || 'Unknown'
  const op = targetAction ? actionLabel(targetAction) : null
  return op
    ? `Successo: Trace completato su ${who} — azione: ${op} — ${where}`
    : `Successo: Trace completato su ${who} — ${where}`
}

export function msgTraceReceived({
  nodeName,
  targetSlot,
  targetAction,
  revealed,
}) {
  const where = spatialRef(nodeName, targetSlot)
  const opBit = targetAction ? ` mentre eseguivi ${actionLabel(targetAction)}` : ''
  const stealth =
    revealed === 'ID CRIPTATO' || revealed === 'ENCRYPTED ID'
      ? ' — Stealth Protocol (ENCRYPTED ID)'
      : ' — identità esposta'
  return `Subito Trace${opBit} — ${where}${stealth}`
}

function extractTraceTarget(message) {
  const text = String(message ?? '')
  const match =
    text.match(/Trace completato su\s+(.+?)(?:\s+—|$)/i) ||
    text.match(/Trace completato:\s*(.+?)(?:\s+—|$)/i) ||
    text.match(/Trace riuscito:\s*(.+?)(?:\s+—|$)/i)
  return match?.[1]?.trim() || null
}

function hasSpatial(message) {
  return /Server:\s*/i.test(String(message ?? ''))
}

export function msgTraceStart({ nodeName, actorSlot, targetSlot }) {
  return `Trace avviato contro [Slot ${targetSlot}] — ${spatialRef(nodeName, actorSlot)}`
}

export function msgKickStart({ nodeName, actorSlot, targetSlot, handle }) {
  const who = handle || 'Unknown'
  return `Kick avviato contro ${who} [Slot ${targetSlot}] — ${spatialRef(nodeName, actorSlot)}`
}

export function msgKickDone({
  handle,
  nodeName,
  targetSlot,
  outcome = 'success',
  bailed = false,
}) {
  const who = handle || 'Unknown'
  const where = spatialRef(nodeName, targetSlot)
  if (bailed) {
    return `Fallito: Kick vanificato su ${who} — Il bersaglio ha attivato un Bailout Token automatico; Kick e blocco account sventati. — ${where}`
  }
  if (outcome === 'failure') {
    return `Fallito: Kick vanificato su ${who} — ${where}`
  }
  return `Successo: Kick eseguito su ${who} — account BLOCKED — ${where}`
}

/** Nome nel log Kick dell'attore: solo se meta.has_intel è true. */
export function fogKickHandle(log) {
  if (log?.meta?.has_intel === true) {
    const named =
      log.meta.display_name ||
      log.meta.intel_handle ||
      log.meta.known_handle ||
      extractKickTarget(log.message)
    if (named && named !== 'Unknown') return named
  }
  return 'Unknown'
}

function extractKickTarget(message) {
  const text = String(message ?? '')
  const match =
    text.match(/Kick eseguito con successo su\s+(.+?)(?:\s+—|$)/i) ||
    text.match(/Kick eseguito su\s+(.+?)(?:\s+—|$)/i) ||
    text.match(/Kick vanificato su\s+(.+?)(?:\s+—|$)/i) ||
    text.match(/Kick avviato contro\s+(.+?)(?:\s+\[Slot|\s+—|$)/i)
  return match?.[1]?.trim() || null
}

export function msgIncoming({ kind, nodeName, targetSlot, targetAction }) {
  const op = targetAction ? actionLabel(targetAction) : null
  const where = spatialRef(nodeName, targetSlot)
  if (kind === 'kick') {
    return op
      ? `ALLARME: Tentativo di Kick sulla tua operazione di ${op} — ${where}`
      : `ALLARME: Tentativo di Kick sul tuo slot — ${where}`
  }
  return op
    ? `WARNING: Trace rilevato sulla tua operazione di ${op} — ${where}`
    : `WARNING: Trace rilevato sul tuo slot — ${where}`
}

export function msgEscape({ kind, nodeName, slotId }) {
  const where = spatialRef(nodeName, slotId)
  return kind === 'kick'
    ? `Tentativo di Kick sventato per Abort tempestivo — ${where}`
    : `Tentativo di Trace sventato per Abort tempestivo — ${where}`
}
