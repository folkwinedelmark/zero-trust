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

function stopStray(audio) {
  if (!audio || typeof audio.pause !== 'function') return
  try {
    audio.pause()
    audio.loop = false
    audio.removeAttribute?.('src')
    audio.src = ''
    audio.load?.()
  } catch {
    /* ignore */
  }
}

/**
 * Una sola istanza Audio per tutta la pagina.
 * Adotta eventuali handle legacy e spegne i duplicati.
 */
function getGlobalBgm() {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null

  const adopted =
    window.__globalBGM instanceof Audio
      ? window.__globalBGM
      : window.__ZT_BGM_AUDIO__ instanceof Audio
        ? window.__ZT_BGM_AUDIO__
        : null

  if (adopted) {
    if (
      window.__ZT_BGM_AUDIO__ instanceof Audio &&
      window.__ZT_BGM_AUDIO__ !== adopted
    ) {
      stopStray(window.__ZT_BGM_AUDIO__)
    }
    window.__globalBGM = adopted
    window.__ZT_BGM_AUDIO__ = adopted
    adopted.loop = true
    return adopted
  }

  const audio = new Audio(BGM_SRC)
  audio.loop = true
  audio.preload = 'auto'
  window.__globalBGM = audio
  window.__ZT_BGM_AUDIO__ = audio
  return audio
}

function tryPlay(audio) {
  if (!audio) return
  if (!audio.paused && !audio.ended) return
  void audio.play().catch(() => {
    /* autoplay bloccato finché non c’è un gesto utente */
  })
}

function bindUnlockOnce() {
  if (typeof window === 'undefined' || window.__globalBGMUnlockBound) return
  window.__globalBGMUnlockBound = true
  const unlock = () => {
    const audio = getGlobalBgm()
    if (!audio || !window.__globalBGMShouldPlay) return
    tryPlay(audio)
  }
  window.addEventListener('click', unlock)
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
 * Motore BGM — una sola volta da App.
 * L'elemento Audio vive su window.__globalBGM e non viene mai ricreato.
 */
export function useBGM() {
  const { profile } = useAuth()
  const { inMatch } = useContext(BgmMatchContext)
  const settings = parseSettings(profile?.settings)
  const musicEnabled = settings.music_enabled !== false
  const musicVolume = settings.music_volume
  const shouldPlay = Boolean(inMatch && musicEnabled)

  useEffect(() => {
    const audio = getGlobalBgm()
    if (!audio) return undefined

    bindUnlockOnce()
    window.__globalBGMShouldPlay = shouldPlay
    audio.loop = true
    audio.volume = musicVolume

    if (shouldPlay) tryPlay(audio)
    else audio.pause()

    return undefined
  }, [shouldPlay, musicVolume])
}
