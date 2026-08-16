import { useEffect, useMemo, useState } from 'react'
import { actionProgress, formatRemaining } from '../lib/actions'

/**
 * Rileva Trace/Kick in corso contro lo slot attivo del giocatore
 * (slots.target_slot_id === activeSlot.id via Realtime map).
 */
export function useIncomingThreats({ activeSlot, slots }) {
  const [now, setNow] = useState(Date.now())

  const threats = useMemo(() => {
    if (!activeSlot?.id) return []
    return (slots ?? [])
      .filter(
        (s) =>
          s.id !== activeSlot.id &&
          s.user_id &&
          s.user_id !== activeSlot.user_id &&
          s.target_slot_id === activeSlot.id &&
          (s.action_type === 'trace' || s.action_type === 'kick') &&
          s.end_time,
      )
      .map((s) => {
        const prog = actionProgress(s, now)
        return {
          id: s.id,
          type: s.action_type,
          slotLabel: s.slot_id,
          endTime: s.end_time,
          remainingMs: prog.remainingMs,
          progress: prog.progress,
        }
      })
      .sort((a, b) => a.remainingMs - b.remainingMs)
  }, [activeSlot?.id, slots, now])

  useEffect(() => {
    if (threats.length === 0) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [threats.length])

  const primary = threats[0] ?? null

  return {
    threats,
    primary,
    hasThreat: threats.length > 0,
    formatRemaining,
  }
}
