import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  MATCH_SETTINGS_EVENT,
  WORLD_REFRESH_EVENT,
} from '../lib/constants'
import {
  activateScheduledMatch,
  claimLobbyHost,
  concludeMatch,
  fetchGameSettings,
  fetchLobbyPlayers,
  markBriefingSeen,
  resetLobby,
  scheduleGame,
  selectClass,
  startGame,
  toggleReady,
} from '../lib/gameSession'

const DEFAULT_STATE = 'ACTIVE'

/**
 * Stato globale della partita (Lobby / Scheduled / Active) + lista giocatori realtime.
 * Se game_settings non è ancora migrato, resta ACTIVE (comportamento attuale).
 */
export function useGameSession() {
  const { profile, refreshProfile, user } = useAuth()
  const [gameState, setGameState] = useState(DEFAULT_STATE)
  const [startedAt, setStartedAt] = useState(null)
  const [scheduledStartTime, setScheduledStartTime] = useState(null)
  const [matchDurationDays, setMatchDurationDays] = useState(null)
  const [winningFaction, setWinningFaction] = useState(null)
  const [winningMercenaryId, setWinningMercenaryId] = useState(null)
  const [matchResult, setMatchResult] = useState(null)
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const activatingRef = useRef(false)
  const concludingRef = useRef(false)
  const localOverrideRef = useRef(null)
  const claimingHostRef = useRef(false)

  const applySettings = useCallback((row) => {
    if (!row) return
    if (row.game_state) setGameState(row.game_state)
    setStartedAt(row.started_at ?? null)
    setScheduledStartTime(row.scheduled_start_time ?? null)
    setMatchDurationDays(row.match_duration_days ?? null)
    setWinningFaction(row.winning_faction ?? null)
    setWinningMercenaryId(row.winning_mercenary_id ?? null)
    setMatchResult(row.match_result ?? null)
  }, [])

  const load = useCallback(async () => {
    if (localOverrideRef.current?.game_state === 'COMPLETED') {
      applySettings(localOverrideRef.current)
      setLoading(false)
      return
    }

    const [settingsRes, playersRes] = await Promise.all([
      fetchGameSettings(),
      fetchLobbyPlayers(),
    ])

    if (settingsRes.error) {
      const missing =
        /schema cache|does not exist|could not find/i.test(
          settingsRes.error.message ?? '',
        )
      if (!missing) setError(settingsRes.error.message)
      setGameState(DEFAULT_STATE)
    } else if (settingsRes.data?.game_state) {
      applySettings(settingsRes.data)
    } else {
      setGameState(DEFAULT_STATE)
    }

    if (playersRes.error) {
      setPlayers([])
    } else {
      setPlayers(playersRes.data ?? [])
    }
    setLoading(false)
  }, [applySettings])

  const gameStateRef = useRef(gameState)
  gameStateRef.current = gameState

  useEffect(() => {
    load()

    const channel = supabase
      .channel('game-session')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_settings' },
        (payload) => {
          localOverrideRef.current = null
          applySettings(payload.new)
          void load()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          if (gameStateRef.current === 'ACTIVE') return
          void load()
        },
      )
      .subscribe()

    function onMatchSettings(event) {
      const { row, local } = event.detail ?? {}
      if (!row) return
      if (local) {
        localOverrideRef.current = row
        applySettings(row)
        setLoading(false)
        return
      }
      localOverrideRef.current = null
      applySettings(row)
      void load()
    }

    function onWorldRefresh() {
      void load()
    }

    window.addEventListener(MATCH_SETTINGS_EVENT, onMatchSettings)
    window.addEventListener(WORLD_REFRESH_EVENT, onWorldRefresh)

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener(MATCH_SETTINGS_EVENT, onMatchSettings)
      window.removeEventListener(WORLD_REFRESH_EVENT, onWorldRefresh)
    }
  }, [applySettings, load])

  const setReady = useCallback(
    async (next) => {
      if (!profile?.id) return { error: new Error('Nessun profilo') }
      setBusy(true)
      setError(null)
      setPlayers((prev) =>
        prev.map((player) =>
          player.id === profile.id ? { ...player, is_ready: next } : player,
        ),
      )
      try {
        const { error: updError } = await toggleReady(profile.id, next)
        if (updError) throw updError
        await refreshProfile()
        await load()
        return { error: null }
      } catch (err) {
        await load()
        setError(err.message ?? 'Impossibile aggiornare lo stato')
        return { error: err }
      } finally {
        setBusy(false)
      }
    },
    [profile?.id, refreshProfile, load],
  )

  const start = useCallback(
    async (allowSolo = false) => {
      setBusy(true)
      setError(null)
      try {
        const { data, error: rpcError } = await startGame(allowSolo)
        if (rpcError) throw rpcError
        await refreshProfile()
        await load()
        return { data, error: null }
      } catch (err) {
        setError(err.message ?? 'Avvio fallito')
        return { error: err }
      } finally {
        setBusy(false)
      }
    },
    [refreshProfile, load],
  )

  const schedule = useCallback(
    async ({ startTime, durationDays = 7, allowSolo = false }) => {
      setBusy(true)
      setError(null)
      try {
        const iso =
          startTime instanceof Date ? startTime.toISOString() : startTime
        const { data, error: rpcError } = await scheduleGame({
          startTime: iso,
          durationDays,
          allowSolo,
        })
        if (rpcError) throw rpcError
        await refreshProfile()
        await load()
        return { data, error: null }
      } catch (err) {
        setError(err.message ?? 'Programmazione fallita')
        return { error: err }
      } finally {
        setBusy(false)
      }
    },
    [refreshProfile, load],
  )

  const activate = useCallback(
    async (force = false, { silent = false } = {}) => {
      if (activatingRef.current) return { error: null }
      activatingRef.current = true
      if (!silent) {
        setBusy(true)
        setError(null)
      }
      try {
        const { data, error: rpcError } = await activateScheduledMatch(force)
        if (rpcError) throw rpcError
        await refreshProfile()
        await load()
        return { data, error: null }
      } catch (err) {
        const msg = err.message ?? 'Avvio programmato fallito'
        if (!silent && !/countdown|non è ancora/i.test(msg)) setError(msg)
        return { error: err }
      } finally {
        activatingRef.current = false
        if (!silent) setBusy(false)
      }
    },
    [refreshProfile, load],
  )

  const acknowledgeBriefing = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const { data, error: rpcError } = await markBriefingSeen()
      if (rpcError) throw rpcError
      await refreshProfile()
      return { data, error: null }
    } catch (err) {
      setError(err.message ?? 'Impossibile confermare il briefing')
      return { error: err }
    } finally {
      setBusy(false)
    }
  }, [refreshProfile])

  const conclude = useCallback(
    async ({ silent = false } = {}) => {
      if (silent && concludingRef.current) return { error: null }
      if (silent) concludingRef.current = true
      if (!silent) {
        setBusy(true)
        setError(null)
      }
      try {
        const { data, error: rpcError } = await concludeMatch()
        if (rpcError) throw rpcError
        await refreshProfile()
        await load()
        return { data, error: null }
      } catch (err) {
        if (!silent) setError(err.message ?? 'Chiusura partita fallita')
        return { error: err }
      } finally {
        if (silent) concludingRef.current = false
        if (!silent) setBusy(false)
      }
    },
    [refreshProfile, load],
  )

  const reset = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const { data, error: rpcError } = await resetLobby()
      if (rpcError) throw rpcError
      localOverrideRef.current = null
      await refreshProfile()
      await load()
      return { data, error: null }
    } catch (err) {
      setError(err.message ?? 'Reset lobby fallito')
      return { error: err }
    } finally {
      setBusy(false)
    }
  }, [refreshProfile, load])

  const chooseClass = useCallback(
    async (role) => {
      setBusy(true)
      setError(null)
      try {
        const { data, error: rpcError } = await selectClass(role)
        if (rpcError) throw rpcError
        await refreshProfile()
        return { data, error: null }
      } catch (err) {
        setError(err.message ?? 'Selezione classe fallita')
        return { error: err }
      } finally {
        setBusy(false)
      }
    },
    [refreshProfile],
  )

  useEffect(() => {
    if (gameState !== 'SCHEDULED_WAITING' || !scheduledStartTime) return undefined
    const tick = () => {
      const start = new Date(scheduledStartTime).getTime()
      if (Number.isFinite(start) && Date.now() >= start) {
        void activate(false, { silent: true })
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [activate, gameState, scheduledStartTime])

  useEffect(() => {
    if (gameState !== 'ACTIVE' || !startedAt || !matchDurationDays) {
      return undefined
    }
    const days = Number(matchDurationDays)
    if (!Number.isFinite(days) || days <= 0) return undefined
    const tick = () => {
      const start = new Date(startedAt).getTime()
      if (Number.isFinite(start) && Date.now() >= start + days * 86_400_000) {
        void conclude({ silent: true })
      }
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [conclude, gameState, matchDurationDays, startedAt])

  useEffect(() => {
    if (loading) return undefined
    if (gameState !== 'LOBBY') return undefined
    if (claimingHostRef.current) return undefined
    if (players.some((player) => player.is_admin)) {
      claimingHostRef.current = true
      return undefined
    }
    claimingHostRef.current = true
    void claimLobbyHost()
      .then(async ({ error }) => {
        if (error) return
        await refreshProfile()
        await load()
      })
      .catch(() => {})
  }, [gameState, loading, players, load, refreshProfile])

  const readyCount = useMemo(
    () => players.filter((p) => p.is_ready).length,
    [players],
  )

  return {
    gameState,
    startedAt,
    scheduledStartTime,
    matchDurationDays,
    winningFaction,
    winningMercenaryId,
    matchResult,
    players,
    loading,
    error,
    setError,
    busy,
    readyCount,
    isHost: Boolean(profile?.is_admin),
    userId: user?.id ?? profile?.id ?? null,
    reload: load,
    setReady,
    start,
    schedule,
    activate,
    acknowledgeBriefing,
    conclude,
    reset,
    chooseClass,
  }
}
