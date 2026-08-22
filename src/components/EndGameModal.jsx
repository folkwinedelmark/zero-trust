import { Crown, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import DebugPanel from '../debug/DebugPanel'
import {
  factionBarClass,
  factionBarTag,
  factionById,
  factionTitle,
  isMercFaction,
} from '../lib/constants'
import { CONFIRM_RESET_TOTAL } from '../lib/gameSession'

const FACTION_END = {
  security: {
    win: 'Il perimetro tiene. Synth-Corp archivia i nodi. La rete resta proprietà di chi la difende.',
    lose: 'Breccia critica. I board chiedono la tua testa. Ritirati. Non c’è perimetro da salvare.',
  },
  hacktivist: {
    win: 'I nodi cadono. Il Circuito Rosso scrive il nuovo firmware della città. La Corporation ha perso il segnale.',
    lose: 'La rivolta è stata contenuta. Disperdetevi. Il segnale è morto e i log sono già in mano al nemico.',
  },
}

function BannerImage({ faction, corrupted = false }) {
  if (!faction) return null
  return (
    <img
      src={faction.banner}
      alt=""
      className={`absolute inset-0 h-full w-full object-cover object-center ${
        corrupted ? 'endgame-banner-corrupt' : ''
      }`}
      onError={(event) => {
        const img = event.currentTarget
        if (img.dataset.fallback === '1') return
        img.dataset.fallback = '1'
        if (faction.bannerJpg) img.src = faction.bannerJpg
      }}
    />
  )
}

function podiumTone(rank) {
  if (rank === 1) {
    return 'border-amber-400/70 bg-amber-500/15 text-amber-100 shadow-[0_0_22px_rgba(245,158,11,0.28)]'
  }
  if (rank === 2) {
    return 'border-zinc-400/50 bg-zinc-800/70 text-zinc-100'
  }
  if (rank === 3) {
    return 'border-orange-800/50 bg-orange-950/40 text-orange-100'
  }
  return 'border-zinc-700 bg-zinc-950/70 text-zinc-300'
}

export default function EndGameModal({ session }) {
  const { profile } = useAuth()
  const result = session.matchResult ?? {}
  const faction = factionById(profile?.faction)
  const merc = isMercFaction(profile?.faction)
  const corpScore = Number(result.corp_score ?? 0)
  const rebelScore = Number(result.rebel_score ?? 0)
  const winner = result.winning_faction ?? session.winningFaction ?? null
  const draw = Boolean(result.draw) || (!winner && corpScore === rebelScore)
  const won = Boolean(winner && profile?.faction === winner)
  const isHost = Boolean(session.isHost)
  const mercs = Array.isArray(result.mercs) ? result.mercs : []
  const podium = mercs.slice(0, 3)
  const myMerc = mercs.find((row) => row.id === profile?.id) ?? null
  const myRank = Number(myMerc?.rank) || 0
  const mercWinner =
    myRank === 1 ||
    profile?.id === (result.winning_mercenary_id ?? session.winningMercenaryId)

  async function restart() {
    if (!isHost) return
    if (!window.confirm(CONFIRM_RESET_TOTAL)) return
    await session.reset()
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-zinc-950">
      <div className="relative min-h-svh">
        <BannerImage faction={faction} corrupted={!merc && !won && !draw} />
        <div
          className={`absolute inset-0 ${
            merc
              ? 'bg-gradient-to-t from-zinc-950 via-zinc-950/85 to-amber-950/30'
              : won
                ? 'bg-gradient-to-t from-zinc-950 via-zinc-950/75 to-zinc-950/35'
                : 'bg-gradient-to-t from-black via-red-950/50 to-zinc-950/70'
          }`}
        />
        <div
          aria-hidden
          className="endgame-scanlines pointer-events-none absolute inset-0"
        />

        <div className="relative mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-end px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-6 flex items-start justify-between gap-3">
            <p className="font-display text-xs uppercase tracking-[0.4em] text-amber-400/85">
              End of Cycle
            </p>
            <DebugPanel />
          </div>

          {merc ? (
            <MercenaryOutcome
              faction={faction}
              podium={podium}
              myRank={myRank}
              myCreds={myMerc?.creds ?? profile?.creds ?? 0}
              winner={mercWinner}
              profileId={profile?.id}
            />
          ) : (
            <FactionOutcome
              faction={faction}
              won={won}
              draw={draw}
              winner={winner}
              corpScore={corpScore}
              rebelScore={rebelScore}
            />
          )}

          {session.error && (
            <p className="mt-4 border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {session.error}
            </p>
          )}

          <div className="mt-8">
            {isHost ? (
              <button
                type="button"
                disabled={session.busy}
                onClick={() => void restart()}
                className="flex w-full items-center justify-center gap-2 bg-amber-500 px-6 py-3 text-sm font-medium uppercase tracking-[0.18em] text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {session.busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Riavvia protocollo (torna alla lobby)
              </button>
            ) : (
              <p className="text-center text-[11px] uppercase tracking-wider text-zinc-500">
                In attesa dell’host per il reset
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FactionOutcome({
  faction,
  won,
  draw,
  winner,
  corpScore,
  rebelScore,
}) {
  const headline = draw
    ? '[ STALLO DI RETE ]'
    : won
      ? '[ VITTORIA IDEOLOGICA ]'
      : '[ PROTOCOLLO DI EMERGENZA - SCONFITTA ]'
  const lore = draw
    ? 'Nessuna fazione ha chiuso il ciclo. I nodi restano contesi. Archiviazione in stallo.'
    : won
      ? (FACTION_END[faction?.id]?.win ?? 'Ciclo chiuso. La tua fazione controlla la rete.')
      : (FACTION_END[faction?.id]?.lose ??
        'Ciclo chiuso. La tua fazione ha perso il controllo della rete.')
  const winnerTag = winner ? factionBarTag(winner) : 'NESSUNO'

  return (
    <div className="text-left">
      <div className="flex items-center gap-4">
        {faction?.logo && (
          <img
            src={faction.logo}
            alt=""
            className={`h-20 w-20 shrink-0 object-contain ${
              won ? (faction.glowClass ?? '') : 'opacity-50 grayscale'
            }`}
          />
        )}
        <div className="min-w-0">
          <p
            className={`text-[11px] uppercase tracking-[0.3em] ${
              faction ? factionBarClass(faction.id) : 'text-zinc-400'
            }`}
          >
            {faction ? `[${factionBarTag(faction.id)}]` : '[ UNASSIGNED ]'}
          </p>
          <h1
            className={`font-display mt-1 text-3xl font-semibold tracking-wide sm:text-4xl ${
              draw ? 'text-zinc-200' : won ? 'text-zinc-50' : 'endgame-glitch-text text-red-300'
            }`}
          >
            {headline}
          </h1>
        </div>
      </div>

      <p className="mt-6 max-w-2xl text-sm leading-relaxed text-zinc-300 sm:text-base">
        {lore}
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <ScoreCard label="Corp VP" value={corpScore} tone="text-blue-300" />
        <ScoreCard label="Rebel VP" value={rebelScore} tone="text-red-300" />
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-[0.25em] text-zinc-500">
        Vincitore ideologico: {winnerTag}
        {faction?.title ? ` · ${factionTitle(faction.id)}` : ''}
      </p>
    </div>
  )
}

function MercenaryOutcome({
  faction,
  podium,
  myRank,
  myCreds,
  winner,
  profileId,
}) {
  return (
    <div className="text-left">
      <div className="flex items-center gap-4">
        {faction?.logo && (
          <img
            src={faction.logo}
            alt=""
            className={`h-20 w-20 shrink-0 object-contain ${faction.glowClass ?? ''}`}
          />
        )}
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-amber-400">
            [MERCENARY]
          </p>
          <h1
            className={`font-display mt-1 text-2xl font-semibold tracking-wide sm:text-3xl ${
              winner ? 'text-amber-200' : 'text-zinc-200'
            }`}
          >
            {winner
              ? '[ BERSAGLIO RAGGIUNTO: ESTRATTO CON SUCCESSO CON IL CAPITALE MASSIMO ]'
              : '[ LIQUIDITÀ INSUFFICIENTE - ABBANDONATO SUL SETTORE ]'}
          </h1>
        </div>
      </div>

      <p className="mt-5 text-sm leading-relaxed text-zinc-300">
        {winner
          ? 'Hai spremuto il ciclo fino all’ultimo credito. Il settore ti paga. Gli altri restano sul marciapiede.'
          : `Rank #${myRank || '—'} · ${myCreds} ₵. Il capitale non basta. Il settore ti scarica e passa al prossimo contratto.`}
      </p>

      <p className="mt-8 text-[10px] uppercase tracking-[0.35em] text-amber-400/80">
        Podio capitale
      </p>
      <ol className="mt-3 space-y-2">
        {podium.length === 0 ? (
          <li className="border border-zinc-700 px-4 py-3 text-sm text-zinc-500">
            Nessun mercenary in archivio.
          </li>
        ) : (
          podium.map((row) => {
            const mine = row.id === profileId
            return (
              <li
                key={row.id}
                className={`flex items-center justify-between gap-3 border px-4 py-3 ${podiumTone(row.rank)} ${
                  mine && row.rank === 1 ? 'ring-1 ring-amber-300/70' : ''
                }`}
              >
                <span className="flex items-center gap-2 font-display text-sm tracking-wide">
                  {row.rank === 1 && (
                    <Crown className="h-4 w-4 text-amber-300" />
                  )}
                  #{row.rank} {row.name}
                  {mine ? (
                    <span className="text-[10px] uppercase tracking-wider text-amber-300">
                      tu
                    </span>
                  ) : null}
                </span>
                <span className="font-semibold text-amber-300">
                  {row.creds} ₵
                </span>
              </li>
            )
          })
        )}
      </ol>
    </div>
  )
}

function ScoreCard({ label, value, tone }) {
  return (
    <div className="border border-zinc-700/80 bg-zinc-950/70 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        {label}
      </p>
      <p className={`font-display mt-1 text-3xl ${tone}`}>{value}</p>
    </div>
  )
}
