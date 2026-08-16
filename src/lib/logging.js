import { supabase } from './supabase'

function asMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  try {
    return JSON.parse(JSON.stringify(meta))
  } catch {
    return {}
  }
}

function isMissingColumnError(error) {
  const code = String(error?.code ?? '')
  const msg = String(error?.message ?? '').toLowerCase()
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find')
  )
}

function logDbError(label, error, extra) {
  console.error(`[writeLog] ${label}`, {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
    ...extra,
  })
}

function insertPayloads({ eventType, message, outcome, nodeId, actorId, targetId, meta }) {
  const packedMeta = { ...asMeta(meta), outcome }
  const base = {
    event_type: String(eventType),
    message: String(message),
    node_id: nodeId || null,
    actor_id: actorId,
    target_id: targetId || null,
  }
  return [
    { ...base, outcome, meta: packedMeta },
    { ...base, meta: packedMeta },
    { ...base, meta: asMeta(meta) },
    base,
  ]
}

/**
 * Scrive un evento nel registro.
 * 1) RPC zt_write_log / write_player_log (SECURITY DEFINER)
 * 2) INSERT diretto, togliendo colonne assenti (outcome/meta) in retry
 */
export async function writeLog({
  eventType,
  message,
  outcome = 'info',
  nodeId = null,
  actorId,
  targetId = null,
  meta = {},
}) {
  try {
    if (!actorId) {
      const err = new Error('actorId richiesto')
      console.error('[writeLog]', err.message)
      return { error: err }
    }
    if (!eventType || !message) {
      const err = new Error('eventType e message richiesti')
      console.error('[writeLog]', err.message, { eventType, message })
      return { error: err }
    }

    const args = {
      p_event_type: String(eventType),
      p_message: String(message),
      p_outcome: String(outcome ?? 'info'),
      p_node_id: nodeId || null,
      p_target_id: targetId || null,
      p_meta: { ...asMeta(meta), outcome: String(outcome ?? 'info') },
    }

    const rpcResult = await callLogRpc(args)
    if (!rpcResult.error) {
      return { data: rpcResult.data ?? { ok: true }, error: null }
    }

    const variants = insertPayloads({
      eventType,
      message,
      outcome: args.p_outcome,
      nodeId: args.p_node_id,
      actorId,
      targetId: args.p_target_id,
      meta,
    })

    let lastError = rpcResult.error
    for (const row of variants) {
      const inserted = await supabase.from('logs').insert(row)
      if (!inserted.error) {
        return { data: { ok: true, via: 'insert' }, error: null }
      }
      lastError = inserted.error
      if (!isMissingColumnError(inserted.error)) {
        logDbError('INSERT failed', inserted.error, { row })
        break
      }
      logDbError('INSERT missing column, retrying without it', inserted.error, {
        keys: Object.keys(row),
      })
    }

    logDbError('all write paths failed', lastError)
    return { data: null, error: lastError }
  } catch (err) {
    console.error('[writeLog] unexpected exception', err)
    return { data: null, error: err }
  }
}

async function callLogRpc(args) {
  const attempts = [
    { fn: 'zt_write_log', body: args },
    { fn: 'write_player_log', body: args },
    {
      fn: 'zt_write_log',
      body: {
        p_event_type: args.p_event_type,
        p_message: args.p_message,
        p_outcome: args.p_outcome,
      },
    },
    {
      fn: 'write_player_log',
      body: {
        p_event_type: args.p_event_type,
        p_message: args.p_message,
        p_outcome: args.p_outcome,
      },
    },
  ]

  let lastError = null

  for (const { fn, body } of attempts) {
    try {
      const { data, error } = await supabase.rpc(fn, body)
      if (!error) {
        return { data: data ?? { ok: true, via: fn }, error: null }
      }
      lastError = error
      logDbError(`RPC ${fn} failed`, error, { params: Object.keys(body) })
    } catch (err) {
      lastError = err
      console.error(`[writeLog] RPC ${fn} threw`, err)
    }
  }

  return { data: null, error: lastError }
}
