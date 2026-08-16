import { useEffect, useMemo, useState } from 'react'
import {
  Clock,
  Crosshair,
  Loader2,
  ShieldAlert,
  Star,
  X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAudio } from '../hooks/useAudio'
import { isEffectActive } from '../lib/abilities'
import { formatRemaining } from '../lib/actions'
import {
  GIG_ACTIONS,
  GIG_MAX_REWARD,
  GIG_MIN_REWARD,
  GIG_TIME_LIMITS,
  formatGigDuration,
  formatGigTitle,
  gigActionMeta,
  gigAbortConfirmCopy,
  gigCreateCost,
  gigDeadlineMs,
  gigStatusLabel,
  isGigExpired,
  maskGhostName,
  GHOST_BOARD_HANDLE,
} from '../lib/gigs'
import { gigAbort, gigAccept, gigCreate } from '../lib/gigsApi'
import { writeLog } from '../lib/logging'
import { supabase } from '../lib/supabase'
import ConfirmModal from './ConfirmModal'

export default function GigsBoard({
  node,
  busy,
  setBusy,
  setError,
  setOk,
  gigsState = null,
}) {
  const { profile, refreshProfile } = useAuth()
  const { playSuccess, playError } = useAudio()
  const {
    openBoard = [],
    myActive = [],
    myClosed = [],
    loading = false,
    error = null,
    reload = async () => {},
    userId = profile?.id ?? null,
  } = gigsState ?? {}
  const [now, setNow] = useState(Date.now())
  const [confirm, setConfirm] = useState(null)
  const [servers, setServers] = useState([])
  const [players, setPlayers] = useState([])
  const catalogs = useMemo(() => ({ servers, players }), [servers, players])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('nodes')
      .select('id, name, type')
      .eq('type', 'server')
      .order('name')
      .then(({ data }) => {
        if (!cancelled) setServers(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!userId) return undefined
    let cancelled = false
    supabase
      .from('profiles')
      .select('id, name')
      .neq('id', userId)
      .order('name')
      .then(({ data }) => {
        if (!cancelled) setPlayers(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    const needsTick = myActive.some((g) => g.status === 'IN_PROGRESS' && g.deadline)
    if (!needsTick) return undefined
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [myActive])

  const blocked = Boolean(profile?.is_blocked)
  const creds = profile?.creds ?? 0

  async function run(label, fn, log) {
    if (!profile || busy) return null
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const result = await fn()
      if (result?.error) throw result.error
      await refreshProfile()
      await reload()
      setOk(label)
      playSuccess()
      if (log && profile) {
        await writeLog({
          eventType: log.eventType,
          message: log.message,
          outcome: log.outcome ?? 'success',
          nodeId: node?.id ?? null,
          actorId: profile.id,
          targetId: log.targetId ?? null,
          meta: { tone: log.outcome ?? 'success', node_name: node?.name },
        })
      }
      return result?.data
    } catch (err) {
      playError()
      setError(err.message ?? 'Operazione fallita')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate({ targetAction, targetEntityId, reward, timeLimit }) {
    if (isEffectActive(profile?.nda_until)) {
      playError()
      setError('NDA: non puoi interagire con i Gigs per 8h.')
      return null
    }
    if (isEffectActive(profile?.frozen_until)) {
      playError()
      setError('Asset Freeze: non puoi spendere crediti per 24h.')
      return null
    }
    const cost = gigCreateCost(reward, profile?.role)
    if (creds < cost) {
      playError()
      setError(`Servono ${cost} ₵ in escrow`)
      return null
    }
    const title = formatGigTitle(
      { target_action: targetAction, target_entity_id: targetEntityId },
      catalogs,
    )
    return run(`Gig pubblicato · ${reward} ₵ in escrow`, () =>
      gigCreate({
        targetAction,
        targetEntityId,
        reward,
        timeLimitSeconds: timeLimit,
      }),
    {
      eventType: 'gig_create',
      message: `Gig pubblicato: ${title} — ${reward} ₵`,
    })
  }

  async function handleAccept(gig) {
    if (isEffectActive(profile?.nda_until)) {
      playError()
      setError('NDA: non puoi interagire con i Gigs per 8h.')
      return
    }
    await run(`Contratto accettato`, () => gigAccept(gig.id), {
      eventType: 'gig_accept',
      message: `Gig accettato: ${formatGigTitle(gig, catalogs)} — ${gig.reward} ₵`,
      targetId: gig.creator_id,
    })
  }

  async function handleAbort(gig) {
    const copy = gigAbortConfirmCopy(profile?.reputation, gig, userId)
    await run(copy.okLabel, () => gigAbort(gig.id))
  }

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <CreateGigForm
        profile={profile}
        creds={creds}
        blocked={blocked}
        busy={busy}
        servers={servers}
        players={players}
        onCreate={handleCreate}
      />

      <Section
        title="Board pubblica"
        subtitle="Contratti OPEN di altri player. Accettare nasconde il gig dalla board."
        className="rounded-xl border border-slate-700 bg-slate-900 p-6"
      >
        {loading && openBoard.length === 0 ? (
          <Empty hint="Caricamento board…" />
        ) : openBoard.length === 0 ? (
          <Empty hint="Nessun contratto aperto." />
        ) : (
          openBoard.map((gig) => (
            <GigRow
              key={gig.id}
              gig={gig}
              catalogs={catalogs}
              userId={userId}
              viewerRole={profile?.role}
              now={now}
              busy={busy}
              blocked={blocked}
              onAccept={() => handleAccept(gig)}
            />
          ))
        )}
      </Section>

      <Section
        title="I miei gigs attivi"
        subtitle="Il pagamento scatta da solo quando i log confermano l’azione."
        className="rounded-xl border border-amber-500/40 bg-slate-900 p-6 shadow-[0_0_15px_rgba(245,158,11,0.1)]"
      >
        {myActive.length === 0 ? (
          <Empty hint="Nessun contratto attivo." />
        ) : (
          myActive.map((gig) => (
            <GigRow
              key={gig.id}
              gig={gig}
              catalogs={catalogs}
              userId={userId}
              viewerRole={profile?.role}
              now={now}
              busy={busy}
              blocked={blocked}
              onAbort={() =>
                setConfirm({
                  gig,
                  ...gigAbortConfirmCopy(profile?.reputation, gig, userId),
                })
              }
            />
          ))
        )}
      </Section>

      {myClosed.length > 0 && (
        <Section
          title="Storico"
          subtitle="Completati e falliti"
          className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 opacity-80 grayscale-[20%]"
          bodyClassName="divide-y divide-slate-800/50"
        >
          {myClosed.slice(0, 8).map((gig) => (
            <GigRow
              key={gig.id}
              gig={gig}
              catalogs={catalogs}
              userId={userId}
              viewerRole={profile?.role}
              now={now}
              busy={busy}
              compact
            />
          ))}
        </Section>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const gig = confirm.gig
            setConfirm(null)
            await handleAbort(gig)
          }}
        />
      )}
    </div>
  )
}

function CreateGigForm({
  profile,
  creds,
  blocked,
  busy,
  servers,
  players,
  onCreate,
}) {
  const { playClick } = useAudio()
  const [action, setAction] = useState(GIG_ACTIONS[0].id)
  const [targetId, setTargetId] = useState('')
  const [reward, setReward] = useState(100)
  const [timeLimit, setTimeLimit] = useState(GIG_TIME_LIMITS[2].seconds)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const cost = gigCreateCost(reward, profile?.role)
  const isExec = profile?.role === 'executive'
  const actionMeta = gigActionMeta(action)
  const targets = actionMeta?.kind === 'player' ? players : servers
  const canPost =
    !busy &&
    !blocked &&
    Boolean(action) &&
    Boolean(targetId) &&
    reward >= GIG_MIN_REWARD &&
    creds >= cost

  return (
    <section className="rounded-xl border-2 border-dashed border-purple-500/30 bg-slate-950/50 p-6">
      <div className="mb-4 text-left">
        <h2 className="mb-1 font-display text-xl font-bold text-slate-200">
          Pubblica un gig
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Contratto strutturato: l’esecutore deve lasciare un log valido sul
          bersaglio. Escrow immediato.
          {isExec ? ' Executive: −25% sul costo di pubblicazione.' : ''}
        </p>
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!canPost) return
          playClick()
          setConfirmOpen(true)
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-left text-[11px] uppercase tracking-wider text-zinc-500">
            Azione
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value)
                setTargetId('')
              }}
              className="mt-1.5 w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-fuchsia-500/60"
            >
              {GIG_ACTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-left text-[11px] uppercase tracking-wider text-zinc-500">
            Bersaglio
            <select
              required
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="mt-1.5 w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-fuchsia-500/60"
            >
              <option value="">
                {actionMeta?.kind === 'player'
                  ? 'Seleziona un agente'
                  : 'Seleziona un server'}
              </option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {actionMeta?.kind === 'player' && players.length === 0 && (
          <p className="text-left text-xs text-zinc-600">
            Nessun altro agente in rete.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-left text-[11px] uppercase tracking-wider text-zinc-500">
            Ricompensa (₵)
            <input
              type="number"
              min={GIG_MIN_REWARD}
              max={GIG_MAX_REWARD}
              step={10}
              value={reward}
              onChange={(e) => setReward(Number(e.target.value))}
              className="mt-1.5 w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-fuchsia-500/60"
            />
          </label>
          <label className="block text-left text-[11px] uppercase tracking-wider text-zinc-500">
            Tempo limite (dopo accept)
            <select
              value={timeLimit}
              onChange={(e) => setTimeLimit(Number(e.target.value))}
              className="mt-1.5 w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-fuchsia-500/60"
            >
              {GIG_TIME_LIMITS.map((opt) => (
                <option key={opt.seconds} value={opt.seconds}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-amber-200/90">
            Escrow: {cost} ₵
            {isExec && cost !== reward ? (
              <span className="ml-1 text-zinc-600">bounty {reward} ₵</span>
            ) : null}
            <span className="ml-2 text-zinc-600">saldo {creds} ₵</span>
          </p>
          <button
            type="submit"
            disabled={!canPost}
            className="inline-flex items-center justify-center gap-1.5 bg-fuchsia-600 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-950 hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {blocked ? 'Blocked' : 'Pubblica'}
          </button>
        </div>
      </form>

      {confirmOpen && (
        <ConfirmModal
          title="Pubblica contratto"
          message={`Sei sicuro di voler pubblicare questo contratto? Verranno immediatamente scalati ${cost} ₵ dal tuo conto come deposito di garanzia (Escrow).`}
          confirmLabel="Pubblica"
          busy={busy}
          onClose={() => setConfirmOpen(false)}
          onConfirm={async () => {
            setConfirmOpen(false)
            const data = await onCreate({
              targetAction: action,
              targetEntityId: targetId,
              reward: Number(reward),
              timeLimit: Number(timeLimit),
            })
            if (data) setTargetId('')
          }}
        />
      )}
    </section>
  )
}

function Section({ title, subtitle, className, bodyClassName, children }) {
  return (
    <section
      className={
        className ??
        'rounded-xl border border-slate-700 bg-slate-900 p-6'
      }
    >
      <div className="mb-4 text-left">
        <h2 className="mb-1 font-display text-xl font-bold text-slate-200">
          {title}
        </h2>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className={bodyClassName ?? 'space-y-3'}>{children}</div>
    </section>
  )
}

function gigActionIcon(actionId) {
  const key = String(actionId || '').toUpperCase()
  if (key === 'ATTACK') {
    return {
      src: '/attack.png',
      glow: 'drop-shadow-[0_0_5px_rgba(239,68,68,0.8)]',
    }
  }
  if (key === 'DEFEND') {
    return {
      src: '/defend.png',
      glow: 'drop-shadow-[0_0_5px_rgba(6,182,212,0.8)]',
    }
  }
  if (key === 'TRACE') {
    return {
      src: '/trace.png',
      glow: 'drop-shadow-[0_0_5px_rgba(245,158,11,0.8)]',
    }
  }
  if (key === 'KICK') {
    return {
      src: '/kick.png',
      glow: 'drop-shadow-[0_0_5px_rgba(220,38,38,0.8)]',
    }
  }
  return null
}

function Empty({ hint }) {
  return <p className="text-left text-xs text-zinc-600">{hint}</p>
}

function GhostHandle({ name, targetClass, viewerRole, isSelf }) {
  const label = maskGhostName(name, targetClass, viewerRole, { isSelf })
  const encrypted = label === GHOST_BOARD_HANDLE
  return (
    <span className={encrypted ? 'text-slate-500' : undefined}>{label}</span>
  )
}

function GigRow({
  gig,
  catalogs,
  userId,
  viewerRole,
  now,
  busy,
  blocked,
  onAccept,
  onAbort,
  compact = false,
}) {
  const isCreator = gig.creator_id === userId
  const isExecutor = gig.executor_id === userId
  const creatorName = maskGhostName(
    gig.creator?.name,
    gig.creator?.role,
    viewerRole,
    { isSelf: isCreator },
  )
  const creatorEncrypted = creatorName === GHOST_BOARD_HANDLE
  const executorName = gig.executor_id
    ? maskGhostName(gig.executor?.name, gig.executor?.role, viewerRole, {
        isSelf: isExecutor,
      })
    : null
  const expired = isGigExpired(gig, now)
  const remaining = gigDeadlineMs(gig, now)
  const status = expired && gig.status === 'IN_PROGRESS' ? 'FAILED' : gig.status
  const title = formatGigTitle(gig, catalogs)
  const icon = gigActionIcon(gig.target_action)

  if (compact) {
    return (
      <div className="flex flex-row items-center gap-3 border-b border-slate-800/50 px-3 py-2 text-sm last:border-0">
        {icon && (
          <img
            src={icon.src}
            alt=""
            className="h-6 w-6 shrink-0 object-contain opacity-70"
          />
        )}
        <div className="flex min-w-0 flex-grow items-center gap-2">
          <span className="truncate font-bold text-slate-300">{title}</span>
          <span className="shrink-0 text-amber-400/70">{gig.reward} ₵</span>
        </div>
        <div className="hidden shrink-0 items-center gap-3 whitespace-nowrap text-xs text-slate-500 sm:flex">
          <span>
            Client:{' '}
            <GhostHandle
              name={gig.creator?.name}
              targetClass={gig.creator?.role}
              viewerRole={viewerRole}
              isSelf={isCreator}
            />
          </span>
          <span>
            Merc:{' '}
            {executorName ? (
              <GhostHandle
                name={gig.executor?.name}
                targetClass={gig.executor?.role}
                viewerRole={viewerRole}
                isSelf={isExecutor}
              />
            ) : (
              'Nessuno'
            )}
          </span>
        </div>
        <span className="flex shrink-0 items-center">
          <span
            className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
              status === 'COMPLETED'
                ? 'border-emerald-500/30 text-emerald-500'
                : 'border-red-500/30 text-red-500'
            }`}
          >
            {gigStatusLabel(status)}
          </span>
          {status === 'FAILED' && gig.fail_reason ? (
            <span className="text-xs text-red-400/70 ml-2">({gig.fail_reason})</span>
          ) : null}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 border border-zinc-800 bg-zinc-950/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4 text-left">
        {icon && (
          <img
            src={icon.src}
            alt=""
            className={`h-16 w-16 shrink-0 object-contain ${icon.glow}`}
          />
        )}
        <div className="min-w-0">
          <p className="text-sm text-zinc-100">{title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <span className="text-amber-200/90">{gig.reward} ₵</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {gig.status === 'IN_PROGRESS' && remaining != null
                ? expired
                  ? 'Scaduto'
                  : formatRemaining(remaining)
                : formatGigDuration(gig.time_limit_seconds)}
            </span>
            <StatusPill status={status} />
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Client:{' '}
            <GhostHandle
              name={gig.creator?.name}
              targetClass={gig.creator?.role}
              viewerRole={viewerRole}
              isSelf={isCreator}
            />
            {!creatorEncrypted && gig.creator?.reputation != null && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-zinc-500">
                <Star className="h-2.5 w-2.5 text-amber-400/80" />
                {gig.creator.reputation}
              </span>
            )}
            <span className="ml-2">
              Merc:{' '}
              {executorName ? (
                <GhostHandle
                  name={gig.executor?.name}
                  targetClass={gig.executor?.role}
                  viewerRole={viewerRole}
                  isSelf={isExecutor}
                />
              ) : (
                'Nessuno'
              )}
            </span>
            {isCreator && gig.status === 'OPEN' && (
              <span className="ml-2 text-fuchsia-400/80">In attesa</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {onAccept && (
          <button
            type="button"
            disabled={busy || blocked}
            onClick={onAccept}
            className="inline-flex items-center gap-1.5 bg-fuchsia-600 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-950 hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Accept
          </button>
        )}
        {isExecutor && gig.status === 'IN_PROGRESS' && (
          <span className="inline-flex items-center px-2 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
            Auto-complete
          </span>
        )}
        {onAbort && (isCreator || isExecutor) && (
          <button
            type="button"
            disabled={busy}
            onClick={onAbort}
            className="inline-flex items-center gap-1.5 border border-red-500/30 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            {gig.status === 'OPEN' ? 'Ritira' : 'Abort'}
          </button>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  const styles = {
    OPEN: 'border-cyan-500/30 text-cyan-300',
    IN_PROGRESS: 'border-amber-500/30 text-amber-200',
    COMPLETED: 'border-emerald-500/30 text-emerald-300',
    FAILED: 'border-red-500/30 text-red-300',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${styles[status] ?? 'border-zinc-700 text-zinc-500'}`}
    >
      {status === 'FAILED' && <ShieldAlert className="h-2.5 w-2.5" />}
      {status === 'IN_PROGRESS' && <Crosshair className="h-2.5 w-2.5" />}
      {gigStatusLabel(status)}
    </span>
  )
}
