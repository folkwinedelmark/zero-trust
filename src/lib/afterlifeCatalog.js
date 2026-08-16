export const INVENTORY_SLOTS = 3

export const CORE_DATA_ID = 'core_data'

export const HARDWARE_IDS = {
  ram: 'ram',
  gps: 'gps',
  crypto_nic: 'crypto_nic',
  heuristic: 'heuristic',
}

export const SOFTWARE_IDS = {
  ddos: 'ddos',
  bailout: 'bailout',
  intel: 'intel',
  jammer: 'jammer',
  lockout: 'lockout',
  wiper: 'wiper',
}

export const HELPDESK_IDS = {
  unlock: 'unlock',
  wipe: 'wipe',
  coffee: 'coffee',
}

export const HELPDESK_SERVICES = [
  {
    id: HELPDESK_IDS.unlock,
    name: 'Account Unlock',
    basePrice: 100,
    image: '/h_accountunlock.png',
    marketDesc:
      "Sfrutta i contatti dell'Afterlife per resettare le tue credenziali compromesse. **Effetto:** Rimuove istantaneamente il blocco account. Torni immediatamente operativo sulla rete.",
  },
  {
    id: HELPDESK_IDS.wipe,
    name: 'Wipe Record',
    basePrice: 200,
    image: '/h_wiperecord.png',
    marketDesc:
      'Corrompe i registri di sorveglianza per cancellare la tua impronta digitale recente. **Effetto:** Azzera istantaneamente il Livello di Sospetto (Heat a 0), rimuovendo i malus difensivi.',
  },
  {
    id: HELPDESK_IDS.coffee,
    name: 'Energy Coffee',
    basePrice: 300,
    image: '/h_energycoffee.png',
    marketDesc:
      'Un mix sintetico di nootropi e stimolanti per sessioni di hacking prolungate. **Effetto:** Ricarica istantaneamente +1 Punto Azione (PA). Non permette di superare il limite massimo.',
  },
]

export const HARDWARE_ITEMS = [
  {
    id: HARDWARE_IDS.ram,
    name: 'RAM Upgrade',
    basePrice: 300,
    blurb: 'Farming: +30% crediti al completamento.',
    image: '/h_ramupgrade.png',
    marketDesc:
      "Moduli di memoria ad alta frequenza per calcoli paralleli intensivi. **Effetto:** L'azione di Farming genera il 30% di Crediti in più.",
  },
  {
    id: HARDWARE_IDS.gps,
    name: 'GPS Spoofer',
    basePrice: 500,
    blurb: 'Trace e Kick nemici rallentati del 30%.',
    image: '/h_gpsspoofer.png',
    marketDesc:
      'Un dispositivo illegale che fa rimbalzare il tuo segnale su dozzine di satelliti fantasma. **Effetto:** I Trace e Kick nemici contro di te sono rallentati del 30%.',
  },
  {
    id: HARDWARE_IDS.crypto_nic,
    name: 'Crypto Network Card',
    basePrice: 400,
    blurb: 'Riduce i tempi di Travel/Login sui server del 50%.',
    image: '/h_cryptonetworkcard.png',
    marketDesc:
      'Hardware di rete militare progettato per forzare gli handshake crittografici. **Effetto:** Riduce i tempi di Travel e Login sui server del 50%.',
  },
  {
    id: HARDWARE_IDS.heuristic,
    name: 'Heuristic Processor',
    basePrice: 600,
    blurb: 'Attacco −15% ICE · Difesa +15% ICE (invece di 10).',
    image: '/h_heuristicprocessor.png',
    marketDesc:
      "Un'unità logica sperimentale che adatta i payload in tempo reale contro l'ICE. **Effetto:** L'Attacco rimuove il 15% di ICE e la Difesa ripristina il 15% (invece del 10 base).",
  },
]

export const SOFTWARE_ITEMS = [
  {
    id: SOFTWARE_IDS.ddos,
    name: 'DDoS Script',
    basePrice: 150,
    marketDesc:
      'Inonda un nodo bersaglio con traffico spazzatura. Attivo: Raddoppia i tempi di Travel in ingresso per tutti i giocatori verso un server specifico per 15 minuti.',
    shortDesc: 'Raddoppia tempi di Travel verso un server (15 min).',
    needsTarget: 'node',
    image: '/s_ddosscript.png',
  },
  {
    id: SOFTWARE_IDS.bailout,
    name: 'Bailout Token',
    basePrice: 250,
    marketDesc:
      'Una backdoor crittografica pre-compilata. Passivo: Se subisci un Kick, si consuma automaticamente per annullarlo. Resti connesso allo slot e previeni il blocco account.',
    shortDesc: 'Annulla un Kick in arrivo (consumo automatico).',
    passive: true,
    statusLabel: 'BAILOUT',
    image: '/s_bailouttoken.png',
  },
  {
    id: SOFTWARE_IDS.intel,
    name: 'Intel Package',
    basePrice: 100,
    marketDesc:
      'Intercetta i log di routing dei server globali. Attivo: Rivela istantaneamente su quale server o nodo si trova attualmente un giocatore bersaglio.',
    shortDesc: 'Rivela la posizione attuale di un giocatore.',
    needsTarget: 'player',
    image: '/s_intelpackage.png',
  },
  {
    id: SOFTWARE_IDS.jammer,
    name: 'Signal Jammer',
    basePrice: 150,
    marketDesc:
      "Genera rumore bianco sulle frequenze di tracciamento. Passivo: Se subisci un Trace, si consuma automaticamente per annullarlo e previene l'aumento di Sospetto.",
    shortDesc: 'Annulla un Trace in arrivo (consumo automatico).',
    passive: true,
    statusLabel: 'JAMMER',
    image: '/s_signaljammer.png',
  },
  {
    id: SOFTWARE_IDS.lockout,
    name: 'Lockout Script',
    basePrice: 150,
    marketDesc:
      'Sfrutta una vulnerabilità nei protocolli di accesso. Attivo: Disabilita completamente uno slot vuoto di un server per 10 minuti, impedendo a chiunque di connettersi.',
    shortDesc: 'Rende inaccessibile uno slot vuoto (10 min).',
    needsTarget: 'empty_slot',
    image: '/s_lockoutscript.png',
  },
  {
    id: SOFTWARE_IDS.wiper,
    name: 'Wiper Scrubber',
    basePrice: 350,
    marketDesc:
      'Instrada la connessione tramite proxy sicuri e volatili. Attivo: Per 3 minuti, non lasci tracce nei log di sistema e i Trace contro di te falliscono automaticamente.',
    shortDesc: 'Nasconde i log e respinge i Trace (dura 3 min).',
    image: '/s_wiperscrubber.png',
  },
]

export const CORE_DATA_ITEM = {
  id: CORE_DATA_ID,
  name: 'Core Data',
  blurb:
    'Victory Point. I Mercenary lo vendono all’Auction House; Corp/Rebel lo trasformano in Faction Score.',
  image: '/coredata.png',
  unsellable: true,
}

const ALL_ITEMS = [
  ...HELPDESK_SERVICES,
  ...HARDWARE_ITEMS,
  ...SOFTWARE_ITEMS,
  CORE_DATA_ITEM,
]

export function getCatalogItem(id) {
  return ALL_ITEMS.find((item) => item.id === id) ?? null
}

export function catalogMarketText(item) {
  return item?.marketDesc ?? item?.blurb ?? ''
}

export function catalogShortText(item) {
  return item?.shortDesc ?? item?.blurb ?? ''
}

export function parseInventory(raw) {
  if (Array.isArray(raw)) return raw.filter((e) => e && e.id && e.itemId)
  return []
}

export function isCoreDataItem(id) {
  return id === CORE_DATA_ID
}

export function softwareInventory(raw) {
  return parseInventory(raw).filter((e) => e.itemId !== CORE_DATA_ID)
}

export function coreDataCount(raw) {
  return parseInventory(raw).filter((e) => e.itemId === CORE_DATA_ID).length
}

export function parseOwnedHardware(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean)
  return []
}

export function isSoftwareItem(id) {
  return SOFTWARE_ITEMS.some((item) => item.id === id)
}

/** Passive software currently in inventory (Bailout, Jammer), with counts. */
export function inventoryPassives(raw) {
  const counts = new Map()
  for (const entry of parseInventory(raw)) {
    const item = getCatalogItem(entry.itemId)
    if (!item?.passive) continue
    counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
  }
  return SOFTWARE_ITEMS.filter((item) => item.passive && counts.has(item.id)).map(
    (item) => ({
      ...item,
      count: counts.get(item.id) ?? 1,
    }),
  )
}
