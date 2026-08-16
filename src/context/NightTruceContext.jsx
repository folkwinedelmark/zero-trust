import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { isNightTruceActive } from '../lib/nightTruce'

const FALLBACK = { now: 0, active: false, locked: false }

const NightTruceContext = createContext(FALLBACK)

function readTruceState(timestamp) {
  try {
    const now = Number.isFinite(timestamp) ? timestamp : Date.now()
    const active = Boolean(isNightTruceActive(new Date(now)))
    return { now, active, locked: active }
  } catch {
    return { now: Date.now(), active: false, locked: false }
  }
}

export function NightTruceProvider({ children }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const value = useMemo(() => readTruceState(now), [now])

  return (
    <NightTruceContext.Provider value={value}>
      {children}
    </NightTruceContext.Provider>
  )
}

/** Always returns { now, active, locked }. Never throws. */
export function useNightTruce() {
  const ctx = useContext(NightTruceContext)
  if (!ctx || typeof ctx !== 'object') {
    return { now: Date.now(), active: false, locked: false }
  }
  return {
    now: Number(ctx.now) || Date.now(),
    active: Boolean(ctx.active),
    locked: Boolean(ctx.locked ?? ctx.active),
  }
}
