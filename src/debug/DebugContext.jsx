import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { HEAT_MAX, PA_MAX, FACTIONS, ROLES, isMercFaction, pushMatchSettings, requestWorldRefresh } from '../lib/constants'
import { clampReputation } from '../lib/pricing'
import { CORE_DATA_ID, coreDataCount, parseInventory } from '../lib/afterlifeCatalog'
import {
  resetLobby as resetLobbyRpc,
  resetTotal as resetTotalRpc,
  activateScheduledMatch,
  applyMatchConcluded,
  applyMatchResetToLobby,
  concludeMatch,
  CONFIRM_CLOSE_CYCLE,
  CONFIRM_RESET_TOTAL,
  snapshotMatchResult,
} from '../lib/gameSession'
import { clearIntelArchive as clearIntelArchiveRpc } from '../lib/intelArchive'
import {
  DEBUG_CREDIT_BOOST,
  DEBUG_STORAGE_KEY,
  DEBUG_UI_ENABLED,
} from './debugConfig'

const DebugContext = createContext(null)

const DEFAULTS = {
  enabled: false,
  bypassCosts: true,
  autoRefillPa: true,
  instantTravel: false,
  instantActions: false,
}

const NEGATIVE_BUFF_KEYS = new Set([
  'blocked',
  'is_blocked',
  'freeze',
  'frozen',
  'asset_freeze',
  'asset freeze',
  'nda',
])

function isNegativeBuff(entry) {
  if (entry == null) return false
  if (typeof entry === 'string') {
    return NEGATIVE_BUFF_KEYS.has(entry.trim().toLowerCase())
  }
  if (typeof entry === 'object') {
    const key = entry.id ?? entry.type ?? entry.kind ?? entry.name ?? ''
    const polarity = String(entry.polarity ?? entry.kind ?? '').toLowerCase()
    if (polarity === 'debuff' || polarity === 'malus' || entry.negative === true) {
      return true
    }
    return NEGATIVE_BUFF_KEYS.has(String(key).trim().toLowerCase())
  }
  return false
}

function readStored() {
  try {
    const raw = localStorage.getItem(DEBUG_STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw), enabled: false }
  } catch {
    return { ...DEFAULTS }
  }
}

export function DebugProvider({ children }) {
  const { profile, refreshProfile } = useAuth()
  const [settings, setSettings] = useState(readStored)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (!DEBUG_UI_ENABLED) return
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const patchProfile = useCallback(
    async (updates) => {
      if (!profile) return { error: new Error('Nessun profilo') }
      setBusy(true)
      setMessage(null)
      try {
        const { error } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', profile.id)
        if (error) throw error
        await refreshProfile()
        return { error: null }
      } catch (err) {
        setMessage(err.message ?? 'Debug update fallito')
        return { error: err }
      } finally {
        setBusy(false)
      }
    },
    [profile, refreshProfile],
  )

  const refillPa = useCallback(async () => {
    const { error } = await patchProfile({ pa: PA_MAX })
    if (!error) setMessage(`PA ricaricati a ${PA_MAX}/${PA_MAX}`)
  }, [patchProfile])

  const addCredits = useCallback(async () => {
    if (!profile) return
    const next = profile.creds + DEBUG_CREDIT_BOOST
    const { error } = await patchProfile({ creds: next })
    if (!error) setMessage(`+${DEBUG_CREDIT_BOOST} ₵ → ${next} ₵`)
  }, [patchProfile, profile])

  const clearBlock = useCallback(async () => {
    const { error } = await patchProfile({ is_blocked: false })
    if (!error) setMessage('is_blocked = false')
  }, [patchProfile])

  const clearDebuffs = useCallback(async () => {
    const updates = {
      is_blocked: false,
      frozen_until: null,
      nda_until: null,
    }
    const rawBuffs = profile?.buffs
    if (Array.isArray(rawBuffs)) {
      updates.buffs = rawBuffs.filter((entry) => !isNegativeBuff(entry))
    }
    const { error } = await patchProfile(updates)
    if (!error) setMessage('Malus rimossi (block / freeze / NDA)')
  }, [patchProfile, profile])

  const bumpReputation = useCallback(
    async (delta) => {
      if (!profile) return
      const next = clampReputation((profile.reputation ?? 3) + delta)
      const { error } = await patchProfile({ reputation: next })
      if (!error) setMessage(`Rep ${next}/5`)
    },
    [patchProfile, profile],
  )

  const bumpHeat = useCallback(
    async (delta) => {
      if (!profile) return
      const next = Math.max(0, Math.min(HEAT_MAX, (profile.heat ?? 0) + delta))
      const { error } = await patchProfile({ heat: next })
      if (!error) setMessage(`Heat ${next}/${HEAT_MAX}`)
    },
    [patchProfile, profile],
  )

  const clearHeat = useCallback(async () => {
    const { error } = await patchProfile({ heat: 0 })
    if (!error) setMessage('Heat azzerato')
  }, [patchProfile])

  const setRole = useCallback(
    async (role) => {
      const valid = ROLES.some((r) => r.id === role)
      if (!valid) return
      const { error } = await patchProfile({ role })
      if (!error) setMessage(`Classe → ${role}`)
    },
    [patchProfile],
  )

  const setFaction = useCallback(
    async (faction) => {
      const meta = FACTIONS.find((f) => f.id === faction)
      if (!meta) return
      const { error } = await patchProfile({ faction })
      if (!error) setMessage(`Fazione → ${meta.barTag}`)
    },
    [patchProfile],
  )

  const resetCooldowns = useCallback(async () => {
    const { error } = await patchProfile({
      equipment_cooldown_until: null,
      ability_cooldowns: {},
    })
    if (!error) setMessage('Cooldown abilità / equip azzerati')
  }, [patchProfile])

  const simulateDailyTick = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { data, error } = await supabase.rpc('simulate_daily_tick')
      if (error) throw error
      await refreshProfile()
      requestWorldRefresh()
      const corp = data?.corp_servers ?? 0
      const rebel = data?.rebel_servers ?? 0
      const unblocked = data?.profiles_unblocked ?? 0
      const mercNodes = data?.merc_servers ?? 0
      const mercPay = data?.merc_payout ?? 0
      setMessage(
        `+24h · Corp +${corp} VP · Rebel +${rebel} VP · PA max · Heat −1${
          unblocked ? ` · ${unblocked} sbloccati` : ''
        }${mercPay ? ` · Merc ${mercNodes}×100₵` : ''}`,
      )
    } catch (err) {
      setMessage(err.message ?? 'Daily tick fallito')
    } finally {
      setBusy(false)
    }
  }, [refreshProfile])

  const resetLobby = useCallback(async () => {
    if (
      !window.confirm(
        'Sei sicuro di voler riportare il gioco allo stato di Lobby?',
      )
    ) {
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await resetLobbyRpc()
      if (error) throw error
      pushMatchSettings({ game_state: 'LOBBY' })
      await refreshProfile()
      requestWorldRefresh()
      setMessage('Server in LOBBY · fazioni e classi azzerate')
    } catch (err) {
      setMessage(err.message ?? 'Reset lobby fallito')
    } finally {
      setBusy(false)
    }
  }, [refreshProfile])

  const concludeMatchSim = useCallback(async () => {
    if (!window.confirm(CONFIRM_CLOSE_CYCLE)) {
      return { cancelled: true }
    }
    setBusy(true)
    setMessage(null)
    try {
      const { data, error } = await concludeMatch()
      if (error) throw error
      applyMatchConcluded(data)
      await refreshProfile()
      setMessage('Ciclo chiuso → COMPLETED')
      return { error: null, data }
    } catch (err) {
      const snapshot = await snapshotMatchResult()
      applyMatchConcluded(snapshot, { local: true })
      const msg =
        err.message ??
        'Fine partita fallita — preview locale della schermata End Game.'
      setMessage(msg)
      return { error: err, local: true, message: msg }
    } finally {
      setBusy(false)
    }
  }, [refreshProfile])

  const forceActivateMatch = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await activateScheduledMatch(true)
      if (error) throw error
      await refreshProfile()
      requestWorldRefresh()
      setMessage('Match forzato → ACTIVE')
    } catch (err) {
      setMessage(err.message ?? 'Avvio forzato fallito')
    } finally {
      setBusy(false)
    }
  }, [refreshProfile])

  const clearIntelArchive = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { data, error } = await clearIntelArchiveRpc()
      if (error) throw error
      requestWorldRefresh()
      const deleted = data?.deleted ?? 0
      setMessage(
        deleted
          ? `Archivio Intel svuotato (${deleted} report)`
          : 'Archivio Intel già vuoto',
      )
    } catch (err) {
      setMessage(err.message ?? 'Svuota archivio Intel fallito')
    } finally {
      setBusy(false)
    }
  }, [])

  const resetTotal = useCallback(async () => {
    if (!window.confirm(CONFIRM_RESET_TOTAL)) {
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await resetTotalRpc()
      if (error) throw error
      applyMatchResetToLobby()
      await refreshProfile()
      setMessage('Reset totale · nuova partita (LOBBY)')
    } catch (err) {
      setMessage(err.message ?? 'Reset totale fallito')
    } finally {
      setBusy(false)
    }
  }, [refreshProfile])

  const giveCoreData = useCallback(async () => {
    if (!profile) return
    if (!isMercFaction(profile.faction)) {
      setMessage('Solo Mercenary possono ricevere Core Data')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { error: rpcError } = await supabase.rpc('zt_grant_item', {
        p_user_id: profile.id,
        p_item_id: CORE_DATA_ID,
      })
      if (rpcError) {
        const entry = {
          id: crypto.randomUUID(),
          itemId: CORE_DATA_ID,
          at: new Date().toISOString(),
        }
        const { error } = await supabase
          .from('profiles')
          .update({
            inventory: [...parseInventory(profile.inventory), entry],
          })
          .eq('id', profile.id)
        if (error) throw error
      }
      await refreshProfile()
      setMessage(`+1 Core Data → ${coreDataCount(profile.inventory) + 1}`)
    } catch (err) {
      setMessage(err.message ?? 'Debug update fallito')
    } finally {
      setBusy(false)
    }
  }, [profile, refreshProfile])

  useEffect(() => {
    if (!DEBUG_UI_ENABLED || !settings.enabled || !settings.autoRefillPa) return
    if (!profile || profile.pa > 0 || busy) return
    void refillPa()
  }, [
    profile?.pa,
    profile,
    settings.enabled,
    settings.autoRefillPa,
    busy,
    refillPa,
  ])

  const setEnabled = useCallback((enabled) => {
    setSettings((s) => ({ ...s, enabled }))
    setMessage(enabled ? 'DEBUG MODE ON' : 'DEBUG MODE OFF')
  }, [])

  const setBypassCosts = useCallback((bypassCosts) => {
    setSettings((s) => ({ ...s, bypassCosts }))
  }, [])

  const setAutoRefillPa = useCallback((autoRefillPa) => {
    setSettings((s) => ({ ...s, autoRefillPa }))
  }, [])

  const setInstantTravel = useCallback((instantTravel) => {
    setSettings((s) => ({ ...s, instantTravel }))
  }, [])

  const setInstantActions = useCallback((instantActions) => {
    setSettings((s) => ({ ...s, instantActions }))
  }, [])

  const value = useMemo(() => {
    const active = DEBUG_UI_ENABLED && settings.enabled
    return {
      uiEnabled: DEBUG_UI_ENABLED,
      enabled: active,
      bypassCosts: active && settings.bypassCosts,
      autoRefillPa: settings.autoRefillPa,
      instantTravel: active && settings.instantTravel,
      instantActions: active && settings.instantActions,
      busy,
      message,
      clearMessage: () => setMessage(null),
      setEnabled,
      setBypassCosts,
      setAutoRefillPa,
      setInstantTravel,
      setInstantActions,
      refillPa,
      addCredits,
      clearBlock,
      clearDebuffs,
      bumpReputation,
      bumpHeat,
      clearHeat,
      setRole,
      setFaction,
      resetCooldowns,
      simulateDailyTick,
      resetLobby,
      concludeMatchSim,
      forceActivateMatch,
      resetTotal,
      clearIntelArchive,
      giveCoreData,
      paCost: (base = 1) => (active && settings.bypassCosts ? 0 : base),
      creditCost: (base) => (active && settings.bypassCosts ? 0 : base),
    }
  }, [
    settings,
    busy,
    message,
    setEnabled,
    setBypassCosts,
    setAutoRefillPa,
    setInstantTravel,
    setInstantActions,
    refillPa,
    addCredits,
    clearBlock,
    clearDebuffs,
    bumpReputation,
    bumpHeat,
    clearHeat,
    setRole,
    setFaction,
    resetCooldowns,
    simulateDailyTick,
    resetLobby,
    concludeMatchSim,
    forceActivateMatch,
    resetTotal,
    clearIntelArchive,
    giveCoreData,
  ])

  return (
    <DebugContext.Provider value={value}>{children}</DebugContext.Provider>
  )
}

const STUB = {
  uiEnabled: false,
  enabled: false,
  bypassCosts: false,
  autoRefillPa: false,
  instantTravel: false,
  instantActions: false,
  busy: false,
  message: null,
  clearMessage: () => {},
  setEnabled: () => {},
  setBypassCosts: () => {},
  setAutoRefillPa: () => {},
  setInstantTravel: () => {},
  setInstantActions: () => {},
  refillPa: async () => {},
  addCredits: async () => {},
  clearBlock: async () => {},
  clearDebuffs: async () => {},
  bumpReputation: async () => {},
  bumpHeat: async () => {},
  clearHeat: async () => {},
  setRole: async () => {},
  setFaction: async () => {},
  resetCooldowns: async () => {},
  simulateDailyTick: async () => {},
  resetLobby: async () => {},
  concludeMatchSim: async () => {},
  forceActivateMatch: async () => {},
  resetTotal: async () => {},
  clearIntelArchive: async () => {},
  giveCoreData: async () => {},
  paCost: (base = 1) => base,
  creditCost: (base) => base,
}

export function useDebug() {
  return useContext(DebugContext) ?? STUB
}
