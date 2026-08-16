import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  abilitiesForRole,
  abilityCooldownRemainingMs,
  getAbility,
} from '../lib/abilities'
import { archiveFromAbilityResult, saveIntelReport } from '../lib/intelArchive'
import { NIGHT_TRUCE_DENIED, isNightTruceActive } from '../lib/nightTruce'
import { useAudio } from './useAudio'

function parseRpcPayload(data) {
  if (data == null) return null
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return { raw: data }
    }
  }
  return data
}

/**
 * Valida PA / cooldown lato client, chiama use_ability, aggiorna il profilo.
 */
export function useAbilities() {
  const { profile, refreshProfile } = useAuth()
  const { playSuccess, playError } = useAudio()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [lastResult, setLastResult] = useState(null)

  const role = profile?.role ?? null
  const catalog = useMemo(() => abilitiesForRole(role), [role])
  const cooldowns = profile?.ability_cooldowns ?? profile?.cooldowns ?? {}

  const remainingMs = useCallback(
    (abilityId, now = Date.now()) => {
      const ability = getAbility(abilityId)
      if (!ability) return 0
      return abilityCooldownRemainingMs(cooldowns, ability, now)
    },
    [cooldowns],
  )

  const canUse = useCallback(
    (abilityId, now = Date.now()) => {
      const ability = getAbility(abilityId)
      if (!ability || !profile) return false
      if (isNightTruceActive(new Date(now))) return false
      if (profile.is_blocked) return false
      if (profile.role !== ability.role) return false
      if ((profile.pa ?? 0) < ability.paCost) return false
      if (remainingMs(abilityId, now) > 0) return false
      return true
    },
    [profile, remainingMs],
  )

  const activate = useCallback(
    async (abilityId, targets = {}) => {
      const ability = getAbility(abilityId)
      if (!ability) {
        const err = new Error('Abilità sconosciuta')
        setError(err.message)
        playError()
        return { data: null, error: err }
      }
      if (!canUse(abilityId)) {
        const cd = remainingMs(abilityId)
        const err = new Error(
            isNightTruceActive()
            ? NIGHT_TRUCE_DENIED
            : cd > 0
              ? 'Abilità in cooldown'
              : (profile?.pa ?? 0) < ability.paCost
                ? `PA insufficienti (servono ${ability.paCost})`
                : 'Abilità non disponibile',
        )
        setError(err.message)
        playError()
        return { data: null, error: err }
      }

      setBusy(true)
      setError(null)
      try {
        const { data, error: rpcError } = await supabase.rpc('use_ability', {
          p_ability_id: abilityId,
          p_target_id: targets.targetId ?? null,
          p_target_slot_id: targets.targetSlotId ?? null,
          p_node_id: targets.nodeId ?? null,
          p_ice_sign: targets.iceSign ?? 1,
        })
        if (rpcError) throw rpcError
        const payload = parseRpcPayload(data)
        const result = payload?.result ?? payload
        if (
          (abilityId === 'background_check' || abilityId === 'doxxing') &&
          !result?.report_id
        ) {
          const archive = archiveFromAbilityResult(abilityId, result)
          if (archive) {
            const saved = await saveIntelReport(archive)
            if (!saved.error && payload?.result) {
              payload.result.report_id = true
            }
          }
        }
        setLastResult({
          abilityId,
          at: Date.now(),
          payload,
        })
        await refreshProfile()
        playSuccess()
        return { data: payload, error: null }
      } catch (err) {
        const message = err?.message ?? 'Attivazione fallita'
        setError(message)
        playError()
        return { data: null, error: err }
      } finally {
        setBusy(false)
      }
    },
    [canUse, remainingMs, profile?.pa, refreshProfile, playSuccess, playError],
  )

  return {
    profile,
    role,
    catalog,
    cooldowns,
    busy,
    error,
    setError,
    lastResult,
    clearResult: () => setLastResult(null),
    remainingMs,
    canUse,
    activate,
  }
}
