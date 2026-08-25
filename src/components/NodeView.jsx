import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Loader2,
  Lock,
  OctagonX,
  Power,
  ScanSearch,
  Skull,
  User,
  EyeOff,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDebug } from '../debug/DebugContext'
import { useNightTruce } from '../hooks/useNightTruce'
import { useAudio } from '../hooks/useAudio'
import { NIGHT_TRUCE_DENIED } from '../lib/nightTruce'
import {
  ACTION_PA_COST,
  actionProgress,
  CONFIRM_ABORT_ACTION,
  findFreeSlot,
  formatRemaining,
  isHuntableSlot,
  isSlotTimerExpired,
  occupancyFogLabel,
} from '../lib/actions'
import {
  getAbility,
  actionPaCostForSlot,
  abilityConfirmCopy,
  isBackdoorRestricted,
  isBackdoorSlot,
  visibleSlotsForRole,
} from '../lib/abilities'
import { useAbilities } from '../hooks/useAbilities'
import { occupySlot, slotCollisionMessage } from '../lib/occupySlot'
import { pingResolveExpiredActions } from '../lib/resolveExpired'
import {
  BACKDOOR_PA_SURCHARGE,
  EXTRACT_ICE_MAX,
  TIME_ACTION,
  TIME_EXTRACT,
  TIME_KICK,
  TIME_TRACE,
  canExtractServer,
  isMercFaction,
  serverOwnerLabel,
  serverOwnerPresentation,
} from '../lib/constants'
import { isSlotLocked, isStealthed } from '../lib/hardware'
import {
  actionTimerBreakdown,
  farmEffectBreakdown,
  iceEffectBreakdown,
} from '../lib/actionBreakdowns'
import { writeLog } from '../lib/logging'
import {
  actionLabel,
  msgActionStart,
  msgKickStart,
  msgTraceStart,
} from '../lib/logFormat'
import { getActiveSlotIntel, isSysAdminIntrusionVisible, resolveKnownHandle } from '../lib/slotIntel'
import { rememberNodeName } from '../lib/nodeName'
import { getActionIcon } from '../lib/actionIcons'
import PaCost from './PaCost'
import { gigsTargetingNode } from '../lib/gigs'
import GigObjectiveBanner from './GigObjectiveBanner'
import TraceResultBanner from './TraceResultBanner'
import LogTerminal from './LogTerminal'
import StatBreakdown from './StatBreakdown'
import ConfirmModal from './ConfirmModal'

const BASE_ACTIONS = [
  {
    id: 'attack',
    label: 'Attacco',
    alt: 'Attacca',
    blurb: '−10% ICE a fine timer',
    iconSrc: '/attack.png',
    labelClass: 'text-red-400',
    glowClass: 'group-hover:drop-shadow-[0_0_8px_rgba(239,68,68,0.85)]',
    cardClass: 'hover:border-red-500/50 hover:bg-red-500/5',
  },
  {
    id: 'defend',
    label: 'Difesa',
    alt: 'Difendi',
    blurb: '+10% ICE a fine timer',
    iconSrc: '/defend.png',
    labelClass: 'text-cyan-400',
    glowClass: 'group-hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.85)]',
    cardClass: 'hover:border-cyan-500/50 hover:bg-cyan-500/5',
  },
  {
    id: 'farm',
    label: 'Farming',
    alt: 'Farm',
    blurb: '+50 ₵ a fine (Exec +75%)',
    iconSrc: '/farm.png',
    labelClass: 'text-amber-400',
    glowClass: 'group-hover:drop-shadow-[0_0_8px_rgba(251,191,36,0.85)]',
    cardClass: 'hover:border-amber-500/50 hover:bg-amber-500/5',
  },
]

const EXTRACT_ACTION = {
  id: 'extract',
  label: 'Extract',
  alt: 'Extract',
  blurb: 'ICE ≤ 20%. Esito dipende dalla fazione.',
  iconSrc: '/extract.png',
  labelClass: 'text-fuchsia-400',
  glowClass: 'group-hover:drop-shadow-[0_0_8px_rgba(232,121,249,0.85)]',
  cardClass: 'hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5',
}

const COUNTER_ACTIONS = [
  {
    id: 'trace',
    label: 'Trace',
    alt: 'Trace',
    blurb: 'Rivela identità e azione in corso',
    iconSrc: '/trace.png',
    labelClass: 'text-orange-400',
    glowClass: 'group-hover:drop-shadow-[0_0_8px_rgba(251,146,60,0.85)]',
    cardClass: 'hover:border-orange-500/50 hover:bg-orange-500/5',
  },
  {
    id: 'kick',
    label: 'Kick',
    alt: 'Kick',
    blurb: 'Espelle e blocca l’account',
    iconSrc: '/kick.png',
    labelClass: 'text-red-400',
    glowClass: 'group-hover:drop-shadow-[0_0_8px_rgba(239,68,68,0.85)]',
    cardClass: 'hover:border-red-500/50 hover:bg-red-500/5',
  },
]

export default function NodeView({
  nodeId,
  nodes,
  slotsByNode,
  activeSlot,
  threats = [],
  onBack,
  onAbort,
  lastTraceResult,
  onClearTraceResult,
  logs = [],
  logsLoading = false,
  logsError = null,
  viewerId = null,
  reloadLogs = null,
  reloadMap = null,
  upsertSlot = null,
  executorGigs = [],
}) {
  const { profile, refreshProfile } = useAuth()
  const debug = useDebug()
  const abilities = useAbilities()
  const { playClick, playSuccess, playError } = useAudio()
  const { locked: actionsLocked } = useNightTruce()
  const [selectedFreeSlot, setSelectedFreeSlot] = useState(null)
  const [selectedEnemySlot, setSelectedEnemySlot] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [aborting, setAborting] = useState(false)
  const [actionError, setActionErrorState] = useState(null)
  const [actionOk, setActionOk] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [abilityConfirm, setAbilityConfirm] = useState(null)
  const observerSweepRef = useRef(new Set())

  function setActionError(message) {
    if (message) {
      playError()
      setActionOk(null)
    }
    setActionErrorState(message)
  }

  const node = useMemo(
    () => (nodes ?? []).find((n) => n.id === nodeId) ?? null,
    [nodes, nodeId],
  )

  useEffect(() => {
    if (node?.id && node?.name) rememberNodeName(node.id, node.name)
  }, [node?.id, node?.name])

  const slots = useMemo(
    () => visibleSlotsForRole(slotsByNode[nodeId] ?? [], profile?.role),
    [slotsByNode, nodeId, profile?.role],
  )

  const isBusy =
    (profile?.status === 'busy' ||
      Boolean(activeSlot?.action_type && activeSlot?.end_time)) &&
    !isSlotTimerExpired(activeSlot, now)
  const isBlocked = Boolean(profile?.is_blocked)
  const isSysadmin = profile?.role === 'sysadmin'
  const isAnalyst = profile?.role === 'analyst'
  const isGhost = profile?.role === 'ghost'
  const mySlotOnThisNode =
    activeSlot &&
    activeSlot.node_id === nodeId &&
    !isSlotTimerExpired(activeSlot, now)
      ? activeSlot
      : null

  const nodeGigs = useMemo(
    () => gigsTargetingNode(executorGigs, nodeId),
    [executorGigs, nodeId],
  )
  const playerGigsHere = useMemo(
    () =>
      executorGigs.filter((g) => {
        const action = g.target_action
        if (action !== 'TRACE' && action !== 'KICK') return false
        return slots.some((s) => s.user_id && s.user_id === g.target_entity_id)
      }),
    [executorGigs, slots],
  )
  const visibleGigs = useMemo(
    () => [...nodeGigs, ...playerGigsHere],
    [nodeGigs, playerGigsHere],
  )

  const kickTargetSlot = mySlotOnThisNode?.target_slot_id
    ? slots.find((s) => s.id === mySlotOnThisNode.target_slot_id)
    : null
  const kickTargetLabel = mySlotOnThisNode?.target_slot_id
    ? mySlotOnThisNode.action_type === 'kick'
      ? resolveKnownHandle(profile?.id, mySlotOnThisNode.target_slot_id, {
          targetUserId: kickTargetSlot?.user_id ?? null,
          occupancyStartedAt: kickTargetSlot?.start_time ?? null,
        }) || 'Unknown'
      : 'target'
    : ''

  useEffect(() => {
    if (!selectedEnemySlot) return
    const live = slots.find((s) => s.id === selectedEnemySlot.id)
    if (!live || !isHuntableSlot(live)) {
      setSelectedEnemySlot(null)
    }
  }, [slots, selectedEnemySlot])

  useEffect(() => {
    const hasGigTimer = visibleGigs.some((g) => g.deadline)
    const needAbilityTick =
      (isSysadmin && (selectedFreeSlot || selectedEnemySlot)) ||
      (isAnalyst && selectedEnemySlot) ||
      (isGhost && selectedFreeSlot)
    const hasSlotTimers = slots.some(
      (s) => (s.user_id || s.is_decoy) && s.end_time && s.action_type,
    )
    if (
      !mySlotOnThisNode?.end_time &&
      !activeSlot?.end_time &&
      !hasGigTimer &&
      !needAbilityTick &&
      !hasSlotTimers
    ) {
      return
    }
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [
    mySlotOnThisNode?.end_time,
    mySlotOnThisNode?.id,
    activeSlot?.end_time,
    visibleGigs,
    isSysadmin,
    isAnalyst,
    isGhost,
    selectedFreeSlot,
    selectedEnemySlot,
    slots,
  ])

  useEffect(() => {
    for (const slot of slots) {
      if (!slot.user_id || !slot.end_time || !slot.action_type) continue
      if (!isSlotTimerExpired(slot, now)) {
        observerSweepRef.current.delete(slot.id)
        continue
      }
      if (observerSweepRef.current.has(slot.id)) continue
      observerSweepRef.current.add(slot.id)
      pingResolveExpiredActions()
    }
  }, [slots, now])

  if (!node) {
    if (!nodes?.length) {
      return (
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 py-10 text-sm text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
          Collegamento al server…
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-3xl py-10 text-center">
        <p className="text-sm text-zinc-400">Nodo non trovato.</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 text-sm text-cyan-400 hover:text-cyan-300"
        >
          Torna alla mappa
        </button>
      </div>
    )
  }

  const ice = node.ice ?? 0
  const ownerLabel = serverOwnerLabel(node.owner_faction)
  const owner = serverOwnerPresentation(node.owner_faction)
  const extractUnlocked = canExtractServer(
    ice,
    node.owner_faction,
    profile?.faction,
  )
  const slotActionIcon = mySlotOnThisNode
    ? getActionIcon(mySlotOnThisNode.action_type)
    : null
  const ownFactionServer = Boolean(
    node.owner_faction && node.owner_faction === profile?.faction,
  )
  const extractAction = {
    ...EXTRACT_ACTION,
    blurb: isMercFaction(profile?.faction)
      ? 'Server Neutral + 1 Core Data in inventario'
      : 'Il server passa alla tua fazione · ICE → 100%',
  }
  const liveBaseActions = BASE_ACTIONS.map((action) => {
    if (action.id === 'attack') {
      return { ...action, effect: iceEffectBreakdown('attack', profile) }
    }
    if (action.id === 'defend') {
      return { ...action, effect: iceEffectBreakdown('defend', profile) }
    }
    if (action.id === 'farm') {
      return { ...action, effect: farmEffectBreakdown(profile) }
    }
    return action
  })
  const freeSlotActions = extractUnlocked
    ? [...liveBaseActions, extractAction]
    : liveBaseActions

  const killProcessAbility = getAbility('kill_process')
  const hardRebootAbility = getAbility('hard_reboot')
  const deepScanAbility = getAbility('deep_scan')
  const decoyAbility = getAbility('decoy')
  const occupyPaCost = debug.paCost(actionPaCostForSlot(selectedFreeSlot, ACTION_PA_COST))
  const killProcessExtra =
    isSysadmin && killProcessAbility
      ? [
          {
            id: 'kill_process',
            label: 'Kill Process',
            blurb: 'Kick istantaneo su questo slot.',
            paCost: killProcessAbility.paCost,
            cooldownLabel: 'Giornaliero',
            remainingMs: abilities.remainingMs('kill_process', now),
            ready: abilities.canUse('kill_process', now),
            Icon: Skull,
            labelClass: 'text-rose-300',
            cardClass:
              'border-rose-700/70 bg-rose-950/40 hover:border-rose-400 hover:bg-rose-900/40',
            iconClass: 'text-rose-300',
            iconSrc: killProcessAbility.iconSrc,
            glowClass: killProcessAbility.glowClass,
          },
        ]
      : []
  const deepScanExtra =
    isAnalyst && deepScanAbility
      ? [
          {
            id: 'deep_scan',
            label: 'Deep Scan',
            blurb: 'Trace istantaneo: ID e azione in corso.',
            paCost: deepScanAbility.paCost,
            cooldownLabel: 'Giornaliero',
            remainingMs: abilities.remainingMs('deep_scan', now),
            ready: abilities.canUse('deep_scan', now),
            Icon: ScanSearch,
            labelClass: 'text-cyan-300',
            cardClass:
              'border-cyan-700/70 bg-cyan-950/40 hover:border-cyan-400 hover:bg-cyan-900/40',
            iconClass: 'text-cyan-300',
            iconSrc: deepScanAbility.iconSrc,
            glowClass: deepScanAbility.glowClass,
          },
        ]
      : []
  const enemySlotExtras = actionsLocked
    ? []
    : [...killProcessExtra, ...deepScanExtra]
  const hardRebootExtra =
    isSysadmin && hardRebootAbility
      ? [
          {
            id: 'hard_reboot',
            label: 'Hard Reboot',
            blurb: 'Resetta l’ICE del server al 50%.',
            paCost: hardRebootAbility.paCost,
            cooldownLabel: '3 giorni',
            remainingMs: abilities.remainingMs('hard_reboot', now),
            ready: abilities.canUse('hard_reboot', now),
            Icon: Power,
            labelClass: 'text-violet-300',
            cardClass:
              'border-violet-600/70 bg-violet-950/40 hover:border-violet-400 hover:bg-violet-900/40',
            iconClass: 'text-violet-300',
            iconSrc: hardRebootAbility.iconSrc,
            glowClass: hardRebootAbility.glowClass,
          },
        ]
      : []
  const decoyExtra =
    isGhost && decoyAbility
      ? [
          {
            id: 'decoy',
            label: 'Decoy',
            blurb: 'Installa un falso segnale. Finge un’operazione per 1 ora.',
            paCost: debug.paCost(
              decoyAbility.paCost +
                (isBackdoorSlot(selectedFreeSlot) ? BACKDOOR_PA_SURCHARGE : 0),
            ),
            cooldownLabel: 'Giornaliero',
            remainingMs: abilities.remainingMs('decoy', now),
            ready:
              abilities.canUse('decoy', now) &&
              (profile?.pa ?? 0) >=
                decoyAbility.paCost +
                  (isBackdoorSlot(selectedFreeSlot) ? BACKDOOR_PA_SURCHARGE : 0),
            Icon: EyeOff,
            labelClass: 'text-zinc-100',
            cardClass:
              'border-zinc-400/50 bg-zinc-800/40 hover:border-zinc-200 hover:bg-zinc-700/40',
            iconClass: 'text-zinc-200',
            iconSrc: decoyAbility.iconSrc,
            glowClass: decoyAbility.glowClass,
          },
        ]
      : []
  const freeSlotExtras = [...hardRebootExtra, ...decoyExtra]

  async function handleSlotCollision(slotLabel) {
    const message = slotCollisionMessage(slotLabel, node.name)
    setSelectedFreeSlot(null)
    setSelectedEnemySlot(null)
    setActionError(message)
    if (profile) {
      await writeLog({
        eventType: 'connection_failed',
        message,
        outcome: 'failure',
        nodeId: node.id,
        actorId: profile.id,
        meta: {
          slot: slotLabel,
          node_name: node.name,
          tone: 'warning',
          reason: 'slot_collision',
        },
      })
      await reloadLogs?.()
    }
  }

  async function syncAfterActionStart(claimed = null) {
    if (claimed?.id) upsertSlot?.(claimed)
    await Promise.all([
      refreshProfile(),
      typeof reloadMap === 'function' ? reloadMap() : Promise.resolve(),
    ])
  }

  async function startBaseAction(actionId) {
    if (!selectedFreeSlot || !profile || submitting) return
    if (isBusy) {
      setActionError('Sei già BUSY: attendi o interrompi l’operazione.')
      return
    }
    if (isBlocked) {
      setActionError('Account bloccato: vai all’Helpdesk.')
      return
    }
    if (actionsLocked) {
      setActionError(NIGHT_TRUCE_DENIED)
      return
    }
    const paCost = occupyPaCost
    if (profile.pa < paCost) {
      setActionError(`PA insufficienti (serve ${paCost}).`)
      return
    }
    if (actionId === 'extract' && !canExtractServer(ice, node.owner_faction, profile.faction)) {
      setActionError(
        ice > EXTRACT_ICE_MAX
          ? `Extract disponibile solo con ICE ≤ ${EXTRACT_ICE_MAX}%.`
          : 'Non puoi estrarre un server già sotto il controllo della tua fazione.',
      )
      return
    }

    const slotLabel = selectedFreeSlot.slot_id
    setSubmitting(true)
    setActionError(null)
    try {
      const result = await occupySlot({
        profile,
        node,
        occupySlotId: selectedFreeSlot.id,
        actionId,
        paCost,
        instant: debug.instantActions,
      })
      if (result.collided) {
        await handleSlotCollision(slotLabel)
        return
      }

      playSuccess()
      rememberNodeName(node.id, node.name)
      await syncAfterActionStart(result.claimed)
      if (!isStealthed(profile)) {
        await writeLog({
          eventType: `${actionId}_start`,
          message: msgActionStart({
            actionType: actionId,
            nodeName: node.name,
            slotId: slotLabel,
          }),
          outcome: 'info',
          nodeId: node.id,
          actorId: profile.id,
          meta: {
            slot: slotLabel,
            node_name: node.name,
            action_type: actionId,
            tone: 'neutral',
          },
        })
      }
      setSelectedFreeSlot(null)
    } catch (err) {
      setSelectedFreeSlot(null)
      setActionError(err.message ?? 'Avvio azione fallito')
    } finally {
      setSubmitting(false)
    }
  }

  async function startCountermeasure(actionId) {
    if (!selectedEnemySlot || !profile || submitting) return
    if (isBusy) {
      setActionError('Sei già BUSY.')
      return
    }
    if (isBlocked) {
      setActionError('Account bloccato: vai all’Helpdesk.')
      return
    }
    const free = findFreeSlot(slots, profile)
    if (!free) {
      setActionError(
        'Nessuno slot libero su questo server per eseguire la contromisura.',
      )
      return
    }
    const paCost = debug.paCost(actionPaCostForSlot(free, ACTION_PA_COST))
    if (profile.pa < paCost) {
      setActionError(`PA insufficienti (serve ${paCost}).`)
      return
    }

    if (!selectedEnemySlot.user_id && !selectedEnemySlot.is_decoy) {
      setActionError('Il bersaglio non è più sullo slot.')
      return
    }

    if (!isHuntableSlot(selectedEnemySlot)) {
      setActionError(
        'Segnale instabile: il bersaglio non è ancorato a un’azione core.',
      )
      setSelectedEnemySlot(null)
      return
    }

    setSubmitting(true)
    setActionError(null)
    try {
      const isKick = actionId === 'kick'
      const priorIntel = getActiveSlotIntel(profile.id, selectedEnemySlot.id, {
        targetUserId: selectedEnemySlot.user_id,
        occupancyStartedAt: selectedEnemySlot.start_time,
      })
      const knownHandle = isKick ? priorIntel?.handle ?? null : null

      const result = await occupySlot({
        profile,
        node,
        occupySlotId: free.id,
        actionId,
        targetSlotId: selectedEnemySlot.id,
        paCost,
        instant: debug.instantActions,
      })
      if (result.collided) {
        await handleSlotCollision(free.slot_id)
        return
      }

      playSuccess()
      rememberNodeName(node.id, node.name)
      await syncAfterActionStart(result.claimed)

      await writeLog({
        eventType: isKick ? 'kick_start' : 'trace_start',
        message: isKick
          ? msgKickStart({
              nodeName: node.name,
              actorSlot: free.slot_id,
              targetSlot: selectedEnemySlot.slot_id,
              handle: knownHandle,
            })
          : msgTraceStart({
              nodeName: node.name,
              actorSlot: free.slot_id,
              targetSlot: selectedEnemySlot.slot_id,
            }),
        outcome: 'info',
        nodeId: node.id,
        actorId: profile.id,
        meta: {
          target_slot: selectedEnemySlot.slot_id,
          target_slot_id: selectedEnemySlot.id,
          slot: free.slot_id,
          actor_slot: free.slot_id,
          node_name: node.name,
          action_type: actionId,
          target_action: knownHandle ? priorIntel?.targetAction ?? null : null,
          known_handle: knownHandle,
          has_intel: Boolean(knownHandle),
          tone: 'neutral',
          reason: 'countermeasure_started',
        },
      })

      setSelectedEnemySlot(null)
    } catch (err) {
      setSelectedEnemySlot(null)
      setActionError(err.message ?? 'Avvio contromisura fallito')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAbort() {
    if (!onAbort || aborting) return
    if (!window.confirm(CONFIRM_ABORT_ACTION)) return
    setAborting(true)
    setActionError(null)
    const { error } = await onAbort()
    if (error) setActionError(error.message ?? 'Abort fallito')
    setAborting(false)
  }

  async function runNodeAbility(abilityId, targets) {
    setActionOk(null)
    const { data, error } = await abilities.activate(abilityId, targets)
    setAbilityConfirm(null)
    if (error) {
      setActionErrorState(error.message ?? 'Abilità fallita')
      return
    }
    const payload = data?.result ?? data ?? {}
    if (abilityId === 'kill_process') {
      const outcome = payload.result ?? payload.kick ?? 'ok'
      const slot = payload.target_slot ?? selectedEnemySlot?.slot_id ?? '?'
      const labels = {
        kicked: `Kill Process: kick istantaneo su Slot ${slot}`,
        decoy: `Kill Process: decoy rimosso su Slot ${slot}`,
        bailed: 'Kill Process: vanificato da Bailout Token',
        immune: 'Kill Process: vanificato da Immunity',
      }
      setActionOk(labels[outcome] ?? `Kill Process: ${outcome}`)
      setSelectedEnemySlot(null)
    } else if (abilityId === 'deep_scan') {
      const action = String(payload?.target_action ?? 'UNKNOWN').toUpperCase()
      const nodeName = payload?.node_name ?? node.name
      const slot = payload?.target_slot ?? selectedEnemySlot?.slot_id ?? '?'
      setActionOk(
        `Deep Scan: ${payload?.revealed ?? 'Unknown'} — Azione in corso: ${action} — Server: ${nodeName} [Slot ${slot}]`,
      )
      setSelectedEnemySlot(null)
    } else if (abilityId === 'hard_reboot') {
      const from = payload.ice_before ?? '?'
      setActionOk(`Hard Reboot: ICE ${from}% → 50%`)
      setSelectedFreeSlot(null)
    } else if (abilityId === 'decoy') {
      const slot = payload?.slot ?? selectedFreeSlot?.slot_id ?? '?'
      setActionOk(`Decoy: falso segnale installato su Slot ${slot} (1h)`)
      setSelectedFreeSlot(null)
    }
    await reloadLogs?.()
    if (typeof reloadMap === 'function') await reloadMap()
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <button
        type="button"
        onClick={() => void onBack()}
        className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Network Map
      </button>

      {lastTraceResult && (
        <TraceResultBanner
          className="mb-4"
          result={lastTraceResult}
          onClose={onClearTraceResult}
        />
      )}

      <div className={`mb-8 border bg-zinc-900/70 p-5 sm:p-6 ${owner.cardClass}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-left">
            <p className="font-display text-xs uppercase tracking-[0.35em] text-cyan-400/80">
              Node View
            </p>
            <div className="mt-2 flex items-center gap-4">
              <img
                src={owner.logo || '/mercenary-logo.png'}
                alt=""
                className="h-16 w-16 shrink-0 rounded-sm object-contain"
                onError={(event) => {
                  if (event.currentTarget.dataset.fallback === '1') return
                  event.currentTarget.dataset.fallback = '1'
                  event.currentTarget.src = '/mercenary-logo.png'
                }}
              />
              <h1 className="font-display text-2xl font-semibold tracking-wide text-zinc-100 sm:text-3xl">
                {node.name}
              </h1>
            </div>
            <p
              className={`mt-1.5 text-[10px] font-medium uppercase tracking-[0.16em] ${owner.badgeClass}`}
            >
              {owner.badge}
            </p>
            {visibleGigs.length > 0 && (
              <div className="mt-3">
                <GigObjectiveBanner
                  gigs={visibleGigs}
                  catalogs={{ servers: nodes }}
                  now={now}
                />
              </div>
            )}
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">
              ICE · {ownerLabel}
            </p>
            <p className="font-display text-3xl text-zinc-100">{ice}%</p>
            {extractUnlocked && (
              <p className="mt-1 text-[10px] uppercase tracking-wider text-fuchsia-400">
                Extract disponibile
              </p>
            )}
            {ice <= EXTRACT_ICE_MAX && ownFactionServer && (
              <p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">
                Già sotto il tuo controllo
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden bg-zinc-800">
          <div
            className={`h-full transition-all duration-500 ${
              ice > 50
                ? 'bg-emerald-400'
                : ice > 20
                  ? 'bg-amber-400'
                  : 'bg-red-400'
            }`}
            style={{ width: `${Math.max(0, Math.min(100, ice))}%` }}
          />
        </div>
      </div>

      {mySlotOnThisNode && (
        <div
          className={`mb-6 border p-4 ${
            threats.length
              ? 'threat-pulse border-red-500/60 bg-red-500/10'
              : 'border-amber-500/40 bg-amber-500/10'
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-row items-center gap-4 text-left">
              {slotActionIcon && (
                <img
                  src={slotActionIcon.src}
                  alt={slotActionIcon.alt}
                  className={`h-12 w-12 shrink-0 object-contain ${slotActionIcon.glowClass}`}
                />
              )}
              <div className="min-w-0 flex-col">
                <p
                  className={`text-lg font-bold uppercase tracking-wide ${
                    threats.length
                      ? 'text-red-200'
                      : slotActionIcon?.labelClass ?? 'text-amber-200'
                  }`}
                >
                  {slotActionIcon?.label ?? mySlotOnThisNode.action_type} in
                  corso
                  {kickTargetLabel ? ` → ${kickTargetLabel}` : ''}
                </p>
                <p
                  className={`mt-0.5 text-sm ${
                    threats.length ? 'text-red-200/80' : 'text-zinc-300'
                  }`}
                >
                  Slot {mySlotOnThisNode.slot_id} · Completamento tra{' '}
                  {formatRemaining(
                    actionProgress(mySlotOnThisNode, now).remainingMs,
                  )}
                </p>
              </div>
            </div>
            {threats.length === 0 && (
              <button
                type="button"
                onClick={handleAbort}
                disabled={aborting}
                className="inline-flex shrink-0 items-center justify-center gap-2 border border-red-500/50 bg-red-500/10 px-4 py-2 text-xs font-medium uppercase tracking-wider text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
              >
                {aborting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <OctagonX className="h-4 w-4" />
                )}
                Abort Operation
              </button>
            )}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden bg-zinc-900/60">
            <div
              className={`h-full transition-[width] duration-200 ease-linear ${
                threats.length
                  ? 'bg-red-400'
                  : slotActionIcon?.barClass ?? 'bg-amber-400'
              }`}
              style={{
                width: `${Math.round(actionProgress(mySlotOnThisNode, now).progress * 100)}%`,
              }}
            />
          </div>
          {threats.length > 0 && (
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-red-200">
              {threats[0]?.type === 'kick'
                ? 'ATTENZIONE: Kick in corso...'
                : 'ATTENZIONE: Trace in corso...'}
            </p>
          )}
        </div>
      )}

      {actionsLocked && (
        <p className="mb-3 border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] uppercase tracking-wider text-red-300">
          Night Truce · Attack, Defend, Farm ed Extract bloccati. Trace e Kick
          restano disponibili sugli slot con un’operazione già in corso.
        </p>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm uppercase tracking-[0.2em] text-zinc-400">
          Slot di accesso
        </h2>
        <p className="text-xs text-zinc-600">
          Azione {formatRemaining(TIME_ACTION)} · Extract{' '}
          {formatRemaining(TIME_EXTRACT)} · Trace {formatRemaining(TIME_TRACE)} ·
          Kick {formatRemaining(TIME_KICK)}
        </p>
      </div>

      <div className={`grid gap-3 ${slots.length > 3 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {slots.map((slot) => {
          const locked = isSlotLocked(slot, now)
          const backdoor = isBackdoorSlot(slot)
          const backdoorLocked = isBackdoorRestricted(slot, profile)
          const isMine = slot.user_id === profile?.id
          const occupied = Boolean(
            (slot.user_id || slot.is_decoy) &&
              !(isMine && isSlotTimerExpired(slot, now)),
          )
          const isEnemy = occupied && !isMine
          const isSelectedFree = selectedFreeSlot?.id === slot.id
          const isSelectedEnemy = selectedEnemySlot?.id === slot.id
          const slotProg =
            isMine && occupied && slot.end_time
              ? actionProgress(slot, now)
              : null
          const slotIntel = !isMine
            ? getActiveSlotIntel(profile?.id, slot.id, {
                targetUserId: slot.user_id ?? null,
                occupancyStartedAt: slot.start_time ?? null,
              })
            : null
          const slotRevealed = Boolean(slotIntel)
          const slotIntelHandle = slotIntel?.handle ?? null
          const slotIntelAction =
            slotIntel?.targetAction || (slotRevealed ? slot.action_type : null)

          const huntable = isHuntableSlot(slot)
          const occupancyHint =
            isEnemy && huntable
              ? occupancyFogLabel(slot, now, { isAnalyst })
              : null
          const unstable = isEnemy && !huntable
          const attackDetected =
            isEnemy && isSysAdminIntrusionVisible(profile, node, slot)
          const canClickFree =
            !occupied &&
            !locked &&
            !backdoorLocked &&
            !isBusy &&
            !isBlocked &&
            !actionsLocked
          const canClickEnemy =
            isEnemy && huntable && !isBusy && !isBlocked

          return (
            <button
              key={slot.id}
              type="button"
              disabled={!(canClickFree || canClickEnemy)}
              onClick={() => {
                playClick()
                setActionError(null)
                if (isEnemy) {
                  setSelectedFreeSlot(null)
                  setSelectedEnemySlot(slot)
                } else {
                  setSelectedEnemySlot(null)
                  setSelectedFreeSlot(slot)
                }
              }}
              className={`group border p-4 text-left transition ${
                backdoor ? 'border-dashed' : ''
              } ${
                isSelectedEnemy
                  ? 'border-red-500/60 bg-red-500/10'
                  : isSelectedFree
                    ? 'border-cyan-500/70 bg-cyan-500/10'
                    : unstable
                      ? 'cursor-not-allowed border-amber-500/40 bg-amber-500/5'
                      : occupied
                        ? isMine
                          ? 'border-zinc-700 bg-zinc-900/70 ring-1 ring-amber-500/40'
                          : attackDetected
                            ? 'border-red-500/70 bg-red-950/40 hover:border-red-400/80'
                            : 'border-zinc-700 bg-zinc-900/70 hover:border-red-500/40'
                        : canClickFree
                          ? backdoor
                            ? 'border-violet-500/70 bg-violet-950/30 hover:border-violet-400/80'
                            : 'border-zinc-700 bg-zinc-900/70 hover:border-zinc-500'
                          : 'cursor-not-allowed border-zinc-800 bg-zinc-950/50 opacity-70'
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display flex items-center gap-2 text-2xl text-zinc-100">
                  {slot.slot_id}
                  {backdoor ? (
                    <img
                      src="/a_backdoor.png"
                      alt="Backdoor"
                      className="h-8 w-8 object-contain drop-shadow-[0_0_5px_rgba(168,85,247,0.6)] group-hover:drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]"
                    />
                  ) : null}
                </span>
                {occupied ? (
                  isMine ? (
                    <span className="text-[10px] uppercase tracking-wider text-amber-400">
                      Tu
                    </span>
                  ) : unstable ? (
                    <Lock className="h-4 w-4 text-amber-400/90" />
                  ) : (
                    <Lock className="h-4 w-4 text-red-400/80" />
                  )
                ) : locked || backdoorLocked ? (
                  <span className="text-[10px] uppercase tracking-wider text-red-400/80">
                    {backdoorLocked ? 'Backdoor' : 'Locked'}
                  </span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400/90">
                    Libero
                  </span>
                )}
              </div>

              {occupied ? (
                <div className="space-y-1 text-xs text-zinc-400">
                  <p
                    className={`flex items-center gap-1.5 ${
                      attackDetected && !slotRevealed && !isMine
                        ? 'font-medium text-red-400'
                        : ''
                    }`}
                  >
                    <User className="h-3.5 w-3.5" />
                    {isMine
                      ? profile.name
                      : unstable
                        ? 'SEGNALE INSTABILE'
                        : slotRevealed
                          ? slotIntelHandle
                          : attackDetected
                            ? 'ATTACCO RILEVATO'
                            : 'OCCUPIED'}
                  </p>
                  {isMine && slot.action_type && (
                    <p className="uppercase tracking-wider text-zinc-500">
                      {actionLabel(slot.action_type)}
                    </p>
                  )}
                  {unstable && (
                    <p className="uppercase tracking-wider text-amber-400/90">
                      Connessione in transito
                    </p>
                  )}
                  {!isMine && !unstable && attackDetected && !slotRevealed && (
                    <p className="uppercase tracking-wider text-red-400">
                      Intrusione ostile
                    </p>
                  )}
                  {!isMine && !unstable && slotRevealed && slotIntelAction && (
                    <p className="uppercase tracking-wider text-cyan-500/80">
                      {actionLabel(slotIntelAction)}
                    </p>
                  )}
                  {!isMine && !unstable && !slotRevealed && !attackDetected && (
                    <p className="uppercase tracking-wider text-zinc-600">
                      BUSY
                    </p>
                  )}
                  {slotProg && (
                    <p className="text-amber-400/90">
                      {formatRemaining(slotProg.remainingMs)}
                    </p>
                  )}
                  {occupancyHint && (
                    <p className="text-xs italic text-slate-400">
                      {occupancyHint}
                    </p>
                  )}
                  {isEnemy && huntable && !isBusy && !isBlocked && (
                    <p className="pt-1 text-[10px] uppercase tracking-wider text-red-300/80">
                      {isSysadmin
                        ? 'Trace / Kick / Kill'
                        : isAnalyst
                          ? 'Trace / Kick / Scan'
                          : 'Trace / Kick'}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  {backdoor ? (
                    <img
                      src="/a_backdoor.png"
                      alt="Backdoor"
                      className="h-16 w-16 shrink-0 object-contain drop-shadow-[0_0_5px_rgba(168,85,247,0.6)] group-hover:drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]"
                    />
                  ) : null}
                  <p className="text-xs text-zinc-500">
                    {locked
                      ? 'Lockout attivo'
                      : isBlocked
                        ? 'Bloccato'
                        : isBusy
                          ? 'Busy'
                          : actionsLocked
                            ? 'Night Truce'
                            : backdoor
                              ? 'Backdoor · azione base · +1 PA'
                              : 'Azione base'}
                  </p>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {selectedFreeSlot && !isBusy && !isBlocked && !actionsLocked && (
        <ActionPanel
          title={`Slot ${selectedFreeSlot.slot_id} · azione base`}
          subtitle={`Costo ${occupyPaCost} PA${debug.bypassCosts ? ' (debug)' : ''}${
            isBackdoorSlot(selectedFreeSlot) ? ' · Slot D +1 PA' : ''
          }${
            extractUnlocked
              ? ''
              : ownFactionServer && ice <= EXTRACT_ICE_MAX
                ? ' · Server già sotto il tuo controllo'
                : ` · Extract a ICE ≤ ${EXTRACT_ICE_MAX}%`
          }`}
          actions={freeSlotActions}
          role={profile?.role}
          instant={debug.instantActions}
          submitting={submitting}
          gigActions={nodeGigs.map((g) => g.target_action.toLowerCase())}
          paCost={occupyPaCost}
          extraActions={freeSlotExtras}
          extraBusy={abilities.busy || Boolean(abilityConfirm)}
          onCancel={() => setSelectedFreeSlot(null)}
          onPick={startBaseAction}
          onPickExtra={(abilityId) => {
            if (abilityId === 'hard_reboot') {
              const ability = getAbility('hard_reboot')
              if (!ability) return
              setAbilityConfirm({
                ability,
                targets: { nodeId: node.id },
              })
            } else if (abilityId === 'decoy') {
              const ability = getAbility('decoy')
              if (!ability) return
              setAbilityConfirm({
                ability,
                targets: {
                  targetSlotId: selectedFreeSlot.id,
                  nodeId: node.id,
                },
              })
            }
          }}
        />
      )}

      {selectedEnemySlot && !isBusy && !isBlocked && (
        <ActionPanel
          title={`Contromisure · Slot ${selectedEnemySlot.slot_id}`}
          subtitle={`${
            actionsLocked ? 'Night Truce · contromisura reattiva · ' : ''
          }Bersaglio: ${
            resolveKnownHandle(profile.id, selectedEnemySlot.id, {
              targetUserId: selectedEnemySlot.user_id,
              occupancyStartedAt: selectedEnemySlot.start_time,
            }) || 'Unknown'
          } · costo ${debug.paCost(ACTION_PA_COST)} PA${debug.bypassCosts ? ' (debug)' : ''}`}
          occupancyHint={occupancyFogLabel(selectedEnemySlot, now, {
            isAnalyst,
          })}
          actions={COUNTER_ACTIONS}
          role={profile?.role}
          instant={debug.instantActions}
          submitting={submitting}
          gigActions={playerGigsHere
            .filter((g) => g.target_entity_id === selectedEnemySlot.user_id)
            .map((g) => g.target_action.toLowerCase())}
          paCost={debug.paCost(ACTION_PA_COST)}
          extraActions={enemySlotExtras}
          extraBusy={abilities.busy || Boolean(abilityConfirm)}
          onCancel={() => setSelectedEnemySlot(null)}
          onPick={startCountermeasure}
          onPickExtra={(abilityId) => {
            const ability = getAbility(abilityId)
            if (!ability) return
            setAbilityConfirm({
              ability,
              targets: {
                targetSlotId: selectedEnemySlot.id,
                nodeId: node.id,
              },
            })
          }}
        />
      )}

      {actionOk && (
        <p className="mt-4 border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {actionOk}
        </p>
      )}
      {actionError && (
        <p className="mt-4 border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {actionError}
        </p>
      )}

      {abilityConfirm?.ability && (
        <ConfirmModal
          title={abilityConfirmCopy(abilityConfirm.ability).title}
          message={abilityConfirmCopy(abilityConfirm.ability).message}
          confirmLabel={abilityConfirmCopy(abilityConfirm.ability).confirmLabel}
          busy={abilities.busy}
          onClose={() => setAbilityConfirm(null)}
          onConfirm={async () => {
            await runNodeAbility(
              abilityConfirm.ability.id,
              abilityConfirm.targets,
            )
          }}
        />
      )}

      <LogTerminal
        logs={logs}
        loading={logsLoading}
        error={logsError}
        viewerId={viewerId}
      />
    </div>
  )
}

function ActionPanel({
  title,
  subtitle,
  occupancyHint = null,
  actions,
  role,
  instant = false,
  submitting,
  gigActions = [],
  paCost = 1,
  extraActions = [],
  extraBusy = false,
  onCancel,
  onPick,
  onPickExtra,
}) {
  return (
    <div className="mt-6 border border-zinc-700/80 bg-zinc-900/80 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="text-left">
          <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
          <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Annulla
        </button>
      </div>

      {occupancyHint ? (
        <p className="mb-3 text-xs italic text-slate-400">{occupancyHint}</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {actions.map((action) => {
          const isGigAction = gigActions.includes(action.id)
          const timer = actionTimerBreakdown(action.id, role, { instant })
          return (
            <button
              key={action.id}
              type="button"
              disabled={submitting || extraBusy}
              title={action.alt ?? action.label}
              onClick={() => onPick(action.id)}
              className={`group relative flex w-full flex-row items-center rounded-lg border bg-zinc-950/50 p-3 pr-20 text-left transition-all disabled:opacity-50 ${
                isGigAction
                  ? 'border-fuchsia-500/70 bg-fuchsia-500/10'
                  : `border-zinc-700 ${action.cardClass}`
              }`}
            >
              <PaCost cost={paCost} variant="badge" />
              <div className="mr-4 shrink-0">
                <img
                  src={action.iconSrc}
                  alt={action.alt ?? action.label}
                  className={`h-16 w-16 object-contain drop-shadow-md transition-all sm:h-20 sm:w-20 ${action.glowClass}`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col text-left">
                <span
                  className={`font-display text-lg font-bold uppercase tracking-wider ${action.labelClass}`}
                >
                  {action.label}
                  {isGigAction ? (
                    <span className="ml-2 text-[10px] font-medium text-fuchsia-300">
                      GIG
                    </span>
                  ) : null}
                </span>
                {action.effect ? (
                  <StatBreakdown className="mt-0.5 block" {...action.effect} />
                ) : (
                  <span className="mt-0.5 text-sm text-zinc-300">
                    {action.blurb}
                  </span>
                )}
                <StatBreakdown className="mt-1 block" {...timer} />
              </div>
            </button>
          )
        })}
        {extraActions.map((action) => {
          const Icon = action.Icon
          const onCd = action.remainingMs > 0
          return (
            <button
              key={action.id}
              type="button"
              disabled={
                submitting || extraBusy || !action.ready
              }
              title={action.label}
              onClick={() => onPickExtra?.(action.id)}
              className={`group relative flex w-full flex-row items-center rounded-lg border p-3 pr-20 text-left transition-all disabled:opacity-50 ${action.cardClass}`}
            >
              <PaCost cost={action.paCost} variant="badge" />
              <div className="mr-4 shrink-0">
                {action.iconSrc ? (
                  <img
                    src={action.iconSrc}
                    alt={action.label}
                    className={`h-16 w-16 object-contain drop-shadow-md transition-all sm:h-20 sm:w-20 ${action.glowClass ?? ''}`}
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20">
                    <Icon
                      className={`h-12 w-12 ${action.iconClass}`}
                      strokeWidth={1.5}
                    />
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col text-left">
                <span
                  className={`font-display text-lg font-bold uppercase tracking-wider ${action.labelClass}`}
                >
                  {action.label}
                  <span className="ml-2 text-[10px] font-medium text-violet-200/80">
                    Abilità
                  </span>
                </span>
                <span className="mt-0.5 text-sm text-zinc-300">{action.blurb}</span>
                <span className="mt-1 font-mono text-xs text-zinc-500">
                  {onCd
                    ? `Cooldown: ${formatRemaining(action.remainingMs)}`
                    : action.cooldownLabel}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {submitting && (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Occupazione slot…
        </p>
      )}
    </div>
  )
}

