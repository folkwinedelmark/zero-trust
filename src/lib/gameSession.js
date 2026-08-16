import { supabase } from './supabase'
import { GAME_STATES } from './constants'

export async function fetchGameSettings() {
  const full = await supabase
    .from('game_settings')
    .select(
      'id, game_state, started_at, updated_at, scheduled_start_time, match_duration_days, winning_faction, winning_mercenary_id, match_result',
    )
    .eq('id', 1)
    .maybeSingle()

  if (
    full.error &&
    /column|schema cache|could not find/i.test(full.error.message ?? '')
  ) {
    return supabase
      .from('game_settings')
      .select('id, game_state, started_at, updated_at')
      .eq('id', 1)
      .maybeSingle()
  }

  return full
}

export async function fetchLobbyPlayers() {
  const full = await supabase
    .from('profiles')
    .select('id, name, faction, role, is_ready, is_admin, created_at, last_seen')
    .order('created_at', { ascending: true })

  if (
    full.error &&
    /column|schema cache|could not find/i.test(full.error.message ?? '')
  ) {
    return supabase
      .from('profiles')
      .select('id, name, faction, role, is_ready, is_admin, created_at')
      .order('created_at', { ascending: true })
  }

  return full
}

export async function toggleReady(userId, isReady) {
  return supabase
    .from('profiles')
    .update({ is_ready: isReady })
    .eq('id', userId)
    .select('id, is_ready')
    .maybeSingle()
}

export async function claimLobbyHost() {
  return supabase.rpc('claim_lobby_host')
}

export async function startGame(allowSolo = false) {
  return supabase.rpc('start_game', { p_allow_solo: allowSolo })
}

export async function scheduleGame({
  startTime,
  durationDays = 7,
  allowSolo = false,
}) {
  return supabase.rpc('schedule_game', {
    p_start_time: startTime,
    p_duration_days: durationDays,
    p_allow_solo: allowSolo,
  })
}

export async function activateScheduledMatch(force = false) {
  return supabase.rpc('activate_scheduled_match', { p_force: force })
}

export async function markBriefingSeen() {
  return supabase.rpc('mark_briefing_seen')
}

export async function concludeMatch() {
  return supabase.rpc('conclude_match')
}

function rankMercs(rows) {
  return [...(rows ?? [])]
    .sort(
      (a, b) =>
        (Number(b.creds) || 0) - (Number(a.creds) || 0) ||
        String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
    .map((row, index) => ({
      id: row.id,
      name: row.name,
      creds: Number(row.creds) || 0,
      rank: index + 1,
    }))
}

/** Snapshot locale per preview End Game se l'RPC conclude_match non è disponibile. */
export async function snapshotMatchResult() {
  const empty = {
    ok: true,
    local: true,
    corp_score: 0,
    rebel_score: 0,
    winning_faction: null,
    draw: true,
    winning_mercenary_id: null,
    mercs: [],
    concluded_at: new Date().toISOString(),
  }

  try {
    const [scoresRes, mercsRes] = await Promise.all([
      supabase.from('faction_scores').select('faction, score'),
      supabase
        .from('profiles')
        .select('id, name, creds')
        .eq('faction', 'consultant'),
    ])
    const scores = scoresRes.data ?? []
    const corp = Number(
      scores.find((row) => row.faction === 'security')?.score ?? 0,
    )
    const rebel = Number(
      scores.find((row) => row.faction === 'hacktivist')?.score ?? 0,
    )
    let winning_faction = null
    let draw = false
    if (corp > rebel) winning_faction = 'security'
    else if (rebel > corp) winning_faction = 'hacktivist'
    else draw = true

    const mercs = rankMercs(mercsRes.data)
    return {
      ...empty,
      corp_score: corp,
      rebel_score: rebel,
      winning_faction,
      draw,
      winning_mercenary_id: mercs[0]?.id ?? null,
      mercs,
    }
  } catch {
    return empty
  }
}

export function matchSettingsFromResult(result, { local = false } = {}) {
  return {
    game_state: GAME_STATES.COMPLETED,
    winning_faction: result?.winning_faction ?? null,
    winning_mercenary_id: result?.winning_mercenary_id ?? null,
    match_result: result ?? { ok: true, local },
  }
}

export async function resetLobby() {
  return supabase.rpc('reset_lobby')
}

export async function resetTotal() {
  return supabase.rpc('reset_total')
}

export async function selectClass(role) {
  return supabase.rpc('select_class', { p_role: role })
}
