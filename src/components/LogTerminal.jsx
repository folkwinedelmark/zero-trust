import { Loader2, ScrollText } from 'lucide-react'
import {
  LOG_TONES,
  displayMessage,
  displayTag,
  resolveTone,
} from '../lib/logFormat'

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return '--:--:--'
  }
}

/**
 * Registro di Intelligence Operativa — color coding + report leggibili.
 */
export default function LogTerminal({ logs, loading, error, viewerId }) {
  return (
    <section className="mt-10 border border-zinc-700/80 bg-zinc-950/90">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2 text-left">
          <ScrollText className="h-4 w-4 text-cyan-400" strokeWidth={1.5} />
          <div>
            <h2 className="font-display text-base uppercase tracking-[0.2em] text-zinc-300">
              Intel Registry
            </h2>
            <p className="text-xs text-zinc-600">
              Cronistoria operativa personale · feed color-coded
            </p>
          </div>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
      </div>

      <div className="flex flex-wrap gap-3 border-b border-zinc-800/80 px-4 py-2 text-xs uppercase tracking-wider text-zinc-500">
        <span className="text-emerald-400">● Successo</span>
        <span className="text-cyan-400">● Intel / azione</span>
        <span className="text-amber-400">● Warning / Abort</span>
        <span className="text-red-400">● Minaccia / fail</span>
        <span className="text-zinc-500">● Neutro</span>
      </div>

      {error && (
        <p className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {String(error)}
          {String(error).toLowerCase().includes('is_public') ||
          String(error).toLowerCase().includes('policy')
            ? ' — Esegui phase6_logs_privacy.sql'
            : String(error).toLowerCase().includes('outcome')
              ? ' — Esegui phase5_logs_alerts.sql'
              : ''}
        </p>
      )}

      <div className="max-h-80 min-w-0 overflow-x-hidden overflow-y-auto font-mono text-sm leading-normal">
        {logs.length === 0 && !loading ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-600">
            Registry vuoto. Avvia un’operazione per popolare l’intel.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {logs.map((log) => {
              let toneKey = 'neutral'
              let message = log?.message || log?.event_type || 'evento'
              try {
                toneKey = resolveTone(log, viewerId)
                message = displayMessage(log, viewerId)
              } catch (err) {
                console.error('[LogTerminal] row', err)
              }
              const tone = LOG_TONES[toneKey] ?? LOG_TONES.neutral
              const tag = displayTag(log)
              const iAmTarget =
                viewerId &&
                log.target_id === viewerId &&
                log.actor_id !== viewerId
              const time = formatTime(log.created_at)
              const metaBits = [
                iAmTarget ? 'subita' : log.is_public ? 'pubblico' : 'tua',
                log.outcome || null,
                log.meta?.revealed && !iAmTarget ? `id:${log.meta.revealed}` : null,
              ].filter(Boolean)
              const body = metaBits.length
                ? `${message} · ${metaBits.join(' · ')}`
                : message
              const fullText = `[${time}] [${tag}] ${body}`

              return (
                <li
                  key={log.id}
                  className={`min-w-0 border-l-2 px-4 py-1.5 text-left ${tone.row}`}
                  title={fullText}
                >
                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                    <div className="shrink-0 whitespace-nowrap font-bold">
                      <span className="mr-2 text-zinc-500">[{time}]</span>
                      <span className={tone.tag}>[{tag}]</span>
                    </div>
                    <div className={`min-w-0 flex-1 break-words ${tone.text}`}>
                      {body}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
