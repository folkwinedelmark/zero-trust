import { useEffect, useMemo, useState } from 'react'
import { Archive, Loader2, ScrollText, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAudio } from '../hooks/useAudio'
import { useIntelReports } from '../hooks/useIntelReports'
import {
  formatReportTime,
  normalizeReportLogs,
  reportKindLabel,
  reportListTitle,
} from '../lib/intelArchive'
import {
  LOG_TONES,
  displayMessage,
  displayTag,
  resolveTone,
} from '../lib/logFormat'

export default function IntelArchive({ open, onClose }) {
  const { profile } = useAuth()
  const { playClick } = useAudio()
  const { reports, loading, error } = useIntelReports(open)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    if (!open) {
      setSelectedId(null)
      return
    }
    setSelectedId((prev) => {
      if (prev && reports.some((r) => r.id === prev)) return prev
      return reports[0]?.id ?? null
    })
  }, [open, reports])

  const selected = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  )
  const logs = useMemo(
    () => normalizeReportLogs(selected?.report_data),
    [selected],
  )

  if (!open) return null

  function close() {
    playClick()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/80 p-4 pb-20 md:pb-4">
      <div className="flex h-[min(86vh,720px)] w-full max-w-5xl flex-col overflow-hidden border border-cyan-500/40 bg-zinc-900 shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="text-left">
            <p className="font-display text-[10px] uppercase tracking-[0.3em] text-cyan-400/80">
              Data Analyst
            </p>
            <h2 className="font-display mt-1 flex items-center gap-2 text-lg text-zinc-100">
              <Archive className="h-4 w-4 text-cyan-300" />
              Archivio Intel
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Report persistenti di Background Check e Doxxing
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Chiudi archivio"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside className="flex max-h-48 w-full shrink-0 flex-col border-b border-zinc-800 sm:max-h-none sm:w-72 sm:border-r sm:border-b-0">
            <p className="px-4 py-2 text-[10px] uppercase tracking-wider text-zinc-500">
              Report
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && reports.length === 0 ? (
                <p className="flex items-center gap-2 px-4 py-6 text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Caricamento…
                </p>
              ) : reports.length === 0 ? (
                <p className="px-4 py-6 text-xs text-zinc-600">
                  Nessun report. Esegui Background Check o Doxxing.
                </p>
              ) : (
                <ul>
                  {reports.map((report) => {
                    const active = report.id === selectedId
                    return (
                      <li key={report.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(report.id)}
                          className={`w-full border-l-2 px-4 py-2.5 text-left transition ${
                            active
                              ? 'border-cyan-400 bg-cyan-500/10'
                              : 'border-transparent hover:bg-zinc-800/60'
                          }`}
                        >
                          <p className="text-[10px] uppercase tracking-wider text-cyan-400/80">
                            {reportKindLabel(report.ability_id)}
                          </p>
                          <p className="mt-0.5 text-xs font-medium text-zinc-100">
                            {reportListTitle(report)}
                          </p>
                          <p className="mt-0.5 text-[10px] text-zinc-600">
                            {formatReportTime(report.created_at)} ·{' '}
                            {normalizeReportLogs(report.report_data).length} eventi
                          </p>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {error && (
              <p className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
                {error}
              </p>
            )}
            {selected ? (
              <>
                <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
                  <ScrollText className="h-3.5 w-3.5 text-cyan-400" />
                  <p className="text-xs text-zinc-300">
                    {reportListTitle(selected)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 border-b border-zinc-800/80 px-4 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
                  <span className="text-emerald-400">● Successo</span>
                  <span className="text-cyan-400">● Intel</span>
                  <span className="text-amber-400">● Warning</span>
                  <span className="text-red-400">● Minaccia</span>
                </div>
                <ArchivedLogFeed logs={logs} viewerId={profile?.id} />
              </>
            ) : (
              <p className="px-4 py-10 text-center text-sm text-zinc-600">
                Seleziona un report a sinistra.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

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

function ArchivedLogFeed({ logs, viewerId }) {
  if (!logs.length) {
    return (
      <p className="px-4 py-8 text-center text-xs text-zinc-600">
        Nessun evento nelle 24h coperte da questo report.
      </p>
    )
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px] leading-snug">
      {logs.map((log) => {
        let toneKey = 'neutral'
        let message = log?.message || log?.event_type || 'evento'
        try {
          toneKey = resolveTone(log, viewerId)
          message = displayMessage(log, viewerId)
        } catch (err) {
          console.error('[ArchivedLogFeed]', err)
        }
        const tone = LOG_TONES[toneKey] ?? LOG_TONES.neutral
        return (
          <li
            key={log.id}
            className={`min-w-0 border-l-2 px-4 py-1.5 text-left ${tone.row}`}
          >
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
              <div className="shrink-0 whitespace-nowrap font-bold">
                <span className="mr-2 text-zinc-500">
                  [{formatTime(log.created_at)}]
                </span>
                <span className={tone.tag}>[{displayTag(log)}]</span>
              </div>
              <div className={`min-w-0 flex-1 break-words ${tone.text}`}>
                {message}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
