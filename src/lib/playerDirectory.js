import { supabase } from './supabase'
import { HEAT_MAX, isMercFaction, roleById } from './constants'
import { isPlayerOnline } from './presence'

export const DIRECTORY_SELECT = `
  id,
  name,
  role,
  creds,
  reputation,
  heat,
  status,
  travel_until,
  current_node_id,
  last_seen
`

export const DEDUCED_FACTIONS = [
  {
    id: 'UNKNOWN',
    label: '?',
    title: 'Sconosciuta',
    className: 'border-zinc-600 text-zinc-400',
    activeClass: 'border-zinc-400 bg-zinc-700/60 text-zinc-100',
  },
  {
    id: 'CORP',
    label: 'CORP',
    title: 'Security / Corp',
    className: 'border-blue-500/40 text-blue-400',
    activeClass: 'border-blue-400 bg-blue-500/20 text-blue-200',
  },
  {
    id: 'REBEL',
    label: 'REBEL',
    title: 'Hacktivisti',
    className: 'border-red-500/40 text-red-400',
    activeClass: 'border-red-400 bg-red-500/20 text-red-200',
  },
  {
    id: 'MERCENARY',
    label: 'MERC',
    title: 'Consulenti',
    className: 'border-amber-500/40 text-amber-400',
    activeClass: 'border-amber-400 bg-amber-500/20 text-amber-200',
  },
]

export function deducedFactionMeta(id) {
  return DEDUCED_FACTIONS.find((f) => f.id === id) ?? DEDUCED_FACTIONS[0]
}

function factionToDeducedId(faction) {
  if (faction === 'security') return 'CORP'
  if (faction === 'hacktivist') return 'REBEL'
  if (faction === 'consultant') return 'MERCENARY'
  return 'UNKNOWN'
}

/** In directory: la tua fazione è nota; le altre restano deduzioni private. */
export function directoryFactionTag(viewer, player, note) {
  const isSelf = Boolean(viewer?.id && viewer.id === player?.id)
  if (isSelf) {
    return deducedFactionMeta(factionToDeducedId(viewer?.faction))
  }
  return deducedFactionMeta(note?.deduced_faction)
}

export function canSeeDirectoryClass(viewer, player, note) {
  if (!player) return false
  if (viewer?.id && viewer.id === player.id) return true
  return Boolean(note?.class_known)
}

export function directoryClassLabel(viewer, player, note) {
  if (!canSeeDirectoryClass(viewer, player, note)) return null
  return roleById(player.role) ?? null
}

export function directoryCredits(player) {
  return Math.max(0, Math.round(Number(player?.creds) || 0))
}

/**
 * Intel finanziaria asimmetrica:
 * - te stesso / Mercenary: saldo esatto
 * - Executive: indicatore relativo
 * - altri: classificato
 */
export function directoryWealth(viewer, player) {
  const creds = directoryCredits(player)
  const mine = directoryCredits(viewer)
  const isSelf = Boolean(viewer?.id && viewer.id === player?.id)

  if (isSelf || isMercFaction(viewer?.faction)) {
    return {
      kind: 'exact',
      creds,
      label: `${creds} ₵`,
      className: 'font-semibold text-amber-400',
    }
  }

  if (viewer?.role === 'executive') {
    if (creds > mine) {
      return {
        kind: 'above',
        creds,
        label: '📈 Sopra di te',
        className: 'text-amber-400',
      }
    }
    if (creds < mine) {
      return {
        kind: 'below',
        creds,
        label: '📉 Sotto di te',
        className: 'text-emerald-400',
      }
    }
    return {
      kind: 'even',
      creds,
      label: '⚖️ Pari',
      className: 'text-slate-400',
    }
  }

  return {
    kind: 'hidden',
    creds: null,
    label: 'CLASSIFICATO',
    className: 'directory-class-unknown font-mono tracking-[0.2em] text-zinc-600',
  }
}

export function directoryStatus(player, now = Date.now()) {
  if (!isPlayerOnline(player, now)) {
    return {
      id: 'offline',
      label: '[ OFFLINE ]',
      className: 'text-zinc-500',
    }
  }
  const travelUntil = player?.travel_until
    ? new Date(player.travel_until).getTime()
    : 0
  if (player?.status === 'traveling' || travelUntil > now) {
    return { id: 'travel', label: 'In viaggio', className: 'text-fuchsia-300' }
  }
  if (player?.status === 'busy') {
    return { id: 'busy', label: 'Occupato', className: 'text-amber-300' }
  }
  return { id: 'online', label: 'Online', className: 'text-emerald-400' }
}

export function clampHeat(heat) {
  return Math.max(0, Math.min(HEAT_MAX, Math.round(Number(heat) || 0)))
}

export async function fetchDirectoryPlayers() {
  const full = await supabase
    .from('profiles')
    .select(DIRECTORY_SELECT)
    .not('name', 'is', null)
    .order('name', { ascending: true })

  if (
    full.error &&
    /column|schema cache|could not find/i.test(full.error.message ?? '')
  ) {
    return supabase
      .from('profiles')
      .select(
        `
          id,
          name,
          role,
          creds,
          reputation,
          heat,
          status,
          travel_until,
          current_node_id
        `,
      )
      .not('name', 'is', null)
      .order('name', { ascending: true })
  }

  return full
}

export async function fetchOwnPlayerNotes() {
  const full = await supabase
    .from('player_notes')
    .select(
      'id, target_user_id, deduced_faction, custom_note, class_known, updated_at',
    )
  if (
    full.error &&
    /column|schema cache|could not find/i.test(full.error.message ?? '')
  ) {
    return supabase
      .from('player_notes')
      .select('id, target_user_id, deduced_faction, custom_note, updated_at')
  }
  return full
}

export async function upsertPlayerNote({
  targetId,
  deducedFaction = 'UNKNOWN',
  customNote = '',
}) {
  return supabase.rpc('upsert_player_note', {
    p_target_id: targetId,
    p_deduced_faction: deducedFaction,
    p_custom_note: customNote || null,
  })
}
