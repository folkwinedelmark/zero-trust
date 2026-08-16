import { useEffect } from 'react'
import { clearPresence, heartbeatPresence } from '../lib/presence'

const HEARTBEAT_MS = 45_000

/** Mantiene last_seen aggiornato mentre la sessione è aperta. */
export function usePresenceHeartbeat(userId) {
  useEffect(() => {
    if (!userId) return undefined

    void heartbeatPresence(userId)
    const id = setInterval(() => {
      void heartbeatPresence(userId)
    }, HEARTBEAT_MS)

    function onPageHide() {
      void clearPresence(userId)
    }

    window.addEventListener('pagehide', onPageHide)
    return () => {
      clearInterval(id)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [userId])
}
