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
  return /già completat|non valida|Nessuna operazione attiva/i.test(
    error?.message ?? '',
  )
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
 * Completamento: il log lo scrive l'RPC (niente doppio insert client).
 * Client writeLog solo se l'RPC fallisce.
 */
export function useActionResolver({
  profile,
  activeSlot,
  nodes,
  slots = [],
  refreshProfile,
  reloadLogs,
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
        if (error) {
          console.error('[execute_trace]', error)
          await finishOwnSlot(activeSlot.id, profile.id)
          if (!alreadyResolved(error)) {
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
        } else {
          // execute_trace ha già scritto il log attore + trace_received
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

        if (outcome === 'success' && targetSlotId) {
          rememberSlotIntel(profile.id, {
            targetSlotId,
            handle: revealed,
            targetUserId: data?.target_id ?? targetSlotRow?.user_id ?? null,
            nodeId,
            nodeName: resolvedNode,
            targetAction:
              data?.target_action ?? targetSlotRow?.action_type ?? null,
            targetSlotLabel: targetSlot,
            occupancyStartedAt: targetSlotRow?.start_time ?? null,
          })
        }

        setLastTraceResult({
          revealed,
          targetAction:
            data?.target_action ?? targetSlotRow?.action_type ?? null,
          at: Date.now(),
          nodeName: resolvedNode,
          outcome,
          targetSlot,
        })
        await refreshProfile()
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
          console.error('[execute_kick]', error)
          await finishOwnSlot(activeSlot.id, profile.id)
          if (!alreadyResolved(error)) {
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
          }
          await refreshProfile()
          return
        }

        if (!data?.blocked && data?.outcome !== 'success') {
          console.warn('[execute_kick] not blocked', data)
        }

        await refreshProfile()
        return
      }

      // --- ATTACK / DEFEND / FARM / EXTRACT ---
      if (['attack', 'defend', 'farm', 'extract'].includes(actionType)) {
        const { data, error } = await supabase.rpc('complete_base_action', {
          p_actor_slot_id: activeSlot.id,
          p_node_name: nodeName,
        })

        if (error) {
          console.error('[complete_base_action]', error)
          await finishOwnSlot(activeSlot.id, profile.id)
          if (alreadyResolved(error)) {
            await refreshProfile()
            return
          }
        } else {
          // complete_base_action ha già inserito il log di successo
          await refreshProfile()
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

        await refreshProfile()
        return
      }

      await finishOwnSlot(activeSlot.id, profile.id)
      await refreshProfile()
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
    refreshProfile,
    finishOwnSlot,
    recordLog,
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

      await refreshProfile()
      return { error: null }
    } catch (err) {
      return { error: err }
    } finally {
      resolvingRef.current = false
    }
  }, [profile, activeSlot, nodes, refreshProfile, finishOwnSlot, recordLog, stopActionLoops, playFail])

  useEffect(() => {
    if (!profile || profile.status !== 'busy' || !activeSlot) return

    const tick = () => {
      void resolveAction()
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
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
