import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useAuth } from '../context/AuthContext'
import { parseSettings } from '../lib/settings'

const BGM_SRC = '/cyberpunktheme.mp3'
const BGM_WINDOW_KEY = '__ZT_BGM_AUDIO__'

const BgmMatchContext = createContext({
  inMatch: false,
  setInMatch: () => {},
})

function getBgm() {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
  const existing = window[BGM_WINDOW_KEY]
  if (existing) return existing

  const audio = new Audio(BGM_SRC)
  audio.loop = true
  audio.preload = 'auto'
  audio.setAttribute('data-zt-bgm', '1')
  window[BGM_WINDOW_KEY] = audio
  return audio
}

function isPlaying(audio) {
  return Boolean(audio && !audio.paused && !audio.ended)
}

function tryPlay(audio) {
  if (!audio || isPlaying(audio)) return
  void audio.play().catch(() => {
    /* autoplay bloccato finché non c’è un gesto utente */
  })
}

function stopBgm(audio) {
  if (!audio) return
  audio.pause()
  audio.currentTime = 0
}

let unlockBound = false
let shouldPlayNow = false

function bindUnlockOnce() {
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true
  const unlock = () => {
    if (!shouldPlayNow) return
    tryPlay(getBgm())
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

export function BgmProvider({ children }) {
  const [inMatch, setInMatch] = useState(false)
  const value = useMemo(() => ({ inMatch, setInMatch }), [inMatch])
  return (
    <BgmMatchContext.Provider value={value}>{children}</BgmMatchContext.Provider>
  )
}

/** Solo GameShell: abilita il BGM mentre la network map è montata. */
export function useBgmMatch(inMatch) {
  const { setInMatch } = useContext(BgmMatchContext)
  useEffect(() => {
    setInMatch(Boolean(inMatch))
    return () => setInMatch(false)
  }, [inMatch, setInMatch])
}

/**
 * Motore BGM: chiamare una sola volta da App.
 * Non crea un secondo Audio anche se il componente fa re-render.
 */
export function useBGM() {
  const { profile } = useAuth()
  const { inMatch } = useContext(BgmMatchContext)
  const settings = parseSettings(profile?.settings)
  const shouldPlay = Boolean(inMatch && settings.music_enabled)
  shouldPlayNow = shouldPlay

  useEffect(() => {
    bindUnlockOnce()
    const audio = getBgm()
    if (!audio) return
    audio.volume = settings.music_volume
  }, [settings.music_volume])

  useEffect(() => {
    const audio = getBgm()
    if (!audio) return
    if (shouldPlay) tryPlay(audio)
    else stopBgm(audio)
  }, [shouldPlay])
}
