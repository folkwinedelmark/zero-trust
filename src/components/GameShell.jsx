import { useMemo, useState } from 'react'
import { useTravel } from '../hooks/useTravel'
import { TIME_TRAVEL } from '../lib/constants'
import { beginTravel, disconnectToMap, isTraveling, resolveTravelMs } from '../lib/travel'
import { rememberNodeName } from '../lib/nodeName'
import CharacterModal from './CharacterModal'
import IntelArchive from './IntelArchive'
import LoadoutPanel from './LoadoutPanel'
import { useRealtimeMap } from '../hooks/useRealtimeMap'
import { useActionResolver } from '../hooks/useActionResolver'
import { useIncomingThreats } from '../hooks/useIncomingThreats'
import { useSystemLogs } from '../hooks/useSystemLogs'
import { useGigs } from '../hooks/useGigs'
import { useAuth } from '../context/AuthContext'
import { useDebug } from '../debug/DebugContext'
import { useBgmMatch } from '../hooks/useBGM'
import Dashboard from './Dashboard'
import GameHeader from './GameHeader'
import AfterlifeView from './AfterlifeView'
import NodeView from './NodeView'
import TraceResultBanner from './TraceResultBanner'
import MobileBottomNav from './MobileBottomNav'
import RulebookModal from './RulebookModal'
import PlayerDirectoryModal from './PlayerDirectoryModal'

/** Shell di gioco: mappa, timer, contromisure, log, alert minaccia */
export default function GameShell() {
  const { profile, refreshProfile } = useAuth()
  useBgmMatch(true)
  const debug = useDebug()
  const map = useRealtimeMap()
  const systemLogs = useSystemLogs()
  const gigs = useGigs()
  const [view, setView] = useState({ type: 'map' })
  const [travelError, setTravelError] = useState(null)
  const [loadoutOpen, setLoadoutOpen] = useState(false)
  const [abilitiesOpen, setAbilitiesOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [rulebookOpen, setRulebookOpen] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)

  const activeSlot = useMemo(() => {
    if (!profile) return null
    return (
      map.slots.find(
        (s) =>
          s.user_id === profile.id &&
          s.action_type &&
          s.end_time,
      ) ?? null
    )
  }, [map.slots, profile])

  const { abortAction, lastTraceResult, clearTraceResult } = useActionResolver({
    profile,
    activeSlot,
    nodes: map.nodes,
    slots: map.slots,
    refreshProfile,
    reloadLogs: systemLogs.reload,
  })

  const { threats } = useIncomingThreats({
    activeSlot,
    slots: map.slots,
  })

  const travel = useTravel({
    profile,
    refreshProfile,
    onArrived: (nodeId) => {
      setTravelError(null)
      setView({ type: 'node', id: nodeId })
    },
  })

  const isBlocked = Boolean(profile?.is_blocked)
  const travelTotalMs = travel.intent?.travelMs || TIME_TRAVEL

  function closeOverlays() {
    setLoadoutOpen(false)
    setAbilitiesOpen(false)
    setArchiveOpen(false)
    setRulebookOpen(false)
    setDirectoryOpen(false)
  }

  async function goMap() {
    closeOverlays()
    setView({ type: 'map' })
    if (!profile?.id) return
    try {
      await disconnectToMap(profile)
      await refreshProfile()
    } catch (err) {
      console.error('[goMap]', err)
    }
  }

  async function openServer(id) {
    if (isBlocked || !profile) return
    setTravelError(null)

    if (profile.status === 'busy') {
      setView({ type: 'node', id })
      return
    }

    if (isTraveling(profile)) return

    const node = map.nodes.find((n) => n.id === id)
    if (!node) return

    try {
      const travelMs = debug.instantTravel ? 0 : resolveTravelMs(profile, node)
      await beginTravel({
        profile,
        node,
        travelMs,
        intent: {
          nodeId: node.id,
          nodeName: node.name,
          travelMs,
        },
      })
      rememberNodeName(node.id, node.name)
      await refreshProfile()
      setView({ type: 'map' })
    } catch (err) {
      setTravelError(err.message ?? 'Travel fallito')
    }
  }

  function openAfterlife(id) {
    if (isTraveling(profile)) return
    closeOverlays()
    if (isBlocked) {
      setView({ type: 'afterlife', id, section: 'helpdesk' })
      return
    }
    setView({ type: 'afterlife', id, section: 'hardware' })
  }

  function openHubFromNav() {
    const hub =
      map.services.find((s) => s.name.toLowerCase().includes('afterlife')) ??
      map.services[0]
    if (!hub) return
    openAfterlife(hub.id)
  }

  const afterlifeNode =
    view.type === 'afterlife'
      ? map.nodes.find((n) => n.id === view.id)
      : null

  const showNode = view.type === 'node' && !travel.traveling

  return (
    <>
      <GameHeader
        activeSlot={activeSlot}
        isBlocked={isBlocked}
        threats={threats}
        onAbort={abortAction}
        traveling={travel.traveling}
        travelRemainingMs={travel.remainingMs}
        travelTotalMs={travelTotalMs}
        travelLabel={travel.intent?.nodeName ?? null}
        onAbortTravel={travel.cancelTravel}
        onOpenLoadout={() => setLoadoutOpen(true)}
        onOpenAbilities={() => setAbilitiesOpen(true)}
        onOpenArchive={() => setArchiveOpen(true)}
        onOpenRulebook={() => setRulebookOpen(true)}
        onOpenDirectory={() => setDirectoryOpen(true)}
        executorGigs={gigs.myExecuting}
        servers={map.servers}
      />
      <LoadoutPanel
        open={loadoutOpen}
        onClose={() => setLoadoutOpen(false)}
        nodes={map.nodes}
        slotsByNode={map.slotsByNode}
      />
      <CharacterModal
        open={abilitiesOpen}
        onClose={() => setAbilitiesOpen(false)}
        nodes={map.nodes}
        slotsByNode={map.slotsByNode}
        onOpenArchive={() => {
          setAbilitiesOpen(false)
          setArchiveOpen(true)
        }}
      />
      <IntelArchive
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
      />
      <RulebookModal
        open={rulebookOpen}
        onClose={() => setRulebookOpen(false)}
      />
      <PlayerDirectoryModal
        open={directoryOpen}
        onClose={() => setDirectoryOpen(false)}
      />
      <main className="relative z-10 px-4 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:pt-10 md:pb-6">
        {lastTraceResult && !showNode && (
          <TraceResultBanner
            className="mx-auto mb-4 max-w-5xl"
            result={lastTraceResult}
            onClose={clearTraceResult}
          />
        )}

        {showNode ? (
          <NodeView
            nodeId={view.id}
            nodes={map.nodes}
            slotsByNode={map.slotsByNode}
            activeSlot={activeSlot}
            threats={threats}
            onBack={goMap}
            onAbort={abortAction}
            lastTraceResult={lastTraceResult}
            onClearTraceResult={clearTraceResult}
            logs={systemLogs.logs}
            logsLoading={systemLogs.loading}
            logsError={systemLogs.error}
            viewerId={systemLogs.viewerId}
            reloadLogs={systemLogs.reload}
            executorGigs={gigs.myExecuting}
          />
        ) : view.type === 'afterlife' && !travel.traveling ? (
          <AfterlifeView
            node={afterlifeNode}
            nodes={map.nodes}
            slotsByNode={map.slotsByNode}
            onBack={goMap}
            initialSection={view.section ?? 'helpdesk'}
            gigsState={gigs}
          />
        ) : (
          <Dashboard
            servers={map.servers}
            services={map.services}
            slotsByNode={map.slotsByNode}
            rolesById={map.rolesById}
            viewerRole={profile?.role}
            loading={map.loading}
            error={map.error}
            isBlocked={isBlocked}
            onSelectServer={openServer}
            onSelectAfterlife={openAfterlife}
            logs={systemLogs.logs}
            logsLoading={systemLogs.loading}
            logsError={systemLogs.error}
            viewerId={systemLogs.viewerId}
            traveling={travel.traveling}
            travelLabel={travel.intent?.nodeName ?? null}
            travelRemainingMs={travel.remainingMs}
            travelError={travelError}
            onAbortTravel={travel.cancelTravel}
            executorGigs={gigs.myExecuting}
            scoreByFaction={map.scoreByFaction}
          />
        )}
      </main>
      <MobileBottomNav
        active={
          loadoutOpen
            ? 'loadout'
            : abilitiesOpen
              ? 'abilities'
              : directoryOpen
                ? 'directory'
                : rulebookOpen
                ? 'rulebook'
                : view.type === 'afterlife'
                  ? 'hub'
                  : 'map'
        }
        onMap={() => void goMap()}
        onDirectory={() => {
          setLoadoutOpen(false)
          setAbilitiesOpen(false)
          setArchiveOpen(false)
          setRulebookOpen(false)
          setDirectoryOpen(true)
        }}
        onAbilities={() => {
          setLoadoutOpen(false)
          setArchiveOpen(false)
          setRulebookOpen(false)
          setDirectoryOpen(false)
          setAbilitiesOpen(true)
        }}
        onLoadout={() => {
          setAbilitiesOpen(false)
          setArchiveOpen(false)
          setRulebookOpen(false)
          setDirectoryOpen(false)
          setLoadoutOpen(true)
        }}
        onHub={openHubFromNav}
        onRulebook={() => {
          setLoadoutOpen(false)
          setAbilitiesOpen(false)
          setArchiveOpen(false)
          setDirectoryOpen(false)
          setRulebookOpen(true)
        }}
      />
    </>
  )
}
