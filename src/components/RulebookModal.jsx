import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Briefcase,
  CircleHelp,
  Clock,
  Coins,
  Flag,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Swords,
  Users,
  X,
} from 'lucide-react'
import { useAudio } from '../hooks/useAudio'
import {
  EXTRACT_ICE_MAX,
  HEAT_MAX,
  HEAT_ON_KICK,
  HEAT_ON_TRACE,
  PA_MAX,
  TIME_ACTION,
  TIME_EXTRACT,
  TIME_KICK,
  TIME_TRACE,
  TIME_TRAVEL,
  UNBLOCK_COST,
} from '../lib/constants'
import { formatRemaining } from '../lib/actions'

const SECTIONS = [
  { id: 'rules', n: '01', label: 'Regole Generali', icon: ScrollText },
  { id: 'factions', n: '02', label: 'Fazioni', icon: Flag },
  { id: 'classes', n: '03', label: 'Classi & Abilità', icon: Sparkles },
  { id: 'economy', n: '04', label: 'Economia & PA', icon: Coins },
  { id: 'contracts', n: '05', label: 'Contratti & Aste', icon: Briefcase },
  { id: 'intel', n: '06', label: 'Spionaggio & Log', icon: Users },
  { id: 'tick', n: '07', label: 'Daily Tick & Tempo', icon: Clock },
  { id: 'strategy', n: '08', label: 'Strategie di Fazione', icon: Swords },
  { id: 'protocols', n: '09', label: 'Protocolli Avanzati', icon: ShieldAlert },
  { id: 'faq', n: '10', label: 'FAQ & Emergenze', icon: CircleHelp },
]

export default function RulebookModal({ open, onClose }) {
  const { playClick } = useAudio()
  const [section, setSection] = useState('rules')

  if (!open) return null

  function close() {
    playClick()
    onClose()
  }

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 pb-20 md:pb-4"
      onClick={close}
    >
      <div
        className="flex h-[min(88vh,760px)] w-full max-w-5xl flex-col overflow-hidden border border-cyan-500/30 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="min-w-0 text-left">
            <p className="font-display text-[10px] uppercase tracking-[0.35em] text-cyan-400/80">
              System Codex
            </p>
            <h2 className="font-display mt-1 truncate text-lg text-slate-100 sm:text-xl">
              [ SYSTEM CODEX // MANUALE OPERATIVO V2.4 ]
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex shrink-0 items-center gap-1.5 border border-slate-600 px-2.5 py-1.5 text-xs uppercase tracking-wider text-slate-300 hover:border-slate-400 hover:text-slate-100"
          >
            <X className="h-3.5 w-3.5" />
            Chiudi
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-800 px-3 py-2 md:w-56 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:px-3 md:py-4">
            {SECTIONS.map((item) => {
              const Icon = item.icon
              const selected = item.id === section
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    playClick()
                    setSection(item.id)
                  }}
                  className={`flex min-w-[10.5rem] items-center gap-2 px-3 py-2 text-left text-[11px] uppercase tracking-wider transition md:min-w-0 ${
                    selected
                      ? 'border border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : 'border border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-slate-600">{item.n}</span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <p className="font-display text-[10px] uppercase tracking-[0.3em] text-emerald-400/80">
              {active.n} // {active.label}
            </p>
            <div className="mt-4">
              {section === 'rules' && <SectionRules />}
              {section === 'factions' && <SectionFactions />}
              {section === 'classes' && <SectionClasses />}
              {section === 'economy' && <SectionEconomy />}
              {section === 'contracts' && <SectionContracts />}
              {section === 'intel' && <SectionIntel />}
              {section === 'tick' && <SectionTick />}
              {section === 'strategy' && <SectionStrategy />}
              {section === 'protocols' && <SectionProtocols />}
              {section === 'faq' && <SectionFaq />}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Heading({ children, tone = 'amber' }) {
  const color =
    tone === 'emerald'
      ? 'text-emerald-400'
      : tone === 'cyan'
        ? 'text-cyan-400'
        : tone === 'red'
          ? 'text-red-400'
          : tone === 'fuchsia'
            ? 'text-fuchsia-400'
            : 'text-amber-400'
  return (
    <h3
      className={`font-display text-base uppercase tracking-[0.2em] ${color}`}
    >
      {children}
    </h3>
  )
}

function Block({ children }) {
  return (
    <section className="border border-slate-800 bg-slate-900/50 p-4">
      {children}
    </section>
  )
}

function SectionRules() {
  return (
    <div className="space-y-4 text-left">
      <Block>
        <Heading>Il Tempo & La Durata</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Le partite sono strutturate a ciclo (es. un mese di alpha/beta). Il
          tempo di gioco scorre in tempo reale: ogni azione, cooldown e
          occupazione di slot è sincronizzata con l’orologio del mondo. Quando
          il ciclo si chiude, i sistemi archiviano VP, capitale e intel: la
          guerra ideologica e la classifica mercenary vengono calcolate in quel
          momento.
        </p>
        <ul className="mt-3 space-y-1 font-mono text-sm text-slate-300">
          <li>Travel / Login · {formatRemaining(TIME_TRAVEL)}</li>
          <li>Attack / Defend / Farm · {formatRemaining(TIME_ACTION)}</li>
          <li>Trace · {formatRemaining(TIME_TRACE)}</li>
          <li>Kick · {formatRemaining(TIME_KICK)}</li>
          <li>Extract · {formatRemaining(TIME_EXTRACT)}</li>
        </ul>
      </Block>

      <Block>
        <Heading tone="emerald">Il Daily Tick (Ore 08:00)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Ogni giorno alle <span className="text-slate-100">08:00</span> (ora
          italiana, Europe/Rome) i nodi eseguono il reset quotidiano:
        </p>
        <ul className="mt-3 space-y-1.5 text-base leading-relaxed text-slate-300">
          <li>
            I <span className="text-cyan-300">Punti Azione (PA)</span> tornano
            al massimo (<span className="text-slate-100">{PA_MAX}</span>).
          </li>
          <li>
            L’<span className="text-red-400">Heat (Sospetto)</span> cala di{' '}
            <span className="text-slate-100">−1</span>.
          </li>
          <li>
            Corp e Rebel ricevono{' '}
            <span className="text-amber-300">+1 VP</span> per ogni server
            controllato.
          </li>
          <li>
            Ogni Mercenario riceve{' '}
            <span className="text-amber-300">+100 ₵</span> per ogni server
            sotto controllo Mercenary.
          </li>
          <li>
            Gli account bloccati vengono sbloccati (
            <span className="font-mono text-[13px] text-slate-100">
              is_blocked = false
            </span>
            ).
          </li>
        </ul>
      </Block>

      <Block>
        <Heading>Tregua Notturna (Curfew)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Dalle <span className="text-slate-100">23:00</span> alle{' '}
          <span className="text-slate-100">07:59</span> i server entrano in
          manutenzione. Niente nuove operazioni (Attack, Defend, Farm, Extract)
          né abilità di classe, acquisti Afterlife o offerte d’asta. Trace e
          Kick restano ammessi solo contro uno slot che ha già un’operazione in
          corso. Alle 08:00 i sistemi tornano online insieme al Daily Tick.
        </p>
      </Block>

      <Block>
        <Heading tone="cyan">La Nebbia di Guerra (Fog of War)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Nessuna informazione è gratuita. Sulla mappa le slot nemiche non
          mostrano identità né azione: compaiono come{' '}
          <span className="text-amber-300">OCCUPATO</span> o{' '}
          <span className="text-fuchsia-300">SEGNALE INSTABILE</span>. Per
          scoprire chi c’è e cosa sta facendo è necessario eseguire un’azione
          di <span className="text-slate-100">Trace</span> (o un’abilità
          investigativa da Data Analyst). Le classi restano{' '}
          <span className="font-mono tracking-wider text-slate-500">
            [ ??? ]
          </span>{' '}
          finché non le decifri.
        </p>
      </Block>
    </div>
  )
}

function SectionFactions() {
  return (
    <div className="space-y-4 text-left">
      <p className="text-base leading-relaxed text-slate-300">
        La guerra è asimmetrica. Corp e Rebel si contendono la rete a colpi di
        VP. I Mercenary non giocano quella partita: giocano il capitale.
      </p>

      <Block>
        <Heading tone="cyan">Security Division (CORP)</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-blue-400">
          Synth-Corp Security Division
        </p>
        <dl className="mt-3 space-y-3 text-base leading-relaxed text-slate-300">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.25em] text-amber-400">
              Lore
            </dt>
            <dd className="mt-1">
              I difensori dell’ordine corporativo e dell’infrastruttura
              Synth-Corp. Il perimetro è sacro: ogni nodo perso è un asset che
              non torna.
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.25em] text-amber-400">
              Obiettivo
            </dt>
            <dd className="mt-1">
              Mantenere il controllo dei server per accumulare VP giornalieri e
              vincere la guerra ideologica a fine ciclo.
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.25em] text-amber-400">
              Meccanica
            </dt>
            <dd className="mt-1">
              Portano l’ICE a ≤ {EXTRACT_ICE_MAX}% ed eseguono l’Estrazione:
              il server passa sotto bandiera Corp, l’ICE viene rialzato a 100%
              e il nodo genera VP al Daily Tick. I Core Data non restano in
              inventario: diventano munizione per il Faction Score.
            </dd>
          </div>
        </dl>
      </Block>

      <Block>
        <Heading tone="red">Hacktivisti (REBEL)</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-red-400">
          Red Circuit Liberation Front
        </p>
        <dl className="mt-3 space-y-3 text-base leading-relaxed text-slate-300">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.25em] text-amber-400">
              Lore
            </dt>
            <dd className="mt-1">
              I ribelli della rete che lottano per liberare i dati dal monopolio
              corporativo. Extract è occupazione. Core Data è prova.
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.25em] text-amber-400">
              Obiettivo
            </dt>
            <dd className="mt-1">
              Sabotare i server, strapparli al controllo Corp e accumulare VP
              per vincere la guerra di rete a fine ciclo.
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.25em] text-amber-400">
              Meccanica
            </dt>
            <dd className="mt-1">
              Portano l’ICE a ≤ {EXTRACT_ICE_MAX}% ed eseguono l’Estrazione:
              il server passa al controllo Rebel, l’ICE torna a 100% e il nodo
              genera VP al Daily Tick. Anche per loro i Core Data non sono un
              oggetto fisico: sono territorio e punteggio.
            </dd>
          </div>
        </dl>
      </Block>

      <Block>
        <Heading>Consulenti / Mercenari (MERCENARY)</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-amber-400">
          Aureus Mercenary Syndicate
        </p>
        <dl className="mt-3 space-y-3 text-base leading-relaxed text-slate-300">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.25em] text-amber-400">
              Lore
            </dt>
            <dd className="mt-1">
              Spioni indipendenti senza bandiera, guidati unicamente dal
              profitto. Niente patriotismi. La guerra è un mercato.
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.25em] text-amber-400">
              Obiettivo
            </dt>
            <dd className="mt-1">
              Vincere la partita accumulando il capitale personale più alto in
              Crediti (₵) a fine ciclo. Il leaderboard, non il territorio,
              decide il ranking.
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.25em] text-amber-400">
              Meccanica
            </dt>
            <dd className="mt-1">
              Non fanno punti fazione. Quando estraggono un server (ICE ≤{' '}
              {EXTRACT_ICE_MAX}%), ne prendono il controllo (
              <span className="font-mono text-[13px] text-amber-200">
                owner_faction = consultant
              </span>
              ), l’ICE torna a 100% e rubano un Core Data fisico da vendere
              all’Asta Nera. Al Daily Tick,{' '}
              <span className="text-slate-100">ogni Mercenario</span> riceve{' '}
              <span className="text-amber-300">+100 ₵</span> per ogni server
              attualmente posseduto dalla fazione Mercenary. Possono anche
              speculare sulle aste altrui o farsi pagare da Corp e Rebel
              tramite i Gigs.
            </dd>
          </div>
        </dl>
      </Block>
    </div>
  )
}

function FieldLabel({ children }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.25em] text-amber-400">
      {children}
    </p>
  )
}

function AbilityItem({ name, pa, weekly, children }) {
  return (
    <li>
      <span className="text-slate-100">{name}</span>
      {pa != null ? (
        <span className="ml-2 text-[10px] uppercase tracking-[0.2em] text-cyan-400/90">
          {pa} PA
        </span>
      ) : null}
      {weekly ? (
        <span className="ml-2 text-[10px] uppercase tracking-[0.2em] text-amber-400/90">
          3 giorni
        </span>
      ) : null}
      <span className="text-slate-400"> — {children}</span>
    </li>
  )
}

function SectionClasses() {
  return (
    <div className="space-y-4 text-left">
      <p className="text-base leading-relaxed text-slate-300">
        Ogni operatore sceglie una classe. Le passive sono sempre attive. Le
        abilità giornaliere costano 1 PA (cooldown 24h); le abilità da 3 PA
        hanno cooldown di 3 giorni.
      </p>

      <Block>
        <Heading tone="cyan">SysAdmin</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-cyan-400">
          Controllo Rete &amp; Difesa
        </p>
        <div className="mt-3">
          <FieldLabel>Passive</FieldLabel>
          <p className="mt-1 text-base leading-relaxed text-slate-300">
            <span className="text-slate-100">Architettura Ottimizzata</span>
            {' — '}
            Timer di Difesa, Trace e Kick ridotti del{' '}
            <span className="text-slate-100">20%</span>.
          </p>
          <p className="mt-2 text-base leading-relaxed text-slate-300">
            <span className="text-slate-100">Sentinella di Rete</span>
            {' — '}
            Sui server della tua fazione, Attack/Extract nemici compaiono come{' '}
            <span className="text-red-300">ATTACCO RILEVATO</span> (senza
            identità).
          </p>
        </div>
        <div className="mt-4">
          <FieldLabel>Abilità Attive</FieldLabel>
          <ul className="mt-2 space-y-2 text-base leading-relaxed text-slate-300">
            <AbilityItem name="Hotfix" pa={1}>
              Modifica ICE ±5% su un nodo, senza travel né slot.
            </AbilityItem>
            <AbilityItem name="Kill Process" pa={1}>
              Kick istantaneo su uno slot occupato.
            </AbilityItem>
            <AbilityItem name="Hard Reboot" pa={3} weekly>
              Forza l’ICE di un server al 50%.
            </AbilityItem>
          </ul>
        </div>
      </Block>

      <Block>
        <Heading tone="fuchsia">Ghost</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-fuchsia-400">
          Infiltrazione &amp; Inganno
        </p>
        <div className="mt-3">
          <FieldLabel>Passive</FieldLabel>
          <p className="mt-1 text-base leading-relaxed text-slate-300">
            <span className="text-slate-100">Protocollo Fantasma</span>
            {' — '}
            Invisibile al radar globale (Panopticon incluso). Se subisci Trace,
            restituisce{' '}
            <span className="font-mono tracking-wider text-fuchsia-300">
              [ ENCRYPTED ID ]
            </span>{' '}
            tranne se il Trace è di un Data Analyst. Sulla Gigs Board l’ID resta
            criptato. Timer di Attacco −20%.
          </p>
          <p className="mt-2 text-base leading-relaxed text-slate-300">
            <span className="text-slate-100">Backdoor</span>
            {' — '}
            Slot D perennemente accessibile su ogni server. Qualsiasi azione su
            Slot D costa +1 PA.
          </p>
        </div>
        <div className="mt-4">
          <FieldLabel>Abilità Attive</FieldLabel>
          <ul className="mt-2 space-y-2 text-base leading-relaxed text-slate-300">
            <AbilityItem name="Decoy" pa={1}>
              Finto segnale su uno slot vuoto, per 1 ora.
            </AbilityItem>
            <AbilityItem name="Identity Spoof" pa={3} weekly>
              Per 12h i log e i Trace mostrano il nome di un altro giocatore.
            </AbilityItem>
          </ul>
        </div>
      </Block>

      <Block>
        <Heading tone="emerald">Data Analyst</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-emerald-400">
          Intelligence &amp; Sorveglianza
        </p>
        <div className="mt-3">
          <FieldLabel>Passiva</FieldLabel>
          <p className="mt-1 text-base leading-relaxed text-slate-300">
            <span className="text-slate-100">Panopticon</span>
            {' — '}
            Vede occupazione di tutti i server dalla mappa (i Ghost non
            compaiono) e i timer esatti di connessione sugli slot nemici, mentre
            gli altri vedono solo stime. Timer Trace −40%. I tuoi Trace
            penetrano lo stealth dei Ghost, rivelando la vera identità.
          </p>
        </div>
        <div className="mt-4">
          <FieldLabel>Abilità Attive</FieldLabel>
          <ul className="mt-2 space-y-2 text-base leading-relaxed text-slate-300">
            <AbilityItem name="Deep Scan" pa={1}>
              Trace istantaneo: identità e azione in corso.
            </AbilityItem>
            <AbilityItem name="Background Check" pa={1}>
              Registro log 24h di uno slot.
            </AbilityItem>
            <AbilityItem name="Doxxing" pa={3} weekly>
              Storico privato 24h di un utente.
            </AbilityItem>
          </ul>
        </div>
      </Block>

      <Block>
        <Heading>Executive</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-amber-400">
          Economia &amp; Finanza
        </p>
        <div className="mt-3">
          <FieldLabel>Passiva</FieldLabel>
          <p className="mt-1 text-base leading-relaxed text-slate-300">
            <span className="text-slate-100">Monopolio Fiscale</span>
            {' — '}
            Farming ×1.75 (50 ₵ → 88 ₵), costo creazione Gigs −25%, capacità
            hardware raddoppiata (<span className="text-slate-100">2</span>{' '}
            slot).
          </p>
        </div>
        <div className="mt-4">
          <FieldLabel>Abilità Attive</FieldLabel>
          <ul className="mt-2 space-y-2 text-base leading-relaxed text-slate-300">
            <AbilityItem name="Immunity" pa={1}>
              Scudo Legale: la prossima azione base (Attacco, Difesa, Farming)
              non può essere interrotta da Kick. Non si applica all’Estrazione.
            </AbilityItem>
            <AbilityItem name="NDA" pa={1}>
              Il bersaglio non può usare i Gigs per 8 ore.
            </AbilityItem>
            <AbilityItem name="Asset Freeze" pa={3} weekly>
              Il bersaglio non può spendere Crediti per 24 ore.
            </AbilityItem>
          </ul>
        </div>
      </Block>
    </div>
  )
}

function SectionEconomy() {
  return (
    <div className="space-y-4 text-left">
      <Block>
        <Heading tone="cyan">Punti Azione (PA)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Il carburante giornaliero: massimo{' '}
          <span className="text-slate-100">{PA_MAX} PA</span> (
          <span className="font-mono text-[13px] text-slate-100">
            zt_pa_max()
          </span>
          ). Si ricaricano ogni giorno alle{' '}
          <span className="text-slate-100">08:00</span> (Daily Tick) oppure
          tramite <span className="text-amber-300">Energy Coffee</span> all’Helpdesk:
          costa <span className="text-slate-100">300 ₵</span> e ripristina{' '}
          <span className="text-slate-100">+1 PA</span>, senza superare il cap
          di {PA_MAX}.
        </p>
      </Block>

      <Block>
        <Heading>Crediti (₵)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          La valuta di scambio. Servono per comprare hardware e software, e per
          finanziare i contratti sulla bacheca Gigs. I Mercenary accumulano
          capitale anche con la rendita Daily Tick (+100 ₵ per server
          controllato) e con la vendita dei Core Data.
        </p>
      </Block>

      <Block>
        <Heading tone="emerald">Reputazione (1–5 Stelle)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Basata sul completamento (e sui fallimenti) dei Gigs. Modifica i
          prezzi di Negozi e Helpdesk: 5★ −20%, 4★ −10%, 3★ prezzo base, 2★
          +10%, 1★ +20%.
        </p>
      </Block>

      <Block>
        <Heading tone="red">
          Livello di Sospetto (Heat 0–{HEAT_MAX} Teschi)
        </Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Aumenta se subisci un Trace riuscito (
          <span className="text-slate-100">+{HEAT_ON_TRACE}</span>) o un Kick (
          <span className="text-slate-100">+{HEAT_ON_KICK}</span>). Ogni teschio
          riduce del{' '}
          <span className="text-slate-100">10%</span> la durata dei Trace e
          Kick nemici contro di te. Decade di{' '}
          <span className="text-slate-100">−1</span> al Daily Tick, oppure si
          azzera con <span className="text-amber-300">Wipe Record</span> all’Helpdesk
          (200 ₵).
        </p>
      </Block>

      <Block>
        <Heading tone="cyan">Inventario (Hardware &amp; Software)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Puoi equipaggiare l’hardware (
          <span className="text-slate-100">1</span> slot,{' '}
          <span className="text-slate-100">2</span> per gli Executive) e
          trasportare fino a <span className="text-slate-100">3</span> script
          monouso: DDoS Script, Bailout Token, Intel Package, Signal Jammer,
          Lockout Script, Wiper Scrubber.
        </p>
      </Block>
    </div>
  )
}

function SectionContracts() {
  return (
    <div className="space-y-4 text-left">
      <Block>
        <Heading>I Contratti (Gigs)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Bacheca pubblica dove i giocatori pubblicano missioni versando crediti
          in <span className="text-amber-300">Escrow</span>. Chi accetta e
          completa guadagna crediti e reputazione. Se il contratto è ancora{' '}
          <span className="font-mono text-[13px] text-emerald-300">OPEN</span>,
          il creatore può ritirarlo senza penali (rimborso 100%). Se è{' '}
          <span className="font-mono text-[13px] text-amber-300">
            IN_PROGRESS
          </span>{' '}
          e scade o viene annullato, scatta una penale a scaglioni: 3–5★ perdono
          1 stella senza blocco; 2★ scendono a 1★ e vengono bloccati; 1★ resta a
          1★ e viene bloccato.
        </p>
      </Block>

      <Block>
        <Heading tone="amber">Aste &amp; Core Data (Endgame)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          I Mercenari estraggono i server (ICE ≤ {EXTRACT_ICE_MAX}%): ne
          prendono il controllo e ottengono un{' '}
          <span className="text-slate-100">Core Data</span> fisico da mettere
          all’asta al Black Market. Corp e Rebel fanno offerte in crediti
          (Escrow automatico): se vincono, il Core Data diventa +1 VP di
          fazione. Un Mercenario che vince un’asta recupera il Core Data, non i
          VP. Il venditore incassa l’offerta. Ogni giorno, i server Merc pagano
          rendita a tutta la fazione.
        </p>
      </Block>
    </div>
  )
}

function SectionIntel() {
  return (
    <div className="space-y-4 text-left">
      <Block>
        <Heading tone="cyan">La Directory Utenti (Tab “Utenti”)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Una rubrica globale di rete che mostra i giocatori attivi. Per motivi
          di sicurezza Zero Trust, la classe di tutti gli altri giocatori
          appare come{' '}
          <span className="font-mono tracking-wider text-slate-500">
            [ ??? ]
          </span>
          .
        </p>
      </Block>

      <Block>
        <Heading>Rivelazione della Classe</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          La classe di un utente non si rivela mai da sola. Diventa visibile{' '}
          <span className="text-slate-100">esclusivamente</span> a chi esegue
          con successo un’azione investigativa —{' '}
          <span className="text-slate-100">Trace</span>,{' '}
          <span className="text-slate-100">Deep Scan</span>,{' '}
          <span className="text-slate-100">Background Check</span> o{' '}
          <span className="text-slate-100">Doxxing</span> — salvando l’
          informazione nel proprio archivio d’intelligence privato (
          <span className="font-mono text-[13px]">class_known</span>).
        </p>
      </Block>

      <Block>
        <Heading tone="amber">Supposizioni di Fazione</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Puoi cliccare su qualsiasi utente nella directory per assegnargli
          un’etichetta di fazione personale (
          <span className="text-cyan-300">Corp</span>,{' '}
          <span className="text-red-400">Rebel</span>,{' '}
          <span className="text-amber-300">Mercenary</span>) e scrivere note
          private per tracciare i tuoi sospetti.
        </p>
      </Block>

      <Block>
        <Heading tone="fuchsia">Intel Registry (Log Personali)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Il tuo feed di eventi è privato. Mostra le tue azioni, i tentativi
          ostili subiti e gli allarmi di intrusione sui server della tua
          fazione. Se vieni attaccato da un Ghost senza aver
          fatto un Trace, il log registrerà un anonimo{' '}
          <span className="font-mono tracking-wider text-fuchsia-300">
            [ ENCRYPTED ID ]
          </span>
          .
        </p>
      </Block>
    </div>
  )
}

function SectionTick() {
  return (
    <div className="space-y-4 text-left">
      <Block>
        <Heading tone="emerald">Il Daily Tick (Ore 08:00)</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Ogni giorno alle <span className="text-slate-100">08:00</span> (ora
          italiana, Europe/Rome) il server esegue{' '}
          <span className="font-mono text-[13px] text-slate-100">
            simulate_daily_tick()
          </span>
          :
        </p>
        <ul className="mt-3 space-y-1.5 text-base leading-relaxed text-slate-300">
          <li>
            I <span className="text-cyan-300">Punti Azione (PA)</span> di tutti
            i giocatori tornano al massimo (
            <span className="text-slate-100">{PA_MAX}</span>).
          </li>
          <li>
            Il <span className="text-red-400">Livello di Sospetto (Heat)</span>{' '}
            cala di <span className="text-slate-100">−1</span> per tutti (se
            Heat &gt; 0).
          </li>
          <li>
            Ogni server Corp (<span className="font-mono text-[13px]">security</span>
            ) e Rebel (
            <span className="font-mono text-[13px]">hacktivist</span>) genera{' '}
            <span className="text-amber-300">+1 VP</span> al Faction Score.
          </li>
          <li>
            Rendita Mercenary: ogni profilo{' '}
            <span className="font-mono text-[13px]">consultant</span> riceve{' '}
            <span className="text-amber-300">+100 ₵</span> per ogni server con{' '}
            <span className="font-mono text-[13px] text-amber-200">
              owner_faction = consultant
            </span>
            .
          </li>
          <li>
            Gli account bloccati vengono sbloccati automaticamente (
            <span className="font-mono text-[13px] text-slate-100">
              is_blocked = false
            </span>
            ), per evitare soft-lock.
          </li>
        </ul>
      </Block>

      <Block>
        <Heading>Tregua Notturna (Curfew)</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-slate-400">
          Dalle 23:00 alle 07:59
        </p>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          I server entrano in manutenzione protetta. Niente nuove occupazioni
          offensive (Attack, Defend, Farm, Extract), niente abilità di classe,
          niente acquisti Helpdesk/Afterlife né offerte d’asta. Trace e Kick
          restano disponibili come contromisura reattiva se il bersaglio ha già
          un’operazione in corso. Alle 08:00 i sistemi tornano online insieme al
          Daily Tick.
        </p>
      </Block>
    </div>
  )
}

function SectionStrategy() {
  return (
    <div className="space-y-4 text-left">
      <p className="text-base leading-relaxed text-slate-300">
        La vittoria non è simmetrica. Ogni fazione vince una guerra diversa:
        territorio, sabotaggio, o capitale.
      </p>

      <Block>
        <Heading tone="cyan">Per i Security (CORP)</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-blue-400">
          Synth-Corp Security Division
        </p>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Coordinarsi con i SysAdmin per difendere i server chiave. Usate gli
          Executive per finanziare contratti di difesa tramite Gigs e tenete
          d’occhio i Mercenari: comprate i Core Data all’asta prima dei ribelli.
        </p>
      </Block>

      <Block>
        <Heading tone="red">Per gli Hacktivisti (REBEL)</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-red-400">
          Red Circuit Liberation Front
        </p>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Sfruttate i Ghost per infiltrarvi senza lasciare tracce e abbassare
          l’ICE sotto il <span className="text-slate-100">
            {EXTRACT_ICE_MAX}%
          </span>
          . Coordinate attacchi simultanei per superare la capacità di difesa
          dei SysAdmin corporativi.
        </p>
      </Block>

      <Block>
        <Heading>Per i Mercenari (MERCENARY)</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-amber-400">
          Aureus Mercenary Syndicate
        </p>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Non schieratevi. Fate il prezzo più alto. Tenete i server Merc per la
          rendita Daily Tick (+100 ₵ a testa per nodo), sfruttate le
          informazioni dei Data Analyst, estraete quando nessuno guarda e fate
          scatenare le aste al rialzo nel Black Market.
        </p>
      </Block>
    </div>
  )
}

function SectionProtocols() {
  return (
    <div className="space-y-4 text-left">
      <p className="text-base leading-relaxed text-slate-300">
        I nodi non perdonano gli exploit. Questi protocolli chiudono i loop
        economici e definiscono i limiti hard del loadout e del combattimento.
      </p>

      <Block>
        <Heading tone="red">Black Market Depreciation</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-red-400">
          Anti-Exploit Economico
        </p>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Per evitare speculazioni infinite sui prezzi scontati di reputazione,
          la vendita di software e hardware al mercato nero restituisce sempre
          il <span className="text-slate-100">50%</span> del valore base,
          indipendentemente dai bonus di reputazione.
        </p>
      </Block>

      <Block>
        <Heading>Dual Hardware</Heading>
        <p className="mt-3 text-sm uppercase tracking-[0.25em] text-amber-400">
          Privilegio Executive
        </p>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Gli Executive possono installare contemporaneamente{' '}
          <span className="text-slate-100">2</span> componenti hardware nel
          proprio loadout, raddoppiando i passivi strategici (es.{' '}
          <span className="text-slate-100">RAM Upgrade + GPS Spoofer</span>).
          Tutte le altre classi hanno un limite rigido di{' '}
          <span className="text-slate-100">1</span> slot hardware.
        </p>
      </Block>

      <Block>
        <Heading tone="cyan">L’Anatomia di un Trace &amp; Kick</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Quando un nemico avvia un Trace su di te, il{' '}
          <span className="text-amber-300">Signal Jammer</span> si consuma
          automaticamente per annullarlo (e blocca l’aumento di Heat). Un{' '}
          <span className="text-amber-300">Bailout Token</span> fa lo stesso
          contro i Kick. Il <span className="text-slate-100">GPS Spoofer</span>{' '}
          rallenta Trace e Kick nemici del 30%; ogni punto di Heat li accelera
          del 10%. La Crypto Network Card riduce Travel/Login, non i Trace.
        </p>
      </Block>
    </div>
  )
}

function SectionFaq() {
  return (
    <div className="space-y-4 text-left">
      <p className="text-base leading-relaxed text-slate-300">
        Procedure d’emergenza. Se la rete ti chiude fuori, leggi qui prima di
        aprire un ticket.
      </p>

      <Block>
        <Heading tone="red">
          Cosa succede se il mio account viene bloccato (Kick)?
        </Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Non puoi effettuare azioni o viaggiare. Devi recarti all’
          <span className="text-amber-300">Afterlife IT Helpdesk</span> e
          pagare la tassa di sblocco (
          <span className="text-slate-100">{UNBLOCK_COST} ₵</span>, Account
          Unlock), oppure attendere il reset automatico del Daily Tick delle{' '}
          <span className="text-slate-100">08:00</span> (
          <span className="font-mono text-[13px]">is_blocked = false</span>).
        </p>
      </Block>

      <Block>
        <Heading>Posso cancellare un contratto (Gig) se ci ripenso?</Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Se nessuno lo ha ancora accettato (
          <span className="font-mono tracking-wider text-emerald-300">
            OPEN
          </span>
          ), puoi ritirarlo senza penali e riavere il{' '}
          <span className="text-slate-100">100%</span> dell’escrow. Se è già in
          corso (
          <span className="font-mono tracking-wider text-amber-300">
            IN_PROGRESS
          </span>
          ), l’annullamento (o la scadenza) applica una penale a scaglioni: 3–5★
          perdono 1 stella senza blocco; a 2★ scendi a 1★ e vieni bloccato; a 1★
          resti a 1 stella e scatterà il blocco account.
        </p>
      </Block>

      <Block>
        <Heading tone="amber">
          Come fanno i Mercenari a vincere se non fanno punti fazione?
        </Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          I Mercenari vincono accumulando il capitale personale più alto in
          Crediti (₵). Non partecipano alla guerra ideologica: speculano
          vendendo i Core Data all’Asta Nera, si fanno pagare da Corp e Rebel
          tramite i Gigs, e incassano la rendita Daily Tick (+100 ₵ per ogni
          server con owner_faction Mercenary).
        </p>
      </Block>

      <Block>
        <Heading tone="cyan">
          La Tregua Notturna blocca anche la chat o le aste?
        </Heading>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          La tregua notturna (
          <span className="text-slate-100">23:00–07:59</span>) blocca le nuove
          operazioni sui server (Attack, Defend, Farm, Extract), le abilità di
          classe, gli acquisti Helpdesk/Afterlife e la creazione/offerte d’asta.
          Trace e Kick restano ammessi contro slot già occupati da un’operazione
          in corso. La navigazione, la directory e la visione di Afterlife e
          aste restano attive; vendita/equip hardware restano disponibili.
        </p>
      </Block>
    </div>
  )
}
