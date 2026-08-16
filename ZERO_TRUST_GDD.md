ZERO TRUST - Game Design Document (GDD)
1. Concept e Visione
Zero Trust è un gioco gestionale/deduttivo multiplayer asincrono (ma con aggiornamenti in tempo reale) a tema hacking corporativo. I giocatori agiscono come dipendenti di una corporazione (Synth-Corp), ma segretamente appartengono a diverse fazioni con obiettivi contrastanti. Il gameplay si basa sulla gestione del tempo (timer reali), punti azione e interazioni sui server tramite "Slot".
2. Architettura Consigliata (Per l'IA)
Frontend: React (Vite) + Tailwind CSS + Lucide React (per le icone).
Backend/Database: Supabase (PostgreSQL + Realtime subscriptions).
Gestione Stato: React Context o Zustand, interfacciato costantemente con Supabase per riflettere i cambiamenti degli altri giocatori in tempo reale.
3. Entità Principali del Database (Bozza Struttura)
Users: id, name, faction, role, creds (valuta), pa (Punti Azione), status (IDLE, BUSY, TRAVELING), isBlocked, frozenUntil (timestamp), buffs (array), cooldowns (json).
Nodes (Server/Servizi): id, name, type (server, service), ice (0-100, solo per server), compromised (boolean).
Slots (Le porte d'accesso dei Server): 3 slot (A, B, C) per ogni server. Tracciano l'attività in corso: node_id, slot_id, user_id, action_type, start_time, end_time, isDecoy, isSpoofed.
Logs: Registro globale o per server degli eventi.
Gigs (Contratti): Mercato delle missioni create dai giocatori.
4. Costanti e Timer (Valori Reali in millisecondi)
I valori possono essere bilanciati in seguito, ma la struttura deve supportarli.
MAX_PA / PA_MAX: 5 (ricaricati ogni 24h).
STARTING_CREDS: 150 ₵.
TIME_TRAVEL: 30000ms (30 sec) - Dimezzato se si ha il buff VPN.
TIME_ACTION (Attacco/Difesa/Farm): 300000ms (5 min).
TIME_TRACE: 120000ms (2 min).
TIME_DEEP_SCAN: 90000ms (1.5 min).
TIME_KICK: 60000ms (1 min).
TIME_EXTRACT: 300000ms (5 min).
DECOY_DURATION: 3600000ms (1 ora).
FREEZE_DURATION: 86400000ms (24 ore).
5. Fazioni e Condizioni di Vittoria
Assegnate (random o a scelta) alla creazione dell'account.
Security (Corp): Difensori. Obiettivo: Mantenere l'ICE dei server > 50%.
Hacktivisti (Rebel): Sabotatori. Obiettivo: Portare l'ICE dei server <= 20% ed eseguire l'azione "Extract".
Consulenti (Merc): Opportunisti. Obiettivo: Accumulare 2000 ₵.
6. Classi e Abilità
Costano PA e/o hanno Cooldown (Giornalieri/Settimanali).
SysAdmin (Terminale): Maestro dell'efficienza.
Passiva (Overclock): Le azioni base (Attacco/Difesa) durano il 25% in meno.
Daily (Hotfix): Modifica istantaneamente l'ICE di un server del +/- 5%. Costo: 1 PA.
Weekly (Hard Reboot): Resetta forzatamente l'ICE di un server al 50%.
Data Analyst (Ricerca): Investigatore.
Passiva (Panopticon): Vede i timer esatti di connessione sugli slot. Trace, Kick e Scan durano il 25% in meno.
Daily (Deep Scan): Un Trace avanzato che rivela l'identità E l'azione in corso dell'utente.
Weekly (Doxxing): Ottiene il log completo delle 24h di un bersaglio (si usa nel Bar Afterlife).
Executive (Valigetta): Finanziatore.
Passiva (Bonus Fiscale): +100% di guadagno dal Farming (+60 ₵ invece di +30 ₵). Creare contratti (Gigs) costa il 25% in meno.
Daily (Immunità): Rende la prossima azione immune ai Kick nemici. Costo: 1 PA.
Weekly (Congelamento): Blocca il conto di un bersaglio per 24h (non può spendere, ma può incassare).
Ghost (Occhio): Infiltrato.
Passiva (Stealth Protocol): Non viene contato nella dashboard dell'Analyst. Se subisce un Trace, risulta "ID CRIPTATO".
Daily (Decoy): Inserisce un falso segnale "Unknown" su uno slot per 1 ora. Finge di fare Farm. Costo: 1 PA.
Weekly (Spoofing): Come il Decoy, ma il giocatore sceglie quale nome (di un altro utente) e quale azione simulare per ingannare gli scan nemici. Costo: 1 PA.
7. I Nodi (Mappa)
Server (Aegis Prime, Helix Core, Omni Grid): Hanno una % di ICE. Hanno 3 Slot (A, B, C). Se l'ICE va a 0 (o <=20), i ribelli possono "Estrarre".
Bar Afterlife (Servizio): Hub per comprare Intel (Info sui server o tracking giocatori) e per gestire i Gigs (Contratti mercenari).
Helpdesk IT (Servizio): Hub per sbloccare l'account o comprare Buffs (VPN, Firewall, Miner).
8. Le Azioni (Negli Slot dei Server)
Quando un utente entra in uno slot, il suo stato diventa BUSY e parte un timer. Mentre esegue queste azioni, è vulnerabile alle contromisure (Trace/Kick).
Attacco: -10% ICE.
Difesa: +10% ICE.
Farming: Genera +30 ₵ al completamento.
Estrazione: Possibile solo se ICE <= 20%. Rende il nodo Compromesso.
Contromisure (Targeting su altri Slot occupati):
Trace: Rivela chi è l'utente.
Kick: Espelle l'utente dallo slot interrompendo la sua azione, e imposta il suo isBlocked a TRUE.
9. Penali e Blocchi (Helpdesk)
Se un utente subisce un Kick, il suo account viene "Bloccato".
Un account bloccato non può viaggiare o agire. Deve recarsi all'Helpdesk e pagare 100 ₵ per lo sblocco.
10. Bar Afterlife (Gigs e Intel)
I giocatori possono pubblicare Gigs (es. "Attacca Aegis per 6 ore, offro 200 ₵"). I crediti vengono scalati subito al creatore (scontati per gli Exec) e dati all'esecutore a fine lavoro.
Se chi accetta il Gig non lo completa entro il tempo limite, viene bloccato.
Intel: Si paga (50 ₵) per sapere lo stato esatto di un server e i log recenti, oppure per sapere l'ultima posizione di un giocatore.
