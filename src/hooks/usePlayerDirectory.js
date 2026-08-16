import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fetchDirectoryPlayers, fetchOwnPlayerNotes, upsertPlayerNote } from '../lib/playerDirectory'
import { isPlayerOnline } from '../lib/presence'

function notesByTarget(rows) {
  const map = {}
  for (const row of rows ?? []) {
    if (row?.target_user_id) map[row.target_user_id] = row
  }
  return map
}

export function usePlayerDirectory(open) {
  const { profile } = useAuth()
  const [players, setPlayers] = useState([])
  const [notes, setNotes] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [presenceNow, setPresenceNow] = useState(Date.now())

  const load = useCallback(async () => {
    if (!profile?.id) return
    setError(null)
    const [playersRes, notesRes] = await Promise.all([
      fetchDirectoryPlayers(),
      fetchOwnPlayerNotes(),
    ])
    if (playersRes.error) {
      setError(playersRes.error.message)
      return
    }
    if (notesRes.error) {
      setError(notesRes.error.message)
    }
    setPlayers(playersRes.data ?? [])
    setNotes(notesByTarget(notesRes.data))
  }, [profile?.id])

  useEffect(() => {
    if (!open) return undefined
    setLoading(true)
    load().finally(() => setLoading(false))

    const channel = supabase
      .channel('player-directory')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          void load()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'player_notes' },
        (payload) => {
          const row = payload.new
          if (row?.owner_id && row.owner_id !== profile?.id) return
          void load()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [open, load, profile?.id])

  useEffect(() => {
    if (!open) return undefined
    const id = setInterval(() => setPresenceNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [open])

  const saveNote = useCallback(
    async (targetId, { deducedFaction, customNote }) => {
      if (!targetId) return { error: new Error('Bersaglio richiesto') }
      const current = notes[targetId] ?? {}
      const nextFaction = deducedFaction ?? current.deduced_faction ?? 'UNKNOWN'
      const nextNote =
        customNote === undefined ? (current.custom_note ?? '') : customNote
      setSavingId(targetId)
      const { data, error: saveError } = await upsertPlayerNote({
        targetId,
        deducedFaction: nextFaction,
        customNote: nextNote,
      })
      setSavingId(null)
      if (saveError) {
        setError(saveError.message)
        return { error: saveError }
      }
      setNotes((prev) => ({
        ...prev,
        [targetId]: {
          ...current,
          target_user_id: targetId,
          deduced_faction: nextFaction,
          custom_note: nextNote || null,
          class_known: Boolean(data?.class_known ?? current.class_known),
        },
      }))
      return { data, error: null }
    },
    [notes],
  )

  const sorted = useMemo(() => {
    const mine = players.filter((p) => p.id === profile?.id)
    const others = players.filter((p) => p.id !== profile?.id)
    const online = others.filter((p) => isPlayerOnline(p, presenceNow))
    const offline = others.filter((p) => !isPlayerOnline(p, presenceNow))
    return [...mine, ...online, ...offline]
  }, [players, profile?.id, presenceNow])

  return {
    players: sorted,
    notes,
    loading,
    error,
    savingId,
    reload: load,
    saveNote,
  }
}
