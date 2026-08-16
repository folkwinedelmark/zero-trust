import { useState } from 'react'
import { Loader2, UserRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function CharacterCreation() {
  const { createCharacter, error, setError, signOut, user } = useAuth()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    await createCharacter({ name })
    setSubmitting(false)
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-8 text-center">
        <p className="font-display text-xs uppercase tracking-[0.35em] text-amber-400/80">
          Onboarding Operativo
        </p>
        <h1 className="font-display mt-2 text-3xl font-semibold tracking-wide text-zinc-100">
          Entra in Lobby
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Scegli l’handle. Fazione e classe verranno assegnate all’avvio della
          partita. Account{' '}
          <span className="text-zinc-300">{user?.email}</span>.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-8 border border-zinc-700/80 bg-zinc-900/70 p-6 backdrop-blur"
      >
        <label className="block text-left text-xs uppercase tracking-wider text-zinc-400">
          Handle operativo
          <div className="relative mt-1.5">
            <UserRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              required
              minLength={3}
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-zinc-600 bg-zinc-950 py-2.5 pr-3 pl-10 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/70"
              placeholder="es. NullPointer"
            />
          </div>
        </label>

        {error && (
          <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-left text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={signOut}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Esci dall’account
          </button>
          <button
            type="submit"
            disabled={submitting || name.trim().length < 3}
            className="flex items-center justify-center gap-2 bg-amber-500 px-5 py-2.5 text-sm font-medium uppercase tracking-wider text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Entra in lobby
          </button>
        </div>
      </form>
    </div>
  )
}
