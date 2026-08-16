import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { supabase } from '../lib/supabase'
import { PA_MAX, STARTING_CREDS } from '../lib/constants'
import { DEFAULT_SETTINGS, parseSettings } from '../lib/settings'
import { usePresenceHeartbeat } from '../hooks/usePresenceHeartbeat'
import { clearPresence } from '../lib/presence'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  usePresenceHeartbeat(session?.user?.id)

  const fetchProfile = useCallback(async (userId) => {
    const { data, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (fetchError) {
      setError(fetchError.message)
      setProfile(null)
      return null
    }

    setProfile(data)
    return data
  }, [])

  useEffect(() => {
    let mounted = true

    const hash = window.location.hash || ''
    if (hash.includes('type=recovery')) {
      setPasswordRecovery(true)
    }

    supabase.auth.getSession().then(({ data: { session: current } }) => {
      if (!mounted) return
      setSession(current)
      if (current?.user) {
        fetchProfile(current.user.id).finally(() => {
          if (mounted) setLoading(false)
        })
      } else {
        setLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
      }
      if (event === 'SIGNED_OUT') {
        setPasswordRecovery(false)
      }
      setSession(nextSession)
      if (nextSession?.user) {
        fetchProfile(nextSession.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  // Creds / PA in header sempre aggiornati (anche da altri client)
  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return

    const channel = supabase
      .channel(`profile-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          setProfile((prev) =>
            prev ? { ...prev, ...payload.new } : payload.new,
          )
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session?.user?.id])

  const signUp = useCallback(async (email, password) => {
    setError(null)
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    })
    if (signUpError) {
      setError(signUpError.message)
      return { error: signUpError }
    }
    return { data }
  }, [])

  const signIn = useCallback(async (email, password) => {
    setError(null)
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (signInError) {
      setError(signInError.message)
      return { error: signInError }
    }
    return { data }
  }, [])

  const signOut = useCallback(async () => {
    setError(null)
    setPasswordRecovery(false)
    const userId = session?.user?.id
    try {
      await clearPresence(userId)
    } catch {
      /* logout comunque */
    }
    await supabase.auth.signOut()
    setProfile(null)
  }, [session?.user?.id])

  const resetPassword = useCallback(async (email) => {
    setError(null)
    const redirectTo = `${window.location.origin}/`
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo },
    )
    if (resetError) {
      setError(resetError.message)
      return { error: resetError }
    }
    return { data: true }
  }, [])

  const updatePassword = useCallback(async (password) => {
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
      return { error: updateError }
    }
    setPasswordRecovery(false)
    if (window.location.hash || window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    return { data: true }
  }, [])

  const createCharacter = useCallback(
    async ({ name }) => {
      if (!session?.user) {
        const err = new Error('Sessione non valida')
        setError(err.message)
        return { error: err }
      }

      setError(null)
      const payload = {
        id: session.user.id,
        name: name.trim(),
        creds: STARTING_CREDS,
        pa: PA_MAX,
        status: 'idle',
        is_blocked: false,
        is_ready: false,
        buffs: [],
        cooldowns: {},
        ability_cooldowns: {},
      }

      const { data, error: insertError } = await supabase
        .from('profiles')
        .insert(payload)
        .select()
        .single()

      if (insertError) {
        setError(insertError.message)
        return { error: insertError }
      }

      setProfile(data)
      return { data }
    },
    [session],
  )

  const previewSettings = useCallback((patch) => {
    setProfile((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        settings: parseSettings({ ...parseSettings(prev.settings), ...patch }),
      }
    })
  }, [])

  const updateSettings = useCallback(
    async (patch) => {
      if (!session?.user) {
        const err = new Error('Sessione non valida')
        setError(err.message)
        return { error: err }
      }

      setError(null)
      previewSettings(patch)
      const { data, error: rpcError } = await supabase.rpc(
        'update_player_settings',
        { p_patch: patch },
      )
      if (rpcError) {
        setError(rpcError.message)
        return { error: rpcError }
      }

      const next = parseSettings(data ?? { ...DEFAULT_SETTINGS, ...patch })
      setProfile((prev) => (prev ? { ...prev, settings: next } : prev))
      return { data: next }
    },
    [previewSettings, session],
  )

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      error,
      setError,
      passwordRecovery,
      signUp,
      signIn,
      signOut,
      resetPassword,
      updatePassword,
      createCharacter,
      previewSettings,
      updateSettings,
      refreshProfile: () =>
        session?.user ? fetchProfile(session.user.id) : Promise.resolve(null),
      needsCharacter:
        Boolean(session?.user) &&
        !profile &&
        !loading &&
        !passwordRecovery,
      isAuthenticated: Boolean(session?.user),
    }),
    [
      session,
      profile,
      loading,
      error,
      passwordRecovery,
      signUp,
      signIn,
      signOut,
      resetPassword,
      updatePassword,
      createCharacter,
      previewSettings,
      updateSettings,
      fetchProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth deve essere usato dentro AuthProvider')
  }
  return ctx
}
