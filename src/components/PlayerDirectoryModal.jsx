import { useEffect, useState } from 'react'
import { Loader2, Skull, Star, Users, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAudio } from '../hooks/useAudio'
import { usePlayerDirectory } from '../hooks/usePlayerDirectory'
import { HEAT_MAX } from '../lib/constants'
import {
  DEDUCED_FACTIONS,
  canSeeDirectoryClass,
  clampHeat,
  deducedFactionMeta,
  directoryClassLabel,
  directoryStatus,
  directoryWealth,
} from '../lib/playerDirectory'

export default function PlayerDirectoryModal({ open, onClose }) {
  const { profile } = useAuth()
  const { playClick } = useAudio()
  const { players, notes, loading, error, savingId, saveNote } =
    usePlayerDirectory(open)
  const [expandedId, setExpandedId] = useState(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!open) {
      setExpandedId(null)
      return undefined
    }
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])

  if (!open) return null

  function close() {
    playClick()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/80 p-4 pb-20 md:pb-4">
      <div className="flex h-[min(86vh,720px)] w-full max-w-4xl flex-col overflow-hidden border border-cyan-500/40 bg-zinc-900 shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="text-left">
            <p className="font-display text-[10px] uppercase tracking-[0.3em] text-cyan-400/80">
              Synth-Corp
            </p>
            <h2 className="font-display mt-1 flex items-center gap-2 text-lg text-zinc-100">
              <Users className="h-4 w-4 text-cyan-300" />
              Directory di Rete
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Classi visibili solo a te, o dopo Trace / Deep Scan / Background
              Check / Doxxing sul bersaglio. Le note fazione restano private.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Chiudi directory"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <p className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
          {loading && players.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-10 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scan della rete…
            </p>
          ) : players.length === 0 ? (
            <p className="px-5 py-10 text-sm text-zinc-600">
              Nessun agente registrato.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {players.map((player) => (
                <DirectoryRow
                  key={player.id}
                  player={player}
                  viewer={profile}
                  note={notes[player.id]}
                  expanded={expandedId === player.id}
                  saving={savingId === player.id}
                  now={now}
                  onToggle={() => {
                    playClick()
                    setExpandedId((id) =>
                      id === player.id ? null : player.id,
                    )
                  }}
                  onSave={(patch) => saveNote(player.id, patch)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function DirectoryRow({
  player,
  viewer,
  note,
  expanded,
  saving,
  now,
  onToggle,
  onSave,
}) {
  const revealed = canSeeDirectoryClass(viewer, player, note)
  const role = directoryClassLabel(viewer, player, note)
  const status = directoryStatus(player, now)
  const offline = status.id === 'offline'
  const heat = clampHeat(player.heat)
  const stars = Math.max(1, Math.min(5, Number(player.reputation) || 3))
  const tag = deducedFactionMeta(note?.deduced_faction)
  const isSelf = viewer?.id === player.id
  const wealth = directoryWealth(viewer, player)

  return (
    <li className={expanded ? 'bg-zinc-950/70' : offline ? 'opacity-55' : ''}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-zinc-800/40 sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-zinc-100">
            {player.name}
            {isSelf ? (
              <span className="ml-2 text-[10px] uppercase tracking-wider text-cyan-400/80">
                Tu
              </span>
            ) : null}
            {offline ? (
              <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-500">
                [ OFFLINE ]
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px]">
            {revealed && role ? (
              <span className="inline-flex items-center gap-1.5 text-zinc-300">
                {role.iconSrc ? (
                  <img
                    src={role.iconSrc}
                    alt=""
                    className="h-5 w-5 object-contain"
                  />
                ) : null}
                {role.label}
              </span>
            ) : (
              <span className="directory-class-unknown font-mono tracking-[0.3em] text-zinc-600">
                [ ??? ]
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-0.5 text-amber-300">
            {Array.from({ length: 5 }, (_, i) => (
              <Star
                key={i}
                className={`h-3 w-3 ${
                  i < stars ? 'fill-amber-400 text-amber-400' : 'text-zinc-700'
                }`}
              />
            ))}
          </span>
          <span className="inline-flex items-center gap-0.5">
            {Array.from({ length: HEAT_MAX }, (_, i) => (
              <Skull
                key={i}
                className={`h-3 w-3 ${
                  i < heat ? 'text-red-400' : 'text-zinc-700'
                }`}
              />
            ))}
          </span>
          <span
            className="inline-flex min-w-[6.5rem] flex-col text-right"
            title="Patrimonio / Liquidità"
          >
            <span className="text-[9px] font-normal uppercase tracking-[0.22em] text-zinc-500">
              Patrimonio
            </span>
            <span
              className={`text-[11px] uppercase tracking-wider ${wealth.className}`}
            >
              {wealth.label}
            </span>
          </span>
          <span
            className={`uppercase tracking-wider ${status.className}`}
          >
            {status.label}
          </span>
          <span
            className={`inline-flex border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tag.activeClass}`}
          >
            {tag.label}
          </span>
        </div>
      </button>

      {expanded && (
        <DeductionDrawer
          note={note}
          saving={saving}
          onSave={onSave}
        />
      )}
    </li>
  )
}

function DeductionDrawer({ note, saving, onSave }) {
  const [draft, setDraft] = useState(note?.custom_note ?? '')
  const faction = note?.deduced_faction ?? 'UNKNOWN'

  useEffect(() => {
    setDraft(note?.custom_note ?? '')
  }, [note?.custom_note, note?.target_user_id])

  return (
    <div className="border-t border-zinc-800 bg-zinc-950/80 px-4 py-3">
      <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
        Deduzione fazione (privata)
      </p>
      <div className="flex flex-wrap gap-1.5">
        {DEDUCED_FACTIONS.map((opt) => {
          const active = faction === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              title={opt.title}
              disabled={saving}
              onClick={() =>
                onSave({ deducedFaction: opt.id, customNote: draft })
              }
              className={`border px-2 py-1 text-[10px] uppercase tracking-wider ${
                active ? opt.activeClass : opt.className
              } hover:bg-zinc-800 disabled:opacity-40`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      <label className="mt-3 block text-[10px] uppercase tracking-wider text-zinc-500">
        Nota
        <textarea
          value={draft}
          maxLength={280}
          rows={2}
          placeholder="Es. Probabile spia ribelle su Aegis Prime"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const next = draft.trim()
            const prev = String(note?.custom_note ?? '').trim()
            if (next === prev) return
            void onSave({ deducedFaction: faction, customNote: next })
          }}
          className="mt-1.5 w-full resize-none border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-cyan-500/60"
        />
      </label>
      {saving ? (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          Salvataggio…
        </p>
      ) : (
        <p className="mt-1 text-[10px] text-zinc-600">
          Salvata al blur · {draft.length}/280
        </p>
      )}
    </div>
  )
}
