import { useState } from 'react'
import { ArrowLeft, Headset, Loader2, ShieldAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useDebug } from '../debug/DebugContext'
import { UNBLOCK_COST } from '../lib/constants'
import { writeLog } from '../lib/logging'

export default function HelpdeskView({ node, onBack }) {
  const { profile, refreshProfile } = useAuth()
  const debug = useDebug()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)

  const blocked = Boolean(profile?.is_blocked)
  const cost = debug.creditCost(UNBLOCK_COST)

  async function unlockAccount() {
    if (!profile || busy) return
    setBusy(true)
    setError(null)
    setOk(null)

    try {
      if (!profile.is_blocked) {
        setOk('Account già operativo.')
        return
      }
      if (profile.creds < cost) {
        throw new Error(`Servono ${cost} ₵ per lo sblocco.`)
      }
      if (profile.status === 'busy') {
        throw new Error('Termina o abortisci l’operazione prima dello sblocco.')
      }

      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({
          is_blocked: false,
          creds: profile.creds - cost,
        })
        .eq('id', profile.id)
        .eq('is_blocked', true)
        .select('*')
        .maybeSingle()

      if (updateError) throw updateError
      if (!data) throw new Error('Sblocco non applicato.')

      await writeLog({
        eventType: 'helpdesk_unlock',
        message:
          cost === 0
            ? `Helpdesk: account sbloccato (bypass debug) — Server: ${node?.name ?? 'Helpdesk IT'}`
            : `Helpdesk: pagati ${cost} ₵ — account sbloccato — Server: ${node?.name ?? 'Helpdesk IT'}`,
        outcome: 'success',
        nodeId: node?.id ?? null,
        actorId: profile.id,
        meta: {
          cost,
          reason: 'unblock',
          tone: 'success',
          node_name: node?.name ?? 'Helpdesk IT',
        },
      })

      await refreshProfile()
      setOk(
        cost === 0
          ? 'Account sbloccato (debug: costo bypassato).'
          : 'Account sbloccato. Puoi tornare sulla rete.',
      )
    } catch (err) {
      setError(err.message ?? 'Sblocco fallito')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Network Map
      </button>

      <div className="border border-zinc-700/80 bg-zinc-900/70 p-6">
        <div className="mb-6 flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <Headset className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div className="text-left">
            <p className="font-display text-xs uppercase tracking-[0.35em] text-amber-400/80">
              Service Node
            </p>
            <h1 className="font-display mt-1 text-2xl text-zinc-100">
              {node?.name ?? 'Helpdesk IT'}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Ticket di ripristino account dopo un Kick. Costo: {cost} ₵
              {debug.bypassCosts ? ' (debug bypass)' : ''}.
            </p>
          </div>
        </div>

        <div
          className={`mb-5 border px-4 py-3 text-sm ${
            blocked
              ? 'border-red-500/40 bg-red-500/10 text-red-200'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          }`}
        >
          <p className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            {blocked
              ? 'Stato: BLOCKED — niente viaggi né azioni sui server.'
              : 'Stato: operativo — nessun ticket aperto.'}
          </p>
        </div>

        <button
          type="button"
          disabled={busy || !blocked}
          onClick={unlockAccount}
          className="flex w-full items-center justify-center gap-2 bg-amber-500 px-4 py-2.5 text-sm font-medium uppercase tracking-wider text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {cost === 0 ? 'Sblocca gratis (debug)' : `Paga ${cost} ₵ e sblocca`}
        </button>

        {error && (
          <p className="mt-4 border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {ok && (
          <p className="mt-4 border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {ok}
          </p>
        )}
      </div>
    </div>
  )
}
