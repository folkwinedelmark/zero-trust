import { Loader2 } from 'lucide-react'
import { useAuth } from './context/AuthContext'
import { useGameSession } from './hooks/useGameSession'
import { BgmProvider, useBGM } from './hooks/useBGM'
import AuthScreen from './components/AuthScreen'
import CharacterCreation from './components/CharacterCreation'
import ClassSelectionModal from './components/ClassSelectionModal'
import FactionBriefingModal from './components/FactionBriefingModal'
import LobbyView from './components/LobbyView'
import ScheduledWaitingView from './components/ScheduledWaitingView'
import EndGameModal from './components/EndGameModal'
import GameShell from './components/GameShell'
import VersionWatermark from './components/VersionWatermark'

export default function App() {
  return (
    <BgmProvider>
      <AppShell />
    </BgmProvider>
  )
}

function AppShell() {
  useBGM()
  const { loading, isAuthenticated, needsCharacter, profile, passwordRecovery } =
    useAuth()

  return (
    <div className="relative min-h-svh overflow-x-hidden bg-zinc-950 text-zinc-200">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(34,211,238,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(245,158,11,0.08),_transparent_50%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {loading ? (
        <main className="relative z-10 flex min-h-svh items-center justify-center px-4">
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
            Sincronizzazione sessione…
          </div>
        </main>
      ) : passwordRecovery || !isAuthenticated ? (
        <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-10">
          <AuthScreen />
        </main>
      ) : needsCharacter || !profile ? (
        <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-10">
          <CharacterCreation />
        </main>
      ) : (
        <AuthenticatedFlow />
      )}
      <VersionWatermark />
    </div>
  )
}

function AuthenticatedFlow() {
  const { profile } = useAuth()
  const session = useGameSession()

  if (session.loading) {
    return (
      <main className="relative z-10 flex min-h-svh items-center justify-center px-4">
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
          Collegamento alla lobby…
        </div>
      </main>
    )
  }

  if (session.gameState === 'COMPLETED') {
    return <EndGameModal session={session} />
  }

  if (session.gameState === 'SCHEDULED_WAITING') {
    return (
      <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-10">
        <ScheduledWaitingView session={session} />
      </main>
    )
  }

  if (session.gameState !== 'ACTIVE') {
    return (
      <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-10">
        <LobbyView session={session} />
      </main>
    )
  }

  if (profile?.briefing_seen === false) {
    return <FactionBriefingModal session={session} />
  }

  if (!profile?.role) {
    return (
      <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-10">
        <ClassSelectionModal session={session} />
      </main>
    )
  }

  return <GameShell session={session} />
}
