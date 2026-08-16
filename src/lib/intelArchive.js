import { supabase } from './supabase'

export async function saveIntelReport({
  abilityId,
  targetType,
  targetName,
  reportData = [],
  targetId = null,
  nodeId = null,
  slot = null,
}) {
  return supabase.rpc('zt_save_intel_report', {
    p_ability_id: abilityId,
    p_target_type: targetType,
    p_target_name: targetName,
    p_report_data: reportData,
    p_target_id: targetId,
    p_node_id: nodeId,
    p_slot: slot,
  })
}

export async function fetchIntelReports() {
  return supabase
    .from('intel_reports')
    .select(
      'id, ability_id, target_type, target_name, target_id, node_id, slot, report_data, created_at',
    )
    .order('created_at', { ascending: false })
}

export async function clearIntelArchive() {
  return supabase.rpc('zt_clear_intel_archive')
}

export function formatReportDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

export function formatReportTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function reportListTitle(report) {
  const date = formatReportDate(report?.created_at)
  if (report?.ability_id === 'doxxing') {
    return `Doxxing: ${report.target_name || 'Agente'} - ${date}`
  }
  return `Background: ${report?.target_name || 'Slot'} - ${date}`
}

export function reportKindLabel(abilityId) {
  return abilityId === 'doxxing' ? 'Doxxing' : 'Background Check'
}

export function normalizeReportLogs(reportData) {
  const rows = Array.isArray(reportData) ? reportData : []
  return rows.map((log, i) => ({
    id: log.id ?? `archived-${i}-${log.created_at ?? i}`,
    created_at: log.created_at,
    event_type: log.event_type,
    message: log.message,
    outcome: log.outcome ?? log.meta?.outcome ?? null,
    meta: log.meta ?? {},
    actor_id: log.actor_id ?? null,
    target_id: log.target_id ?? null,
    is_public: false,
  }))
}

export function archiveFromAbilityResult(abilityId, result) {
  if (abilityId === 'doxxing') {
    return {
      abilityId,
      targetType: 'USER',
      targetName: result?.target_name || 'Agente',
      reportData: result?.logs ?? [],
      targetId: result?.target_id ?? null,
    }
  }
  if (abilityId === 'background_check') {
    const slot = result?.slot ?? null
    const node = result?.node_name || 'Server'
    return {
      abilityId,
      targetType: 'SLOT',
      targetName: slot ? `${node} [Slot ${slot}]` : node,
      reportData: result?.logs ?? [],
      nodeId: result?.node_id ?? null,
      slot,
    }
  }
  return null
}
