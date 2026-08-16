import { HARDWARE_IDS } from './afterlifeCatalog'
import { getFarmGain, hasHardware } from './hardware'
import { getActionDurationMs } from './actions'
import { TIME_ACTION, TIME_EXTRACT, TIME_KICK, TIME_TRACE } from './constants'

export const BREAKDOWN_CLASS_COLOR = 'text-purple-400'
export const BREAKDOWN_HARDWARE_COLOR = 'text-cyan-400'

export function formatDurationSeconds(ms) {
  const sec = Math.max(0, Number(ms) || 0) / 1000
  if (Number.isInteger(sec)) return `${sec}s`
  return `${sec.toFixed(1).replace(/\.0$/, '')}s`
}

function baseDurationMs(actionType) {
  if (actionType === 'trace') return TIME_TRACE
  if (actionType === 'kick') return TIME_KICK
  if (actionType === 'extract') return TIME_EXTRACT
  return TIME_ACTION
}

export function farmEffectBreakdown(profile) {
  const isExec = profile?.role === 'executive'
  const hasRam = hasHardware(profile?.equipped_hardware, HARDWARE_IDS.ram)
  const modifiers = []
  if (isExec) {
    modifiers.push({
      label: 'Exec',
      value: '+75%',
      colorClass: BREAKDOWN_CLASS_COLOR,
    })
  }
  if (hasRam) {
    modifiers.push({
      label: 'RAM',
      value: '+30%',
      colorClass: BREAKDOWN_HARDWARE_COLOR,
    })
  }
  return {
    value: `+${getFarmGain(profile?.role, profile?.equipped_hardware)} ₵`,
    valueClass: 'text-amber-400',
    suffix: 'al completamento',
    baseLabel: '50 base',
    modifiers,
  }
}

export function iceEffectBreakdown(actionType, profile) {
  const hasHeuristic = hasHardware(
    profile?.equipped_hardware,
    HARDWARE_IDS.heuristic,
  )
  const isAttack = actionType === 'attack'
  const total = hasHeuristic ? 15 : 10
  const modifiers = hasHeuristic
    ? [
        {
          label: 'Heuristic',
          value: isAttack ? '−5%' : '+5%',
          colorClass: BREAKDOWN_HARDWARE_COLOR,
        },
      ]
    : []
  return {
    value: `${isAttack ? '−' : '+'}${total}% ICE`,
    valueClass: isAttack ? 'text-red-400' : 'text-cyan-400',
    suffix: 'a fine timer',
    baseLabel: '10% base',
    modifiers,
  }
}

export function actionTimerBreakdown(actionType, role, { instant = false } = {}) {
  if (instant) {
    return {
      prefix: 'Tempo:',
      value: 'Istantaneo',
      valueClass: 'font-mono text-slate-300',
      modifiers: [],
      emptyLabel: 'Debug',
    }
  }

  const ms = getActionDurationMs(actionType, role)
  const baseMs = baseDurationMs(actionType)
  const modifiers = []

  if (role === 'ghost' && actionType === 'attack') {
    modifiers.push({
      label: 'Ghost',
      value: '−20%',
      colorClass: BREAKDOWN_CLASS_COLOR,
    })
  }

  if (
    role === 'sysadmin' &&
    (actionType === 'defend' ||
      actionType === 'trace' ||
      actionType === 'kick')
  ) {
    modifiers.push({
      label: 'SysAdmin',
      value: '−20%',
      colorClass: BREAKDOWN_CLASS_COLOR,
    })
  }

  if (role === 'analyst' && actionType === 'trace') {
    modifiers.push({
      label: 'Analyst',
      value: '−40%',
      colorClass: BREAKDOWN_CLASS_COLOR,
    })
  }

  return {
    prefix: 'Tempo:',
    value: formatDurationSeconds(ms),
    valueClass: 'font-mono text-slate-300',
    baseLabel: `${formatDurationSeconds(baseMs)} base`,
    modifiers,
  }
}
