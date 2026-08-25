import { useEffect, useMemo, useRef, useState } from 'react'
import { useTravel } from '../hooks/useTravel'
import { useAudio } from '../hooks/useAudio'
import { TIME_TRAVEL } from '../lib/constants'
import {
  beginTravel,
  CONFIRM_LEAVE_SERVER,
  disconnectToMap,
  isTraveling,
  resolveTravelMs,
} from '../lib/travel'
import { rememberNodeName } from '../lib/nodeName'
import CharacterModal from './CharacterModal'
import IntelArchive from './IntelArchive'
import LoadoutPanel from './LoadoutPanel'
import { useRealtimeMap } from '../hooks/useRealtimeMap'
import { useActionResolver } from '../hooks/useActionResolver'
import { useIncomingThreats } from '../hooks/useIncomingThreats'
import { useExpiredActionSweep } from '../hooks/useExpiredActionSweep'
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
export default function GameShell({ session }) {
  const { profile, refreshProfile } = useAuth()
  const { playLogout } = useAudio()
  useBgmMatch(true)
  const debug = useDebug()
  const map = useRealtimeMap()
  const systemLogs = useSystemLogs()
  const gigs = useGigs()
  const [view, setView] = useState(() => {
    const nodeId = profile?.current_node_id
    if (nodeId && !isTraveling(profile)) {
      return { type: 'node', id: nodeId }
    }
    return { type: 'map' }
  })
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
    reloadMap: map.reload,
  })

  const { threats } = useIncomingThreats({
    activeSlot,
    slots: map.slots,
  })

  useExpiredActionSweep(map.slots)

  const travel = useTravel({
    profile,
    refreshProfile,
    onArrived: (nodeId) => {
      setTravelError(null)
      setView({ type: 'node', id: nodeId })
    },
  })

  const hydratedLocationRef = useRef(Boolean(profile?.current_node_id))
  const leavingServerRef = useRef(false)

  useEffect(() => {
    if (hydratedLocationRef.current) return
    if (!profile) return
    if (isTraveling(profile)) {
      hydratedLocationRef.current = true
      return
    }
    if (map.loading) return
    hydratedLocationRef.current = true
    const nodeId = profile.current_node_id
    if (!nodeId) return
    const node = map.nodes.find((n) => n.id === nodeId)
    if (!node || node.type !== 'server') return
    setView({ type: 'node', id: nodeId })
  }, [profile, map.loading, map.nodes])

  const isBlocked = Boolean(profile?.is_blocked)
  const travelTotalMs = travel.intent?.travelMs || TIME_TRAVEL

  function closeOverlays() {
    setLoadoutOpen(false)
    setAbilitiesOpen(false)
    setArchiveOpen(false)
    setRulebookOpen(false)
    setDirectoryOpen(false)
  }

  function isInsideServer() {
    if (isTraveling(profile)) return false
    return view.type === 'node' || Boolean(profile?.current_node_id)
  }

  /** If the player is connected to a server, warn and abort/disconnect before leaving. */
  async function leaveServerIfNeeded() {
    if (!isInsideServer()) return true
    if (leavingServerRef.current) return false
    if (!window.confirm(CONFIRM_LEAVE_SERVER)) return false

    leavingServerRef.current = true
    playLogout()
    try {
      if (activeSlot) {
        await abortAction()
      }
      if (profile?.id) {
        await disconnectToMap(profile)
        await refreshProfile()
      }
      return true
    } catch (err) {
      console.error('[leaveServer]', err)
      return true
    } finally {
      leavingServerRef.current = false
    }
  }

  async function goMap() {
    if (!(await leaveServerIfNeeded())) return
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

    // Bypass travel only when already connected to this node in the DB.
    if (profile.current_node_id === id) {
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

  async function openAfterlife(id) {
    if (isTraveling(profile)) return
    if (!(await leaveServerIfNeeded())) return
    closeOverlays()
    if (isBlocked) {
      setView({ type: 'afterlife', id, section: 'helpdesk' })
      return
    }
    setView({ type: 'afterlife', id, section: 'hardware' })
  }

  async function openHubFromNav() {
    const hub =
      map.services.find((s) => s.name.toLowerCase().includes('afterlife')) ??
      map.services[0]
    if (!hub) return
    await openAfterlife(hub.id)
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
        isHost={Boolean(session?.isHost)}
        concluding={Boolean(session?.busy)}
        onConcludeMatch={session?.conclude}
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
            reloadMap={map.reload}
            upsertSlot={map.upsertSlot}
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
            onSelectAfterlife={(id) => void openAfterlife(id)}
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
            matchEndTime={session?.matchEndTime}
            startedAt={session?.startedAt}
            matchDurationDays={session?.matchDurationDays}
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
        onHub={() => void openHubFromNav()}
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
