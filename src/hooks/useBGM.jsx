import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { parseSettings } from '../lib/settings'

const BGM_SRC = '/cyberpunktheme.mp3'

let bgmSingleton = null

function getBgm() {
  if (typeof Audio === 'undefined') return null
  if (!bgmSingleton) {
    bgmSingleton = new Audio(BGM_SRC)
    bgmSingleton.loop = true
    bgmSingleton.preload = 'auto'
  }
  return bgmSingleton
}

function tryPlay(audio) {
  if (!audio) return
  void audio.play().catch(() => {
    /* autoplay bloccato finché non c’è un gesto utente */
  })
}

/**
 * BGM in loop solo in partita attiva (network map), se music_enabled.
 * Non parte su login, lobby, briefing o schermata di fine ciclo.
 */
export function useBGM({ inMatch = false } = {}) {
  const { profile } = useAuth()
  const settings = parseSettings(profile?.settings)
  const shouldPlay = Boolean(inMatch && settings.music_enabled)
  const shouldPlayRef = useRef(shouldPlay)
  shouldPlayRef.current = shouldPlay

  useEffect(() => {
    const audio = getBgm()
    if (!audio) return
    audio.volume = settings.music_volume
  }, [settings.music_volume])

  useEffect(() => {
    const audio = getBgm()
    if (!audio) return
    if (shouldPlay) tryPlay(audio)
    else {
      audio.pause()
      audio.currentTime = 0
    }
  }, [shouldPlay])

  useEffect(() => {
    if (!shouldPlay) return undefined
    const audio = getBgm()
    if (!audio) return undefined

    const unlock = () => {
      if (shouldPlayRef.current) tryPlay(audio)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }

    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [shouldPlay])

  useEffect(() => {
    return () => {
      const audio = getBgm()
      if (!audio) return
      audio.pause()
      audio.currentTime = 0
    }
  }, [])
}
