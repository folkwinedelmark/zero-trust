import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAudio } from '../hooks/useAudio'
import { catalogShortText, getCatalogItem } from '../lib/afterlifeCatalog'
import { isSlotLocked } from '../lib/hardware'
import { isBackdoorRestricted } from '../lib/abilities'

export default function UseItemModal({
  entry,
  servers,
  slotsByNode,
  onClose,
  onConfirm,
  busy,
}) {
  const { profile } = useAuth()
  const { playClick } = useAudio()
  const item = getCatalogItem(entry.itemId)
  const [players, setPlayers] = useState([])
  const [targetId, setTargetId] = useState('')
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [nodeId, setNodeId] = useState(servers[0]?.id ?? '')
  const [slotId, setSlotId] = useState('')

  const emptySlots = (slotsByNode[nodeId] ?? []).filter(
    (s) =>
      !s.user_id &&
      !s.is_decoy &&
      !isSlotLocked(s) &&
      !isBackdoorRestricted(s, profile),
  )

  useEffect(() => {
    if (item?.needsTarget !== 'player' || !profile?.id) return
    let cancelled = false
    setLoadingPlayers(true)
    supabase
      .from('profiles')
      .select('id, name')
      .neq('id', profile.id)
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setPlayers([])
        } else {
          setPlayers(data ?? [])
        }
        setLoadingPlayers(false)
      })
    return () => {
      cancelled = true
    }
  }, [item?.needsTarget, profile?.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 px-4">
      <div className="w-full max-w-md border border-zinc-600 bg-zinc-900 p-5">
        <p className="font-display text-sm uppercase tracking-wider text-fuchsia-300">
          Usa {item?.name}
        </p>
        <p className="mt-1 text-xs text-zinc-500">{catalogShortText(item)}</p>

        {item?.needsTarget === 'player' && (
          <div className="mt-4 space-y-3">
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={busy || loadingPlayers}
              className="w-full border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/70 disabled:opacity-50"
            >
              <option value="">
                {loadingPlayers ? 'Scan agenti…' : 'Seleziona un agente'}
              </option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {players.length === 0 && !loadingPlayers && (
              <p className="text-xs text-zinc-500">Nessun altro agente in rete.</p>
            )}
            <button
              type="button"
              disabled={busy || !targetId}
              onClick={() => onConfirm({ targetId })}
              className="w-full bg-cyan-500 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-zinc-950 hover:bg-cyan-400 disabled:opacity-40"
            >
              USA
            </button>
          </div>
        )}

        {item?.needsTarget === 'node' && (
          <div className="mt-4 space-y-2">
            {servers.map((n) => (
              <button
                key={n.id}
                type="button"
                disabled={busy}
                onClick={() => onConfirm({ targetId: n.id })}
                className="w-full border border-zinc-700 px-3 py-2 text-left text-sm text-zinc-200 hover:border-cyan-500/50"
              >
                {n.name}
              </button>
            ))}
          </div>
        )}

        {item?.needsTarget === 'empty_slot' && (
          <div className="mt-4 space-y-2">
            <select
              value={nodeId}
              onChange={(e) => {
                setNodeId(e.target.value)
                setSlotId('')
              }}
              className="w-full border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              {servers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              {emptySlots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSlotId(s.id)
                    onConfirm({ targetSlotId: s.id })
                  }}
                  className={`border px-3 py-1.5 text-xs ${
                    slotId === s.id
                      ? 'border-cyan-500 text-cyan-300'
                      : 'border-zinc-600 text-zinc-300'
                  }`}
                >
                  Slot {s.slot_id}
                </button>
              ))}
              {emptySlots.length === 0 && (
                <p className="text-xs text-zinc-500">Nessuno slot vuoto.</p>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            playClick()
            onClose()
          }}
          className="mt-4 text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
        >
          Annulla
        </button>
      </div>
    </div>
  )
}
