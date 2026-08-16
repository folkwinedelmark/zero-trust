import { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function AuthScreen() {
  const {
    signIn,
    signUp,
    resetPassword,
    updatePassword,
    passwordRecovery,
    error,
    setError,
  } = useAuth()
  const [mode, setMode] = useState(passwordRecovery ? 'reset' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [info, setInfo] = useState(null)

  useEffect(() => {
    if (passwordRecovery) {
      setMode('reset')
      setError(null)
      setInfo(null)
    }
  }, [passwordRecovery, setError])

  const isLogin = mode === 'login'
  const isRegister = mode === 'register'
  const isForgot = mode === 'forgot'
  const isReset = mode === 'reset'

  function switchMode(next) {
    setError(null)
    setInfo(null)
    setPassword('')
    setConfirmPassword('')
    setMode(next)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setInfo(null)

    if (isForgot) {
      const { error: resetError } = await resetPassword(email.trim())
      if (!resetError) {
        setInfo(
          'Se l’indirizzo è nel registry, riceverai un link di ripristino. Controlla la posta (e lo spam).',
        )
      }
      setSubmitting(false)
      return
    }

    if (isReset) {
      if (password !== confirmPassword) {
        setError('Le password non coincidono.')
        setSubmitting(false)
        return
      }
      if (password.length < 6) {
        setError('La nuova password deve avere almeno 6 caratteri.')
        setSubmitting(false)
        return
      }
      const { error: updateError } = await updatePassword(password)
      if (!updateError) {
        setInfo('Password aggiornata. Accesso al network ripristinato.')
      }
      setSubmitting(false)
      return
    }

    const action = isLogin ? signIn : signUp
    const { error: authError } = await action(email.trim(), password)

    if (!authError && isRegister) {
      setPassword('')
      setConfirmPassword('')
      setMode('login')
      setInfo('Account creato. Se richiesto, conferma l’email e poi accedi.')
    }

    setSubmitting(false)
  }

  const title = isReset
    ? 'Nuova password'
    : isForgot
      ? 'Recovery protocol'
      : 'ZERO TRUST'

  const subtitle = isReset
    ? 'Imposta le nuove credenziali operative.'
    : isForgot
      ? 'Inserisci l’email del tuo accesso. Ti invieremo un canale di ripristino.'
      : isLogin
        ? 'Autenticati sul network corporativo.'
        : 'Crea le credenziali operative.'

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="relative mx-auto mb-6 flex w-full max-w-[16rem] items-center justify-center sm:max-w-[18rem]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full bg-cyan-400/20 blur-3xl"
          />
          <img
            src="/logo.png"
            alt="Zero Trust Logo"
            className="relative h-36 w-36 object-contain drop-shadow-[0_0_28px_rgba(34,211,238,0.55)] sm:h-44 sm:w-44"
          />
        </div>
        <p className="font-display text-xs uppercase tracking-[0.35em] text-cyan-400/80">
          Synth-Corp Access Gate
        </p>
        <h1 className="font-display mt-2 text-3xl font-semibold tracking-wide text-zinc-100">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 border border-zinc-700/80 bg-zinc-900/70 p-6 backdrop-blur"
      >
        {!isReset && (
          <label className="block text-left text-xs uppercase tracking-wider text-zinc-400">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full border border-zinc-600 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/70"
              placeholder="agente@synth-corp.io"
            />
          </label>
        )}

        {(isLogin || isRegister || isReset) && (
          <PasswordField
            label={isReset ? 'Nuova password' : 'Password'}
            value={password}
            onChange={setPassword}
            show={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
            autoComplete={
              isReset || isRegister ? 'new-password' : 'current-password'
            }
          />
        )}

        {isReset && (
          <PasswordField
            label="Conferma password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
            autoComplete="new-password"
          />
        )}

        {isLogin && (
          <div className="text-right">
            <button
              type="button"
              onClick={() => switchMode('forgot')}
              className="text-xs text-zinc-500 transition hover:text-cyan-400"
            >
              Password dimenticata?
            </button>
          </div>
        )}

        {error && (
          <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-left text-sm text-red-300">
            {error}
          </p>
        )}

        {info && (
          <p className="border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-left text-sm text-cyan-200">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 bg-cyan-600 px-4 py-2.5 text-sm font-medium uppercase tracking-wider text-zinc-950 transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isReset
            ? 'Salva nuova password'
            : isForgot
              ? 'Invia link di recovery'
              : isLogin
                ? 'Entra nel network'
                : 'Registra accesso'}
        </button>
      </form>

      {!isReset && (
        <p className="mt-5 text-center text-sm text-zinc-500">
          {isForgot
            ? 'Ricordi le credenziali?'
            : isLogin
              ? 'Nessuna credenziale?'
              : 'Hai già un account?'}{' '}
          <button
            type="button"
            onClick={() => switchMode(isLogin ? 'register' : 'login')}
            className="text-cyan-400 hover:text-cyan-300"
          >
            {isForgot ? 'Torna all’accesso' : isLogin ? 'Crea accesso' : 'Accedi'}
          </button>
        </p>
      )}
    </div>
  )
}

function PasswordField({ label, value, onChange, show, onToggle, autoComplete }) {
  return (
    <label className="block text-left text-xs uppercase tracking-wider text-zinc-400">
      {label}
      <div className="relative mt-1.5">
        <input
          type={show ? 'text' : 'password'}
          required
          minLength={6}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-zinc-600 bg-zinc-950 px-3 py-2.5 pr-10 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/70"
          placeholder="••••••••"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 hover:text-zinc-300"
          aria-label={show ? 'Nascondi password' : 'Mostra password'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  )
}
