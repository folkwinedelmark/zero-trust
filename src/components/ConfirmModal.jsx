import { useAudio } from '../hooks/useAudio'

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Conferma',
  busy = false,
  onClose,
  onConfirm,
}) {
  const { playClick } = useAudio()
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/80 px-4">
      <div className="w-full max-w-md border border-zinc-600 bg-zinc-900 p-5">
        <p className="font-display text-sm uppercase tracking-wider text-amber-300">
          {title}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-zinc-200">{message}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              playClick()
              onClose()
            }}
            disabled={busy}
            className="px-3 py-1.5 text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
          >
            Annulla
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              playClick()
              void onConfirm()
            }}
            className="border border-amber-500/40 px-3 py-1.5 text-xs uppercase tracking-wider text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
