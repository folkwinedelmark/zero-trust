import { useEffect, useRef, useState } from 'react'
import { Bell, Loader2, Music, Radio, Settings, Volume2, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAudio } from '../hooks/useAudio'
import {
  clampMusicVolume,
  parseSettings,
  requestPushPermission,
} from '../lib/settings'
import {
  disablePushSubscription,
  enablePushSubscription,
} from '../lib/push'

const VOLUME_SAVE_MS = 400

export default function SettingsModal({ open, onClose }) {
  const { profile, previewSettings, updateSettings } = useAuth()
  const { playClick } = useAudio()
  const settings = parseSettings(profile?.settings)
  const [error, setError] = useState(null)
  const [isProcessingPush, setIsProcessingPush] = useState(false)
  const [volume, setVolume] = useState(settings.music_volume)
  const volumeTimer = useRef(null)

  useEffect(() => {
    setVolume(settings.music_volume)
  }, [settings.music_volume])

  useEffect(() => {
    return () => {
      if (volumeTimer.current) clearTimeout(volumeTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  if (!open) return null

  function close() {
    if (isProcessingPush) return
    playClick()
    onClose()
  }

  async function patchSetting(key, next, { chime = false } = {}) {
    const { error: updateError } = await updateSettings({ [key]: next })
    if (updateError) {
      setError(updateError.message ?? 'Salvataggio fallito')
      return false
    }
    if (chime) playClick({ force: true })
    return true
  }

  async function togglePush() {
    if (isProcessingPush) return
    playClick()
    const next = !settings.push_notifications
    setIsProcessingPush(true)
    setError(null)
    try {
      if (next) {
        const permission = await requestPushPermission()
        if (!permission.ok) {
          setError(permission.error)
          return
        }
        const { error: subError } = await enablePushSubscription()
        if (subError) {
          setError(subError.message ?? 'Iscrizione push fallita')
          return
        }
      } else {
        const { error: unsubError } = await disablePushSubscription()
        if (unsubError) {
          setError(unsubError.message ?? 'Disiscrizione push fallita')
          return
        }
      }
      await patchSetting('push_notifications', next)
    } catch (err) {
      setError(err?.message ?? 'Notifiche push non disponibili')
    } finally {
      setIsProcessingPush(false)
    }
  }

  function toggleUiSound() {
    const next = !settings.ui_sound
    if (settings.ui_sound) playClick()
    void patchSetting('ui_sound', next, { chime: next })
  }

  function toggleSfxSound() {
    playClick()
    void patchSetting('sfx_sound', !settings.sfx_sound)
  }

  function toggleMusic() {
    playClick()
    void patchSetting('music_enabled', !settings.music_enabled)
  }

  function handleVolume(raw) {
    const next = clampMusicVolume(raw)
    setVolume(next)
    previewSettings({ music_volume: next })
    if (volumeTimer.current) clearTimeout(volumeTimer.current)
    volumeTimer.current = setTimeout(() => {
      void patchSetting('music_volume', next)
    }, VOLUME_SAVE_MS)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex h-[100dvh] max-h-[100dvh] items-center justify-center overflow-hidden bg-black/80 p-4"
      onClick={close}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="text-left">
            <p className="font-display text-xs uppercase tracking-[0.35em] text-cyan-400/80">
              Client
            </p>
            <h2 className="font-display mt-1 flex items-center gap-2 text-xl text-zinc-100">
              <Settings className="h-4 w-4 text-zinc-400" />
              Impostazioni
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={isProcessingPush}
            className="inline-flex items-center gap-1.5 border border-zinc-600 px-2.5 py-1.5 text-xs uppercase tracking-wider text-zinc-300 hover:border-zinc-400 hover:text-zinc-100 disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
            Chiudi
          </button>
        </div>

        <div className="space-y-3">
          <SettingRow
            icon={Bell}
            iconClass="text-cyan-400"
            title="Notifiche Push"
            description="Avvisi su intrusioni e operazioni ostili. Richiede il permesso del browser."
            checked={settings.push_notifications}
            disabled={isProcessingPush}
            processing={isProcessingPush}
            onToggle={togglePush}
          />
          <SettingRow
            icon={Volume2}
            iconClass="text-amber-300"
            title="Suoni Interfaccia"
            description="Click e notifiche."
            checked={settings.ui_sound}
            disabled={isProcessingPush}
            onToggle={toggleUiSound}
          />
          <SettingRow
            icon={Radio}
            iconClass="text-cyan-300"
            title="Suoni Operazioni"
            description="Travel, Hacking, Trace."
            checked={settings.sfx_sound}
            disabled={isProcessingPush}
            onToggle={toggleSfxSound}
          />

          <section className="border border-zinc-800 bg-zinc-950/60 p-4">
            <p className="mb-3 font-display text-[10px] uppercase tracking-[0.28em] text-fuchsia-400/80">
              Colonna Sonora
            </p>
            <SettingRow
              icon={Music}
              iconClass="text-fuchsia-300"
              title="Musica di Sottofondo"
              description="Loop cyberpunk. Parte al primo click (blocco autoplay del browser)."
              checked={settings.music_enabled}
              disabled={isProcessingPush}
              onToggle={toggleMusic}
              bare
            />
            <div className="mt-4 text-left">
              <label
                htmlFor="music-volume"
                className="flex items-center justify-between text-sm text-zinc-200"
              >
                <span>Volume Musica</span>
                <span className="tabular-nums text-zinc-500">
                  {Math.round(volume * 100)}%
                </span>
              </label>
              <input
                id="music-volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                disabled={isProcessingPush || !settings.music_enabled}
                onChange={(e) => handleVolume(e.target.value)}
                className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-fuchsia-400 disabled:opacity-40"
              />
            </div>
          </section>
        </div>

        <div className="mt-3 min-h-10">
          {error ? (
            <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SettingRow({
  icon: Icon,
  iconClass,
  title,
  description,
  checked,
  disabled,
  processing = false,
  onToggle,
  bare = false,
}) {
  const body = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 text-left">
        <p className="inline-flex items-center gap-1.5 text-base text-zinc-100">
          <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
          {title}
        </p>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-busy={processing}
        disabled={disabled}
        onClick={onToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-cyan-500' : 'bg-zinc-700'
        } disabled:opacity-40`}
      >
        {processing ? (
          <Loader2 className="absolute inset-0 m-auto h-4 w-4 animate-spin text-zinc-100" />
        ) : (
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-zinc-100 transition-[left]"
            style={{
              left: checked ? '1.375rem' : '0.125rem',
            }}
          />
        )}
      </button>
    </div>
  )

  if (bare) return body
  return <div className="border border-zinc-800 bg-zinc-950/60 p-4">{body}</div>
}
