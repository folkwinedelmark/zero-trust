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

const BgmMatchContext = createContext({
  inMatch: false,
  setInMatch: () => {},
})

function getGlobalBgm() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null
  }

  if (window.__globalBGM && typeof window.__globalBGM.play === 'function') {
    return window.__globalBGM
  }

  let el = document.getElementById('zt-bgm')
  if (!el) {
    el = document.createElement('audio')
    el.id = 'zt-bgm'
    document.body.appendChild(el)
  }

  el.loop = true
  el.preload = 'auto'
  if (!el.getAttribute('src')) el.src = BGM_SRC

  window.__globalBGM = el
  window.__ZT_BGM_AUDIO__ = el
  return el
}

function pauseBgm(audio) {
  if (typeof window !== 'undefined') window.__globalBGMPlayLock = false
  if (!audio) return
  audio.pause()
}

/**
 * Chrome/Vercel: due play() a pochi ms (effect + click) mentre paused
 * è ancora true avviano due decoder sulla stessa traccia.
 */
function tryPlay(audio) {
  if (!audio || typeof window === 'undefined') return
  if (window.__globalBGMPlayLock) return
  if (!audio.paused && !audio.ended) return

  window.__globalBGMPlayLock = true
  void audio
    .play()
    .then(() => {
      window.__globalBGMPlayLock = true
    })
    .catch(() => {
      window.__globalBGMPlayLock = false
    })
}

function bindUnlockOnce() {
  if (typeof window === 'undefined' || window.__globalBGMUnlockBound) return
  window.__globalBGMUnlockBound = true
  window.addEventListener(
    'pointerdown',
    () => {
      if (!window.__globalBGMShouldPlay) return
      tryPlay(getGlobalBgm())
    },
    { passive: true },
  )
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
 * Motore BGM — una sola volta da App.
 * Unico elemento: #zt-bgm / window.__globalBGM. Mai new Audio().
 */
export function useBGM() {
  const { profile } = useAuth()
  const { inMatch } = useContext(BgmMatchContext)
  const settings = parseSettings(profile?.settings)
  const shouldPlay = Boolean(inMatch && settings.music_enabled)

  useEffect(() => {
    const audio = getGlobalBgm()
    if (!audio) return undefined

    bindUnlockOnce()
    window.__globalBGMShouldPlay = shouldPlay
    audio.loop = true
    audio.volume = settings.music_volume

    if (shouldPlay) tryPlay(audio)
    else pauseBgm(audio)

    return undefined
  }, [shouldPlay, settings.music_volume])
}
