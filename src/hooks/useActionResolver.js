import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { EMPTY_SLOT, getFarmGain } from '../lib/actions'
import { writeLog } from '../lib/logging'
import {
  msgAbort,
  msgActionDone,
  msgEscape,
  msgExtractCapture,
  msgTraceDone,
} from '../lib/logFormat'
import { isRealNodeName, lookupNodeName } from '../lib/nodeName'
import { rememberSlotIntel, resolveKnownHandle } from '../lib/slotIntel'
import {
  CORE_ACTION_TYPES,
  HOSTILE_ACTION_TYPES,
  useAudio,
} from './useAudio'

function alreadyResolved(error) {
  return /già completat|non valida|non valido|Nessuna operazione attiva/i.test(
    error?.message ?? '',
  )
}

async function hydrateTraceFromLogs(profileId, fallbackNodeName) {
  const { data } = await supabase
    .from('logs')
    .select('outcome, meta, created_at, target_id')
    .eq('actor_id', profileId)
    .eq('event_type', 'trace')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const at = new Date(data.created_at).getTime()
  if (!Number.isFinite(at) || Date.now() - at > 120_000) return null
  const meta = data.meta ?? {}
  return {
    revealed: meta.revealed ?? 'Unknown',
    targetAction: meta.target_action ?? null,
    at: Date.now(),
    nodeName: pickNodeName(meta.node_name, fallbackNodeName),
    outcome: data.outcome ?? 'success',
    targetSlot: meta.target_slot ?? null,
    targetSlotId: meta.target_slot_id ?? null,
    targetId: data.target_id ?? null,
  }
}

function rememberTraceIntel(profileId, result, { nodeId, occupancyStartedAt }) {
  if (result?.outcome !== 'success' || !result.targetSlotId) return
  rememberSlotIntel(profileId, {
    targetSlotId: result.targetSlotId,
    handle: result.revealed,
    targetUserId: result.targetId ?? null,
    nodeId,
    nodeName: result.nodeName,
    targetAction: result.targetAction,
    targetSlotLabel: result.targetSlot,
    occupancyStartedAt,
  })
}

function pickNodeName(...candidates) {
  for (const c of candidates) {
    if (isRealNodeName(c)) return String(c).trim()
  }
  return null
}

function completionDetail(actionType, data, profile) {
  if (data?.detail) return data.detail
  if (actionType === 'farm')
    return `+${getFarmGain(profile?.role, profile?.equipped_hardware)} ₵`
  if (
    actionType === 'attack' &&
    data?.ice_before != null &&
    data?.ice_after != null
  ) {
    return `ICE ${data.ice_before}% → ${data.ice_after}%`
  }
  if (
    actionType === 'defend' &&
    data?.ice_before != null &&
    data?.ice_after != null
  ) {
    return `ICE ${data.ice_before}% → ${data.ice_after}%`
  }
  if (actionType === 'attack') return 'ICE −10%'
  if (actionType === 'defend') return 'ICE +10%'
  if (actionType === 'extract') return 'Extract'
  return null
}

/**
 * Completamento ibrido: il client chiama subito l'RPC a timer 0.
 * pg_cron (resolve_expired_actions, ~30s) copre chi è offline.
 * FOR UPDATE sullo slot rende i due percorsi idempotenti (niente doppio ICE/₵).
 * Il log lo scrive l'RPC; writeLog client solo se l'RPC fallisce davvero.
 */
export function useActionResolver({
  profile,
  activeSlot,
  nodes,
  slots = [],
  refreshProfile,
  reloadLogs,
  reloadMap,
}) {
  const resolvingRef = useRef(false)
  const loggedKeysRef = useRef(new Set())
  const [lastTraceResult, setLastTraceResult] = useState(null)
  const {
    playWorking,
    stopWorking,
    playInterference,
    stopInterference,
    stopActionLoops,
    playSuccess,
    playFail,
  } = useAudio()
  const playWorkingRef = useRef(playWorking)
  const playInterferenceRef = useRef(playInterference)
  const stopActionLoopsRef = useRef(stopActionLoops)
  playWorkingRef.current = playWorking
  playInterferenceRef.current = playInterference
  stopActionLoopsRef.current = stopActionLoops

  const actionType = String(activeSlot?.action_type ?? '').toLowerCase()
  const actionLoopKey = activeSlot?.id && actionType ? `${activeSlot.id}:${actionType}` : null

  useEffect(() => {
    if (!actionLoopKey) {
      stopActionLoopsRef.current()
      return () => {
        stopActionLoopsRef.current()
      }
    }
    if (CORE_ACTION_TYPES.has(actionType)) {
      playWorkingRef.current()
    } else if (HOSTILE_ACTION_TYPES.has(actionType)) {
      playInterferenceRef.current()
    } else {
      stopActionLoopsRef.current()
    }
    return () => {
      stopActionLoopsRef.current()
    }
  }, [actionLoopKey, actionType])

  const finishOwnSlot = useCallback(async (slotId, userId) => {
    await supabase
      .from('slots')
      .update(EMPTY_SLOT)
      .eq('id', slotId)
      .eq('user_id', userId)

    await supabase.from('profiles').update({ status: 'idle' }).eq('id', userId)
  }, [])

  const syncAfterResolve = useCallback(async () => {
    await refreshProfile()
    if (typeof reloadMap === 'function') void reloadMap()
  }, [refreshProfile, reloadMap])

  const recordLog = useCallback(
    async (key, payload) => {
      if (key && loggedKeysRef.current.has(key)) return { error: null }
      if (key) loggedKeysRef.current.add(key)
      try {
        const result = await writeLog(payload)
        if (result.error) {
          if (key) loggedKeysRef.current.delete(key)
          console.error('[recordLog] write failed', result.error, payload)
        } else if (typeof reloadLogs === 'function') {
          void reloadLogs()
        }
        return result
      } catch (err) {
        console.error('[recordLog]', err)
        if (key) loggedKeysRef.current.delete(key)
        return { error: err }
      }
    },
    [reloadLogs],
  )

  const resolveAction = useCallback(async () => {
    if (!profile || !activeSlot || resolvingRef.current) return
    if (!activeSlot.end_time) return
    if (Date.now() < new Date(activeSlot.end_time).getTime()) return

    resolvingRef.current = true
    stopActionLoops()
    playSuccess()
    try {
      const actionType = activeSlot.action_type
      const nodeName = await lookupNodeName(activeSlot.node_id, nodes)
      const slotId = activeSlot.slot_id
      const nodeId = activeSlot.node_id
      const logKey = `${activeSlot.id}:${actionType}:done`

      // --- TRACE ---
      if (actionType === 'trace') {
        const { data, error } = await supabase.rpc('execute_trace', {
          p_actor_slot_id: activeSlot.id,
          p_node_name: nodeName,
        })
        if (error && alreadyResolved(error)) {
          const fromLog = await hydrateTraceFromLogs(profile.id, nodeName)
          if (fromLog) {
            rememberTraceIntel(profile.id, fromLog, {
              nodeId,
              occupancyStartedAt:
                slots.find((s) => s.id === fromLog.targetSlotId)?.start_time ??
                null,
            })
            setLastTraceResult({
              revealed: fromLog.revealed,
              targetAction: fromLog.targetAction,
              at: fromLog.at,
              nodeName: fromLog.nodeName,
              outcome: fromLog.outcome,
              targetSlot: fromLog.targetSlot,
            })
          }
          await syncAfterResolve()
          return
        }
        if (error) {
          console.error('[execute_trace]', error)
          await finishOwnSlot(activeSlot.id, profile.id)
          await recordLog(logKey, {
            eventType: 'trace',
            message: msgTraceDone({
              revealed: 'Unknown',
              nodeName: pickNodeName(nodeName),
              targetSlot: slotId,
              outcome: 'failure',
            }),
            outcome: 'failure',
            nodeId,
            actorId: profile.id,
            meta: {
              node_name: nodeName,
              slot: slotId,
              tone: 'danger',
              error: error.message,
            },
          })
        }

        const revealed = data?.revealed ?? 'Unknown'
        const resolvedNode = pickNodeName(data?.node_name, nodeName)
        const targetSlot =
          data?.target_slot ??
          slots.find((s) => s.id === activeSlot.target_slot_id)?.slot_id ??
          null
        const targetSlotId =
          data?.target_slot_id ?? activeSlot.target_slot_id ?? null
        const outcome = data?.outcome ?? (error ? 'failure' : 'success')
        const targetSlotRow = slots.find((s) => s.id === targetSlotId)

        rememberTraceIntel(
          profile.id,
          {
            revealed,
            targetAction:
              data?.target_action ?? targetSlotRow?.action_type ?? null,
            at: Date.now(),
            nodeName: resolvedNode,
            outcome,
            targetSlot,
            targetSlotId,
            targetId: data?.target_id ?? targetSlotRow?.user_id ?? null,
          },
          {
            nodeId,
            occupancyStartedAt: targetSlotRow?.start_time ?? null,
          },
        )
        setLastTraceResult({
          revealed,
          targetAction:
            data?.target_action ?? targetSlotRow?.action_type ?? null,
          at: Date.now(),
          nodeName: resolvedNode,
          outcome,
          targetSlot,
        })
        await syncAfterResolve()
        return
      }

      // --- KICK ---
      if (actionType === 'kick') {
        const targetSlotRow = slots.find(
          (s) => s.id === activeSlot.target_slot_id,
        )
        const knownHandle = resolveKnownHandle(
          profile.id,
          activeSlot.target_slot_id,
          {
            targetUserId: targetSlotRow?.user_id ?? null,
            occupancyStartedAt: targetSlotRow?.start_time ?? null,
          },
        )

        const { data, error } = await supabase.rpc('execute_kick', {
          p_actor_slot_id: activeSlot.id,
          p_known_handle: knownHandle,
          p_node_name: nodeName,
        })

        if (error) {
          if (alreadyResolved(error)) {
            await syncAfterResolve()
            return
          }
          console.error('[execute_kick]', error)
          await finishOwnSlot(activeSlot.id, profile.id)
          await recordLog(logKey, {
            eventType: 'kick',
            message: `Fallito: Kick RPC error — Server: ${nodeName ?? 'Server (nome non risolto)'} [Slot ${slotId}]`,
            outcome: 'failure',
            nodeId,
            actorId: profile.id,
            meta: {
              node_name: nodeName,
              slot: slotId,
              tone: 'danger',
              error: error.message,
            },
          })
          await syncAfterResolve()
          return
        }

        if (!data?.blocked && data?.outcome !== 'success') {
          console.warn('[execute_kick] not blocked', data)
        }

        await syncAfterResolve()
        return
      }

      // --- ATTACK / DEFEND / FARM / EXTRACT ---
      if (['attack', 'defend', 'farm', 'extract'].includes(actionType)) {
        const { data, error } = await supabase.rpc('complete_base_action', {
          p_actor_slot_id: activeSlot.id,
          p_node_name: nodeName,
        })

        if (error) {
          if (alreadyResolved(error)) {
            await syncAfterResolve()
            return
          }
          console.error('[complete_base_action]', error)
          await finishOwnSlot(activeSlot.id, profile.id)
        } else {
          // complete_base_action ha già inserito il log di successo
          await syncAfterResolve()
          return
        }

        const resolvedName = pickNodeName(data?.node_name, nodeName)
        const ownerFaction = data?.owner_faction
        const captureLog =
          actionType === 'extract' &&
          (ownerFaction === 'security' ||
            ownerFaction === 'hacktivist' ||
            ownerFaction === 'consultant')
        const detail = completionDetail(actionType, data, profile)

        const { error: logError } = await recordLog(logKey, {
          eventType: actionType,
          message: captureLog
            ? msgExtractCapture({
                nodeName: resolvedName,
                faction: ownerFaction,
              })
            : msgActionDone({
                actionType,
                nodeName: resolvedName,
                slotId: data?.slot ?? slotId,
                detail,
              }),
          outcome: 'success',
          nodeId,
          actorId: profile.id,
          meta: {
            node_name: resolvedName,
            slot: data?.slot ?? slotId,
            tone: actionType === 'attack' ? 'info' : 'success',
            ice_before: data?.ice_before ?? null,
            ice_after: data?.ice_after ?? null,
            gain: data?.gain ?? null,
            owner_faction: ownerFaction ?? null,
            detail,
          },
        })
        if (logError) {
          console.error('[complete_base_action writeLog]', logError)
        }

        await syncAfterResolve()
        return
      }

      await finishOwnSlot(activeSlot.id, profile.id)
      await syncAfterResolve()
    } catch (err) {
      console.error('[resolveAction]', err)
    } finally {
      resolvingRef.current = false
    }
  }, [
    profile,
    activeSlot,
    nodes,
    slots,
    finishOwnSlot,
    recordLog,
    syncAfterResolve,
    stopActionLoops,
    playSuccess,
  ])

  const abortAction = useCallback(async (opts = {}) => {
    if (!profile || !activeSlot) {
      return { error: new Error('Nessuna operazione attiva') }
    }
    if (resolvingRef.current) {
      return { error: null }
    }

    const slotSnap = {
      id: activeSlot.id,
      nodeId: activeSlot.node_id,
      slotId: activeSlot.slot_id,
      actionType: activeSlot.action_type,
    }
    const logKey = `${slotSnap.id}:abort`

    resolvingRef.current = true
    stopActionLoops()
    playFail()
    try {
      const nodeName = await lookupNodeName(slotSnap.nodeId, nodes)

      const { data: incoming } = await supabase
        .from('slots')
        .select('action_type')
        .eq('target_slot_id', slotSnap.id)
        .in('action_type', ['kick', 'trace'])

      const escapedKick = (incoming ?? []).some((s) => s.action_type === 'kick')
      const escapedTrace =
        !escapedKick && (incoming ?? []).some((s) => s.action_type === 'trace')

      const reason =
        opts.reason ??
        (escapedKick || escapedTrace ? 'tactical_abort' : 'player_abort')
      const targetLost = reason === 'target_lost'

      const rpc = await supabase.rpc('abort_action', {
        p_actor_slot_id: slotSnap.id,
        p_node_name: nodeName,
        p_reason: reason,
      })

      if (rpc.error) {
        if (!alreadyResolved(rpc.error)) {
          await finishOwnSlot(slotSnap.id, profile.id)
        }
      }

      const sqlLogged = Boolean(rpc.data?.logged)
      if (!sqlLogged) {
        const { error: logError } = await recordLog(logKey, {
          eventType: 'abort',
          message: msgAbort({
            actionType: slotSnap.actionType,
            nodeName,
            slotId: slotSnap.slotId,
            escapedKick: targetLost ? false : escapedKick,
            escapedTrace: targetLost ? false : escapedTrace,
            targetLost,
          }),
          outcome: 'aborted',
          nodeId: slotSnap.nodeId,
          actorId: profile.id,
          meta: {
            reason,
            action_type: slotSnap.actionType,
            slot: slotSnap.slotId,
            node_name: nodeName,
            tone: 'warning',
            escaped_kick: escapedKick,
            escaped_trace: escapedTrace,
          },
        })
        if (logError) {
          console.error('[abort writeLog]', logError)
        }
      }

      if (!targetLost && (escapedKick || escapedTrace)) {
        await recordLog(`${slotSnap.id}:escape`, {
          eventType: 'escape',
          message: msgEscape({
            kind: escapedKick ? 'kick' : 'trace',
            nodeName,
            slotId: slotSnap.slotId,
          }),
          outcome: 'success',
          nodeId: slotSnap.nodeId,
          actorId: profile.id,
          meta: {
            tone: 'warning',
            node_name: nodeName,
            slot: slotSnap.slotId,
            compromised_slot: slotSnap.slotId,
            compromised_action: slotSnap.actionType,
            action_type: slotSnap.actionType,
          },
        })
      }

      await syncAfterResolve()
      return { error: null }
    } catch (err) {
      return { error: err }
    } finally {
      resolvingRef.current = false
    }
  }, [profile, activeSlot, nodes, finishOwnSlot, recordLog, syncAfterResolve, stopActionLoops, playFail])

  useEffect(() => {
    if (!profile || !activeSlot?.end_time) return

    const tick = () => {
      void resolveAction()
    }

    tick()
    const id = setInterval(tick, 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [profile, activeSlot, resolveAction])

  // Kick/Trace: se il bersaglio ha già lasciato lo slot, abortisci subito.
  useEffect(() => {
    if (!profile || !activeSlot) return
    if (activeSlot.action_type !== 'kick' && activeSlot.action_type !== 'trace') {
      return
    }
    if (!slots.length || !activeSlot.target_slot_id) return
    const target = slots.find((s) => s.id === activeSlot.target_slot_id)
    if (!target) return
    if (target.user_id || target.is_decoy) return
    void abortAction({ reason: 'target_lost' })
  }, [profile, activeSlot, slots, abortAction])

  const blockedRef = useRef(null)
  useEffect(() => {
    const blocked = Boolean(profile?.is_blocked)
    if (blockedRef.current === null) {
      blockedRef.current = blocked
      return
    }
    if (blocked && !blockedRef.current) {
      stopActionLoops()
      playFail()
    }
    blockedRef.current = blocked
  }, [profile?.is_blocked, playFail, stopActionLoops])

  return {
    abortAction,
    lastTraceResult,
    clearTraceResult: () => setLastTraceResult(null),
  }
}
