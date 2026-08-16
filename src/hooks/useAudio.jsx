import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { parseSettings } from '../lib/settings'

export const SOUND_FILES = {
  click: '/click.wav',
  success: '/success.wav',
  error: '/error.wav',
  fail: '/fail.wav',
  logout: '/logout.wav',
  travel: '/travel.mp3',
  working: '/working.wav',
  interference: '/interference.wav',
}

const SFX_VOLUME = 0.45

export const CORE_ACTION_TYPES = new Set([
  'attack',
  'defend',
  'farm',
  'extract',
])

export const HOSTILE_ACTION_TYPES = new Set([
  'trace',
  'kick',
  'deep_scan',
])

function createManagedAudio(src, { loop = false } = {}) {
  let instance = null
  return {
    get() {
      if (typeof Audio === 'undefined') return null
      if (!instance) {
        instance = new Audio(src)
        instance.preload = 'auto'
        instance.loop = loop
        instance.volume = SFX_VOLUME
      }
      return instance
    },
    play() {
      const audio = this.get()
      if (!audio) return
      try {
        audio.loop = loop
        audio.volume = SFX_VOLUME
        audio.currentTime = 0
        void audio.play().catch(() => {})
      } catch {
        // File mancante o autoplay bloccato
      }
    },
    stop() {
      const audio = this.get()
      if (!audio) return
      audio.pause()
      audio.currentTime = 0
    },
  }
}

const travelSfx = createManagedAudio(SOUND_FILES.travel)
const workingSfx = createManagedAudio(SOUND_FILES.working, { loop: true })
const interferenceSfx = createManagedAudio(SOUND_FILES.interference, {
  loop: true,
})

function playFile(src) {
  try {
    const audio = new Audio(src)
    audio.volume = SFX_VOLUME
    void audio.play().catch(() => {})
  } catch {
    // File mancante o autoplay bloccato dal browser
  }
}

function stopAllLoops() {
  travelSfx.stop()
  workingSfx.stop()
  interferenceSfx.stop()
}

/**
 * SFX. ui_sound = click/success/fail/logout; sfx_sound = travel/hacking/trace.
 */
export function useAudio() {
  const { profile } = useAuth()
  const settings = parseSettings(profile?.settings)
  const uiEnabled = settings.ui_sound !== false
  const sfxEnabled = settings.sfx_sound !== false
  const travelAudioRef = useRef(null)
  const workingAudioRef = useRef(null)
  const interferenceAudioRef = useRef(null)
  if (!travelAudioRef.current) travelAudioRef.current = travelSfx.get()
  if (!workingAudioRef.current) workingAudioRef.current = workingSfx.get()
  if (!interferenceAudioRef.current) {
    interferenceAudioRef.current = interferenceSfx.get()
  }

  useEffect(() => {
    const working = workingAudioRef.current
    const interference = interferenceAudioRef.current
    if (working) working.loop = true
    if (interference) interference.loop = true
  }, [])

  useEffect(() => {
    if (!sfxEnabled) stopAllLoops()
  }, [sfxEnabled])

  const playUi = useCallback(
    (src, { force = false } = {}) => {
      if (!force && !uiEnabled) return
      playFile(src)
    },
    [uiEnabled],
  )

  const playClick = useCallback(
    (opts) => playUi(SOUND_FILES.click, opts),
    [playUi],
  )
  const playSuccess = useCallback(
    (opts) => playUi(SOUND_FILES.success, opts),
    [playUi],
  )
  const playError = useCallback(
    (opts) => playUi(SOUND_FILES.error, opts),
    [playUi],
  )
  const playFail = useCallback(
    (opts) => playUi(SOUND_FILES.fail, opts),
    [playUi],
  )
  const playLogout = useCallback(
    (opts) => playUi(SOUND_FILES.logout, opts),
    [playUi],
  )

  const playTravel = useCallback(
    ({ force = false } = {}) => {
      if (!force && !sfxEnabled) return
      travelSfx.play()
    },
    [sfxEnabled],
  )

  const stopTravel = useCallback(() => {
    travelSfx.stop()
  }, [])

  const playWorking = useCallback(
    ({ force = false } = {}) => {
      if (!force && !sfxEnabled) return
      interferenceSfx.stop()
      workingSfx.play()
    },
    [sfxEnabled],
  )

  const stopWorking = useCallback(() => {
    workingSfx.stop()
  }, [])

  const playInterference = useCallback(
    ({ force = false } = {}) => {
      if (!force && !sfxEnabled) return
      workingSfx.stop()
      interferenceSfx.play()
    },
    [sfxEnabled],
  )

  const stopInterference = useCallback(() => {
    interferenceSfx.stop()
  }, [])

  const stopActionLoops = useCallback(() => {
    workingSfx.stop()
    interferenceSfx.stop()
  }, [])

  return useMemo(
    () => ({
      uiEnabled,
      sfxEnabled,
      playClick,
      playSuccess,
      playError,
      playFail,
      playLogout,
      playTravel,
      stopTravel,
      playWorking,
      stopWorking,
      playInterference,
      stopInterference,
      stopActionLoops,
    }),
    [
      uiEnabled,
      sfxEnabled,
      playClick,
      playSuccess,
      playError,
      playFail,
      playLogout,
      playTravel,
      stopTravel,
      playWorking,
      stopWorking,
      playInterference,
      stopInterference,
      stopActionLoops,
    ],
  )
}
