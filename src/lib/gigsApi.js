import { supabase } from './supabase'

export async function gigCreate({
  targetAction,
  targetEntityId,
  reward,
  timeLimitSeconds,
}) {
  return supabase.rpc('gig_create', {
    p_target_action: targetAction,
    p_target_entity_id: targetEntityId,
    p_reward: reward,
    p_time_limit_seconds: timeLimitSeconds,
  })
}

export async function gigAccept(gigId) {
  return supabase.rpc('gig_accept', { p_gig_id: gigId })
}

export async function gigComplete(gigId) {
  return supabase.rpc('gig_complete', { p_gig_id: gigId })
}

export async function gigAbort(gigId) {
  return supabase.rpc('gig_abort', { p_gig_id: gigId })
}

export async function gigSweepExpired() {
  return supabase.rpc('gig_sweep_expired')
}

export async function gigAutoResolve() {
  return supabase.rpc('gig_auto_resolve')
}

const GIG_SELECT = `
  id,
  created_at,
  creator_id,
  executor_id,
  description,
  reward,
  paid_amount,
  status,
  fail_reason,
  time_limit_seconds,
  deadline,
  target_action,
  target_entity_id,
  accepted_at,
  creator:profiles!creator_id(id, name, reputation, role),
  executor:profiles!executor_id(id, name, reputation, role)
`

export async function fetchGigs() {
  return supabase
    .from('gigs')
    .select(GIG_SELECT)
    .order('created_at', { ascending: false })
}
