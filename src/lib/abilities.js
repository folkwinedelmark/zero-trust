/** Catalogo abilità di classe + helper cooldown / targeting. */

export const ABILITY_DAILY_MS = 86_400_000
export const ABILITY_WEEKLY_MS = 3 * 24 * 60 * 60 * 1000

/** GLOBAL = eseguibile dal profilo. CONTEXTUAL = usata su server/slot. */
export const EXECUTION_GLOBAL = 'GLOBAL'
export const EXECUTION_CONTEXTUAL = 'CONTEXTUAL'

export const ROLE_PASSIVES = {
  sysadmin: [
    {
      id: 'optimized_architecture',
      name: 'Architettura Ottimizzata',
      blurb: 'Il timer per le azioni di Difesa, Trace e Kick è ridotto del 20%.',
    },
    {
      id: 'network_sentinel',
      name: 'Sentinella di Rete',
      blurb:
        'Sui server della tua fazione gli Attack/Extract nemici compaiono come ATTACCO RILEVATO, senza identità.',
    },
  ],
  analyst: [
    {
      id: 'panopticon',
      name: 'Panopticon',
      blurb:
        "Puoi vedere l'occupazione di tutti i server dalla Mappa Globale e ottieni i timer esatti di connessione sugli slot nemici (mentre gli altri vedono solo stime). Il timer per l'azione Trace è ridotto del 40% e i tuoi Trace penetrano il protocollo stealth dei Ghost.",
    },
  ],
  executive: [
    {
      id: 'executive_yield',
      name: 'Monopolio Fiscale',
      blurb:
        'Il Farming genera il 75% di Crediti in più. Costo creazione Gigs ridotto del 25%. Capacità hardware raddoppiata: puoi equipaggiare 2 componenti hardware contemporaneamente.',
    },
  ],
  ghost: [
    {
      id: 'ghost_protocol',
      name: 'Protocollo Fantasma',
      blurb:
        "Invisibile al radar globale. Se subisci un Trace, restituisce 'ENCRYPTED ID' (a meno che non sia eseguito da un Data Analyst). Sulla Gigs Board il tuo ID resta criptato. Il timer per l'Attacco è ridotto del 20%.",
    },
    {
      id: 'ghost_backdoor',
      name: 'Backdoor',
      blurb:
        'Slot D è perennemente accessibile su ogni server. Qualsiasi azione su Slot D costa +1 PA.',
      usageHint: 'Slot D perennemente accessibile sui Server (+1 PA costo azione)',
      iconSrc: '/a_backdoor.png',
      glowClass:
        'drop-shadow-[0_0_5px_rgba(168,85,247,0.6)] group-hover:drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]',
    },
  ],
}

export const ABILITIES = [
  {
    id: 'hotfix',
    role: 'sysadmin',
    name: 'Hotfix',
    blurb: '±5% ICE su un nodo, senza travel né slot.',
    paCost: 1,
    cooldown: 'daily',
    target: 'node_ice',
    executionType: EXECUTION_GLOBAL,
    iconSrc: '/a_hotfix.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(34,197,94,0.6)]',
  },
  {
    id: 'kill_process',
    role: 'sysadmin',
    name: 'Kill Process',
    blurb: 'Kick istantaneo su uno slot occupato.',
    paCost: 1,
    cooldown: 'daily',
    target: 'occupied_slot',
    executionType: EXECUTION_CONTEXTUAL,
    usageHint: 'Seleziona lo slot di un nemico',
    iconSrc: '/a_killprocess.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(239,68,68,0.75)]',
  },
  {
    id: 'hard_reboot',
    role: 'sysadmin',
    name: 'Hard Reboot',
    blurb: 'Forza l’ICE di un server a 50%.',
    paCost: 3,
    cooldown: 'weekly',
    target: 'node',
    executionType: EXECUTION_CONTEXTUAL,
    usageHint: 'Utilizzabile all’interno dei Server',
    iconSrc: '/a_hardreboot.png',
    glowClass:
      'drop-shadow-[0_0_5px_rgba(34,197,94,0.6)] group-hover:drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]',
  },
  {
    id: 'decoy',
    role: 'ghost',
    name: 'Decoy',
    blurb: 'Installa un falso segnale. Finge un’operazione per 1 ora.',
    paCost: 1,
    cooldown: 'daily',
    target: 'empty_slot',
    executionType: EXECUTION_CONTEXTUAL,
    usageHint: 'Utilizzabile sugli slot vuoti dei Server',
    iconSrc: '/a_decoy.png',
    glowClass:
      'drop-shadow-[0_0_5px_rgba(168,85,247,0.6)] group-hover:drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]',
  },
  {
    id: 'identity_spoof',
    role: 'ghost',
    name: 'Identity Spoof',
    blurb: 'Per 12h i log/trace mostrano il nome di un innocente.',
    paCost: 3,
    cooldown: 'weekly',
    target: 'player',
    executionType: EXECUTION_GLOBAL,
    iconSrc: '/a_identiyspoofing.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(168,85,247,0.6)]',
  },
  {
    id: 'deep_scan',
    role: 'analyst',
    name: 'Deep Scan',
    blurb: 'Trace istantaneo: ID e azione in corso sul bersaglio.',
    paCost: 1,
    cooldown: 'daily',
    target: 'occupied_slot',
    executionType: EXECUTION_CONTEXTUAL,
    usageHint: 'Seleziona lo slot di un nemico',
    iconSrc: '/a_deepscan.png',
    glowClass:
      'drop-shadow-[0_0_5px_rgba(6,182,212,0.6)] group-hover:drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]',
  },
  {
    id: 'background_check',
    role: 'analyst',
    name: 'Background Check',
    blurb: 'Storico log 24h di un singolo slot.',
    paCost: 1,
    cooldown: 'daily',
    target: 'any_slot',
    executionType: EXECUTION_GLOBAL,
    iconSrc: '/a_backgroundcheck.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(6,182,212,0.6)]',
  },
  {
    id: 'doxxing',
    role: 'analyst',
    name: 'Doxxing',
    blurb: 'Storico privato 24h di un agente.',
    paCost: 3,
    cooldown: 'weekly',
    target: 'player',
    executionType: EXECUTION_GLOBAL,
    iconSrc: '/a_doxxing.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(6,182,212,0.6)]',
  },
  {
    id: 'immunity',
    role: 'executive',
    name: 'Immunity',
    blurb:
      'Attiva uno Scudo Legale. La tua prossima operazione base (Attacco, Difesa, Farming) non potrà essere interrotta dai Kick. (Non applicabile all’Estrazione).',
    paCost: 1,
    cooldown: 'daily',
    target: 'none',
    executionType: EXECUTION_GLOBAL,
    iconSrc: '/a_immunity.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(234,179,8,0.6)]',
  },
  {
    id: 'nda',
    role: 'executive',
    name: 'NDA',
    blurb: 'Il bersaglio non può usare i Gigs per 8h.',
    paCost: 1,
    cooldown: 'daily',
    target: 'player',
    executionType: EXECUTION_GLOBAL,
    iconSrc: '/a_nda.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(234,179,8,0.6)]',
  },
  {
    id: 'asset_freeze',
    role: 'executive',
    name: 'Asset Freeze',
    blurb: 'Il bersaglio non può spendere crediti per 24h.',
    paCost: 3,
    cooldown: 'weekly',
    target: 'player',
    executionType: EXECUTION_GLOBAL,
    iconSrc: '/a_assetfreeze.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(234,179,8,0.6)]',
  },
]

export function abilitiesForRole(role) {
  return ABILITIES.filter((a) => a.role === role)
}

export function isContextualAbility(ability) {
  return (
    ability?.executionType === EXECUTION_CONTEXTUAL ||
    ability?.contextual === true
  )
}

export function abilitiesForPanel(role) {
  return abilitiesForRole(role).filter((a) => !isContextualAbility(a))
}

export function abilitiesByExecution(role, executionType) {
  return abilitiesForRole(role).filter((a) =>
    executionType === EXECUTION_CONTEXTUAL
      ? isContextualAbility(a)
      : !isContextualAbility(a),
  )
}

export function passivesForRole(role) {
  return ROLE_PASSIVES[role] ?? []
}

export function getAbility(id) {
  return ABILITIES.find((a) => a.id === id) ?? null
}

export function abilityCooldownLabel(ability) {
  return ability?.cooldown === 'weekly' ? '3 giorni' : 'giornaliero'
}

/** Testo del prompt di conferma prima di eseguire un'abilità di classe. */
export function abilityConfirmCopy(ability) {
  const name = ability?.name ?? 'Abilità'
  const pa = ability?.paCost ?? 1
  if (ability?.id === 'hotfix') {
    return {
      title: 'Conferma Hotfix',
      message:
        'Sei sicuro di voler eseguire [Hotfix]? Modificherai istantaneamente l’ICE del server bersaglio e attiverai il cooldown giornaliero.',
      confirmLabel: 'Esegui',
    }
  }
  if (ability?.id === 'hard_reboot') {
    return {
      title: 'ATTENZIONE',
      message:
        'ATTENZIONE: Stai per scatenare [Hard Reboot] (Cooldown: 3 giorni). L’ICE del server verrà resettato al 50%. Procedere?',
      confirmLabel: 'Procedi',
    }
  }
  if (ability?.cooldown === 'weekly') {
    return {
      title: 'ATTENZIONE',
      message: `ATTENZIONE: Stai per attivare [${name}] (Cooldown: 3 giorni, ${pa} PA). Confermi l’esecuzione?`,
      confirmLabel: 'Conferma',
    }
  }
  return {
    title: `Conferma ${name}`,
    message: `Sei sicuro di voler eseguire [${name}]? Costerà ${pa} PA e attiverà il cooldown giornaliero.`,
    confirmLabel: 'Esegui',
  }
}

export function cooldownMsFor(ability) {
  return ability?.cooldown === 'weekly' ? ABILITY_WEEKLY_MS : ABILITY_DAILY_MS
}

export function abilityLastUsedIso(cooldowns, abilityId) {
  const cds = cooldowns && typeof cooldowns === 'object' ? cooldowns : {}
  return cds[`${abilityId}_last_used`] ?? cds[abilityId] ?? null
}

export function abilityCooldownRemainingMs(cooldowns, ability, now = Date.now()) {
  const iso = abilityLastUsedIso(cooldowns, ability.id)
  if (!iso) return 0
  const last = new Date(iso).getTime()
  if (!Number.isFinite(last)) return 0
  return Math.max(0, last + cooldownMsFor(ability) - now)
}

export function isEffectActive(iso, now = Date.now()) {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t > now
}

export function isEncryptedHandle(name) {
  const v = String(name ?? '').trim()
  return (
    v === 'ENCRYPTED ID' ||
    v === 'ID CRIPTATO' ||
    v === '[ ENCRYPTED ID ]' ||
    v === '[ENCRYPTED ID]'
  )
}

export function isBackdoorSlot(slot) {
  return Boolean(slot?.is_backdoor || slot?.slot_id === 'D')
}

export function actionPaCostForSlot(slot, base = 1) {
  return isBackdoorSlot(slot) ? base + 1 : base
}

/** Slot D: solo i Ghost lo occupano. Gli altri lo vedono solo se occupato. */
export function isBackdoorRestricted(slot, profile = null) {
  if (!isBackdoorSlot(slot)) return false
  const role =
    profile && typeof profile === 'object' ? profile.role : null
  return role !== 'ghost'
}

export function visibleSlotsForRole(slots, role) {
  return (slots ?? []).filter((slot) => {
    if (!isBackdoorSlot(slot)) return true
    if (role === 'ghost') return true
    return Boolean(slot.user_id || slot.is_decoy)
  })
}

const RADAR_CORE = new Set(['attack', 'defend', 'farm', 'extract'])
const RADAR_ROUTING = new Set(['trace', 'kick'])

/**
 * Slot radar Analyst: i Ghost non compaiono mai.
 * Ruolo ancora sconosciuto → trattato come Ghost (niente flicker Occupato).
 */
export function sanitizeRadarSlot(slot, rolesById = {}) {
  if (!slot) return null
  if (slot.is_backdoor && !slot.user_id && !slot.is_decoy) return null
  if (slot.is_decoy && !slot.user_id) return slot
  if (!slot.user_id) return slot

  const role = rolesById[slot.user_id]
  if (role === 'ghost' || role == null) {
    return {
      ...slot,
      user_id: null,
      action_type: null,
      start_time: null,
      end_time: null,
      is_decoy: false,
      spoofed_action: null,
    }
  }
  return slot
}

export function radarVisibleSlot(slot, occupantRole) {
  if (!slot) return null
  if (occupantRole === 'ghost' || occupantRole == null) {
    if (slot.user_id && !slot.is_decoy) return null
  }
  if (slot.is_backdoor && !slot.user_id && !slot.is_decoy) return null
  if (slot.is_decoy && !slot.user_id) return slot
  return slot
}

/** Panopticon: niente action_type. Core = OCCUPATO, routing = SEGNALE INSTABILE. */
export function radarOccupancyLabel(slot) {
  if (!slot || (!slot.user_id && !slot.is_decoy)) return null
  const action = String(slot.action_type || slot.spoofed_action || '').toLowerCase()
  if (RADAR_ROUTING.has(action)) return 'SEGNALE INSTABILE'
  if (RADAR_CORE.has(action) || slot.is_decoy) return 'OCCUPATO'
  if (action) return 'SEGNALE INSTABILE'
  return 'OCCUPATO'
}
