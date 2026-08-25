/** Costanti di gioco (GDD §4) — valori in millisecondi dove indicato */
export const MAX_PA = 5
export const PA_MAX = MAX_PA
export const STARTING_CREDS = 150
export const ACTION_PA_COST = 1
export const BACKDOOR_PA_SURCHARGE = 1
export const UNBLOCK_COST = 100

/** Travel/login verso uno slot server. Crypto Network Card: metà. */
export const TIME_TRAVEL = 30_000

/** Cooldown dopo un cambio hardware. Test: 30s (poi minuti). */
export const EQUIP_COOLDOWN_MS = 30_000

/** Wiper Scrubber: stealth proattivo. */
export const TIME_WIPER_STEALTH = 180_000

/** Heat / Suspicion: cap 5. Trace +1, Kick +2. −10% durata Trace/Kick per punto. */
export const HEAT_MAX = 5
export const HEAT_ON_TRACE = 1
export const HEAT_ON_KICK = 2
export const HEAT_DURATION_PENALTY = 0.1

/**
 * Timer playtest asincrono (1 settimana).
 * TTK difensore: 30s travel + 6m Trace + 3m Kick = 9m 30s.
 * Attack 20m → ~10.5m di buffer per loggarsi e reagire.
 * Extract 40m: high stakes senza stall infinito.
 * Override opzionali via VITE_TIME_*_MS.
 */
export const TIME_ACTION_GDD = 1_200_000
export const TIME_EXTRACT_GDD = 2_400_000
export const TIME_TRACE_GDD = 360_000
export const TIME_KICK_GDD = 180_000

export const TIME_ACTION = Number(
  import.meta.env.VITE_TIME_ACTION_MS ?? 1_200_000,
)
export const TIME_TRACE = Number(import.meta.env.VITE_TIME_TRACE_MS ?? 360_000)
export const TIME_KICK = Number(import.meta.env.VITE_TIME_KICK_MS ?? 180_000)
export const TIME_DEEP_SCAN = Number(
  import.meta.env.VITE_TIME_DEEP_SCAN_MS ?? 180_000,
)
export const TIME_EXTRACT = Number(
  import.meta.env.VITE_TIME_EXTRACT_MS ?? 2_400_000,
)
export const DECOY_DURATION = 3_600_000
export const FREEZE_DURATION = 86_400_000

/** Extract disponibile solo se ICE del server è ≤ questa soglia. */
export const EXTRACT_ICE_MAX = 20

/** Extract: ICE basso e il server non è già della tua fazione (Neutral = ok). */
export function canExtractServer(ice, ownerFaction, userFaction) {
  if ((Number(ice) || 0) > EXTRACT_ICE_MAX) return false
  if (ownerFaction && userFaction && ownerFaction === userFaction) return false
  return true
}

/** Evento UI: ricarica mappa / VP dopo un daily tick o mutazione globale. */
export const WORLD_REFRESH_EVENT = 'zt:world-refresh'

export function requestWorldRefresh() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WORLD_REFRESH_EVENT))
}

/** Evento UI: applica subito game_settings (RPC conclude o preview locale). */
export const MATCH_SETTINGS_EVENT = 'zt:match-settings'

export function pushMatchSettings(row, { local = false } = {}) {
  if (typeof window === 'undefined' || !row) return
  window.dispatchEvent(
    new CustomEvent(MATCH_SETTINGS_EVENT, { detail: { row, local } }),
  )
}

export const GAME_STATES = {
  PENDING_LOBBY: 'LOBBY',
  SCHEDULED_WAITING: 'SCHEDULED_WAITING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
}

export const GAME_VERSION = 'v.0.4 Alpha'

export const FACTIONS = [
  {
    id: 'security',
    label: 'Security',
    codename: 'Corp',
    barTag: 'CORP',
    barClass: 'text-blue-400',
    accentClass: 'text-blue-400',
    glowClass: 'shadow-[0_0_40px_rgba(59,130,246,0.35)]',
    title: 'SYNTH-CORP SECURITY DIVISION',
    logo: '/corps-logo.png',
    banner: '/corps-banner.png',
    bannerJpg: '/corps-banner.jpg',
    goal: 'Mantieni l’ICE dei server sopra il 50%. Cattura i server con Extract.',
    lore: 'Difendi l’infrastruttura di rete.',
    briefing:
      'Il perimetro è sacro. Synth-Corp ti ha arruolato per tenere in vita la spina dorsale della rete: ICE alto, nodi sotto controllo, nessun rumore fuori protocollo. Ogni server perso è un asset che non tornerà. Ogni Core Data estratto è munizione per il Faction Score.',
    winCondition:
      'Difendi e conquista i server per accumulare Core Data. Alla fine del ciclo, la fazione con il maggior Faction Score (VP) vince la guerra di rete.',
  },
  {
    id: 'hacktivist',
    label: 'Hacktivisti',
    codename: 'Rebel',
    barTag: 'REBEL',
    barClass: 'text-red-500',
    accentClass: 'text-red-400',
    glowClass: 'shadow-[0_0_40px_rgba(239,68,68,0.35)]',
    title: 'RED CIRCUIT LIBERATION FRONT',
    logo: '/rebels-logo.png',
    banner: '/rebels-banner.png',
    bannerJpg: '/rebels-banner.jpg',
    goal: 'Porta l’ICE ≤ 20% ed esegui Extract per prendere il controllo.',
    lore: 'Sabota i server corporativi.',
    briefing:
      'La rete non è un feudo. Il Circuito Rosso ti ha scelto per aprire brecce, abbattere l’ICE e strappare i nodi dalle mani della Corporation. Extract è occupazione. Core Data è prova. Quando il ciclo si chiude, conta chi controlla il territorio — non chi ha seguito le regole.',
    winCondition:
      'Conquista i server nemici per accumulare Core Data. Alla fine del ciclo, la fazione con il maggior Faction Score (VP) vince la guerra di rete.',
  },
  {
    id: 'consultant',
    label: 'Consulenti',
    codename: 'Merc',
    barTag: 'MERCENARY',
    barClass: 'text-amber-400',
    accentClass: 'text-amber-400',
    glowClass: 'shadow-[0_0_40px_rgba(245,158,11,0.35)]',
    title: 'AUREUS MERCENARY SYNDICATE',
    logo: '/mercenary-logo.png',
    banner: '/mercenary-banner.png',
    bannerJpg: '/mercenary-banner.jpg',
    goal: 'Estrai Core Data e vendili all’Auction House.',
    lore: 'Arricchisciti al miglior offerente.',
    briefing:
      'Niente bandiere. Niente patriotismi. Tu vendi accesso, silenzio e Core Data al miglior offerente. La guerra è un mercato: farming, aste, speculazione. Quando il ciclo si chiude, vince chi ha più capitale — non chi ha tenuto più nodi.',
    winCondition:
      'Scala la classifica di capitale accumulando Crediti e speculando all’Auction House. Il leaderboard, non il territorio, decide il tuo ranking.',
  },
]

export function factionById(id) {
  return FACTIONS.find((f) => f.id === id) ?? null
}

export function factionCodename(id) {
  return factionById(id)?.codename ?? id ?? 'Neutral'
}

export function factionBarTag(id) {
  return factionById(id)?.barTag ?? 'UNKNOWN'
}

export function factionBarClass(id) {
  return factionById(id)?.barClass ?? 'text-zinc-400'
}

export function factionLogo(id) {
  return factionById(id)?.logo ?? null
}

export function factionBanner(id) {
  return factionById(id)?.banner ?? null
}

export function factionLore(id) {
  return factionById(id)?.lore ?? ''
}

export function factionTitle(id) {
  return factionById(id)?.title ?? factionById(id)?.label ?? 'UNITÀ NON CLASSIFICATA'
}

export function factionBriefing(id) {
  return factionById(id)?.briefing ?? factionLore(id)
}

export function factionWinCondition(id) {
  return factionById(id)?.winCondition ?? factionById(id)?.goal ?? ''
}

const MERCENARY_LOGO = '/mercenary-logo.png'

/** Logo fazione proprietaria; null/sconosciuto → Mercenary (niente Neutral). */
export function serverOwnerLogo(ownerFaction) {
  return factionById(ownerFaction)?.logo ?? MERCENARY_LOGO
}

/** NULL / assente: fallback visuale Merc (i server non restano Neutral). */
export function serverOwnerLabel(ownerFaction) {
  if (!ownerFaction) return factionCodename('consultant')
  return factionCodename(ownerFaction)
}

/** Badge + bordo carta mappa per ownership Corp / Rebel / Merc. */
export function serverOwnerPresentation(ownerFaction) {
  const logo = serverOwnerLogo(ownerFaction)
  if (ownerFaction === 'security') {
    return {
      badge: '[ PROPRIETÀ CORP ]',
      badgeClass: 'text-blue-400',
      logo,
      cardClass:
        'border-blue-500/50 shadow-[0_0_18px_rgba(59,130,246,0.22)] hover:border-blue-400/70',
    }
  }
  if (ownerFaction === 'hacktivist') {
    return {
      badge: '[ DOMINIO REBEL ]',
      badgeClass: 'text-red-400',
      logo,
      cardClass:
        'border-red-500/50 shadow-[0_0_18px_rgba(239,68,68,0.22)] hover:border-red-400/70',
    }
  }
  if (ownerFaction === 'consultant') {
    return {
      badge: '[ PROPRIETÀ MERCENARI ]',
      badgeClass: 'text-amber-400',
      logo,
      cardClass:
        'border-amber-500/50 shadow-[0_0_18px_rgba(245,158,11,0.22)] hover:border-amber-400/70',
    }
  }
  return {
    badge: '[ PROPRIETÀ MERCENARI ]',
    badgeClass: 'text-amber-400',
    logo,
    cardClass:
      'border-amber-500/50 shadow-[0_0_18px_rgba(245,158,11,0.22)] hover:border-amber-400/70',
  }
}

export function isMercFaction(faction) {
  return faction === 'consultant'
}

export function isBiddingFaction(faction) {
  return faction === 'security' || faction === 'hacktivist'
}

export const ROLES = [
  {
    id: 'sysadmin',
    label: 'SysAdmin',
    icon: 'Terminal',
    iconSrc: '/sysop.png',
    style: 'Custode del perimetro. Difesa, contromisure, controllo ICE.',
    lore: 'Nasci dove i log diventano armi. Tieni in vita i nodi alleati, spegni i processi ostili e forzi il reboot quando la rete sanguina.',
    blurb:
      'Overclock: −20% sui timer di Defend, Trace e Kick. Sui server della tua fazione vedi ATTACCO RILEVATO (senza identità).',
  },
  {
    id: 'ghost',
    label: 'Ghost',
    icon: 'Eye',
    iconSrc: '/ghost.png',
    style: 'Invisibile. Intrusione, decoy, identità false.',
    lore: 'Non sei sulla mappa. Sei il rumore che gli altri scambiano per silenzio: slot D sempre aperto, attacchi più rapidi, identità cifrata finché un Analyst non ti squarcia.',
    blurb:
      'Invisibile al radar. ENCRYPTED ID in Trace (tranne Data Analyst). Attack −20%. Slot D permanente su ogni server (+1 PA).',
  },
  {
    id: 'analyst',
    label: 'Data Analyst',
    icon: 'ScanSearch',
    iconSrc: '/dataanalyst.png',
    style: 'Occhio sulla rete. Intel, trace, doxxing.',
    lore: 'Vedi occupazione dalla mappa globale e i timer esatti sugli slot nemici. I tuoi Trace bucano lo stealth dei Ghost. Raccogli storie, non solo pacchetti — e le vendi come intel.',
    blurb:
      'Panopticon: occupancy sulla mappa e timer esatti sugli slot nemici. Trace −40% e penetra lo stealth dei Ghost.',
  },
  {
    id: 'executive',
    label: 'Executive',
    icon: 'Briefcase',
    iconSrc: '/executive.png',
    style: 'Capitale, contratti, immunità legale.',
    lore: 'Il farming paga di più, i Gigs costano meno, due slot hardware. Quando serve, alzi uno Scudo Legale e congeli i conti altrui. La guerra è un bilancio.',
    blurb:
      'Farm +75% (88 ₵), Gigs a −25%, due slot hardware. Scudo Legale sulla prossima azione base.',
  },
]

export function roleById(id) {
  return ROLES.find((r) => r.id === id) ?? null
}

export function roleLabel(id) {
  return roleById(id)?.label ?? id ?? ''
}

export function roleIcon(id) {
  return roleById(id)?.iconSrc ?? null
}
