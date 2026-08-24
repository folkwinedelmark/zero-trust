import { Lock, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import DebugPanel from '../debug/DebugPanel'
import RulebookButton from './RulebookButton'

/** Schermata per chi non era PRONTO quando il ciclo è partito. */
export default function MatchLockedView() {
  const { signOut } = useAuth()

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="text-left">
          <p className="font-display text-xs uppercase tracking-[0.35em] text-red-400/80">
            Access Denied
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold tracking-wide text-zinc-100">
            Fuori ciclo
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RulebookButton />
          <DebugPanel />
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-1.5 border border-zinc-700 px-2 py-2 text-[10px] uppercase tracking-wider text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            title="Logout"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="border border-red-500/40 bg-red-950/30 px-5 py-8 text-center sm:px-8">
        <Lock className="mx-auto h-10 w-10 text-red-400/90" />
        <p className="font-display mt-4 text-sm font-semibold uppercase tracking-[0.18em] text-red-200">
          ACCESSO NEGATO: Il ciclo di rete è già iniziato. Attendi il prossimo
          reset per partecipare.
        </p>
        <p className="mt-3 text-sm text-zinc-400">
          Solo gli operatori che avevano premuto PRONTO in lobby sono stati
          assegnati a una fazione.
        </p>
      </div>
    </div>
  )
}
