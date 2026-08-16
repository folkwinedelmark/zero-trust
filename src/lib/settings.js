export const DEFAULT_SETTINGS = {
  push_notifications: false,
  ui_sound: true,
  sfx_sound: true,
  music_enabled: true,
  music_volume: 0.5,
}

export function clampMusicVolume(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.music_volume
  return Math.min(1, Math.max(0, n))
}

function boolOrLegacy(src, key) {
  if (src[key] !== undefined) return src[key] !== false
  return src.sound !== false
}

export function parseSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const { sound: _legacySound, ...rest } = src
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    push_notifications: Boolean(src.push_notifications),
    ui_sound: boolOrLegacy(src, 'ui_sound'),
    sfx_sound: boolOrLegacy(src, 'sfx_sound'),
    music_enabled: src.music_enabled !== false,
    music_volume: clampMusicVolume(
      src.music_volume ?? DEFAULT_SETTINGS.music_volume,
    ),
  }
}

/** Chiede il permesso browser per le notifiche. Non salva le settings. */
export async function requestPushPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      ok: false,
      error: 'Notifiche non supportate da questo browser.',
    }
  }

  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }

  if (permission !== 'granted') {
    return {
      ok: false,
      error:
        'Permesso notifiche negato. Abilitalo dalle impostazioni del browser.',
    }
  }

  return { ok: true, permission }
}
