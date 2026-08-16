import { actionLabel } from './logFormat'

const ACTION_ICON_THEME = {
  attack: {
    src: '/attack.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(239,68,68,0.8)]',
    labelClass: 'text-red-300',
    barClass: 'bg-red-400',
  },
  defend: {
    src: '/defend.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(34,211,238,0.8)]',
    labelClass: 'text-cyan-300',
    barClass: 'bg-cyan-400',
  },
  farm: {
    src: '/farm.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(251,191,36,0.8)]',
    labelClass: 'text-amber-300',
    barClass: 'bg-amber-400',
  },
  extract: {
    src: '/extract.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(192,132,252,0.85)]',
    labelClass: 'text-fuchsia-300',
    barClass: 'bg-fuchsia-400',
  },
  trace: {
    src: '/trace.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(251,146,60,0.85)]',
    labelClass: 'text-orange-300',
    barClass: 'bg-orange-400',
  },
  kick: {
    src: '/kick.png',
    glowClass: 'drop-shadow-[0_0_5px_rgba(239,68,68,0.8)]',
    labelClass: 'text-red-300',
    barClass: 'bg-red-400',
  },
}

export function getActionIcon(actionType) {
  const key = String(actionType || '').toLowerCase()
  const theme = ACTION_ICON_THEME[key]
  if (!theme) return null
  const label = actionLabel(key)
  return {
    ...theme,
    id: key,
    alt: label,
    label,
  }
}
