import { useEffect, useRef, useState } from 'react'
import { abortTravel, completeTravel, isTraveling, travelRemainingMs } from '../lib/travel'
import { useAudio } from './useAudio'

export function useTravel({ profile, refreshProfile, onArrived }) {
  const { playTravel, stopTravel, playSuccess, playFail } = useAudio()
  const [now, setNow] = useState(Date.now())
  const completingRef = useRef(false)
  const onArrivedRef = useRef(onArrived)
  onArrivedRef.current = onArrived

  const traveling = isTraveling(profile)
  const remainingMs = traveling ? travelRemainingMs(profile, now) : 0
  const playTravelRef = useRef(playTravel)
  const stopTravelRef = useRef(stopTravel)
  playTravelRef.current = playTravel
  stopTravelRef.current = stopTravel

  useEffect(() => {
    if (traveling) playTravelRef.current()
    else stopTravelRef.current()
    return () => {
      stopTravelRef.current()
    }
  }, [traveling])

  useEffect(() => {
    if (!traveling) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [traveling, profile?.travel_until])

  useEffect(() => {
    if (!profile || !traveling || remainingMs > 0 || completingRef.current) return
    completingRef.current = true
    ;(async () => {
      try {
        const { intent } = await completeTravel({ profile })
        stopTravel()
        playSuccess()
        await refreshProfile()
        if (intent?.nodeId) onArrivedRef.current?.(intent.nodeId)
      } catch (err) {
        console.error('[useTravel]', err)
        stopTravel()
        playFail()
        await refreshProfile()
      } finally {
        completingRef.current = false
      }
    })()
  }, [profile, traveling, remainingMs, refreshProfile, stopTravel, playSuccess, playFail])

  async function cancelTravel() {
    if (!profile || !traveling) return
    stopTravel()
    playFail()
    await abortTravel(profile)
    await refreshProfile()
  }

  return {
    traveling,
    remainingMs,
    intent: profile?.travel_intent ?? null,
    cancelTravel,
  }
}
