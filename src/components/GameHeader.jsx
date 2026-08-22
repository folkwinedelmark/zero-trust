import { useEffect, useState } from 'react'
import {
  Archive,
  Backpack,
  BookOpen,
  Coins,
  Cpu,
  EyeOff,
  Lock,
  LogOut,
  MemoryStick,
  Navigation,
  Shield,
  ShieldCheck,
  Skull,
  Snowflake,
  Star,
  Timer,
  Zap,
  Settings,
  IdCard,
  Users,
  Flag,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAudio } from '../hooks/useAudio'
import {
  HEAT_MAX,
  PA_MAX,
  factionBarClass,
  factionBarTag,
  factionLogo,
  roleIcon,
  roleLabel,
} from '../lib/constants'
import { CONFIRM_CLOSE_CYCLE } from '../lib/gameSession'
import { actionProgress, formatRemaining } from '../lib/actions'
import { getActionIcon } from '../lib/actionIcons'
import { parseEquippedHardware, stealthRemainingMs } from '../lib/hardware'
import { getCatalogItem, inventoryPassives } from '../lib/afterlifeCatalog'
import { heatTooltip, reputationTooltip } from '../lib/statTooltips'
import DebugPanel from '../debug/DebugPanel'
import GigObjectiveBanner from './GigObjectiveBanner'
import SettingsModal from './SettingsModal'
import StatTooltip from './StatTooltip'
import ThreatAlertBanner from './ThreatAlertBanner'
import { useNightTruce } from '../hooks/useNightTruce'

const HARDWARE_ICONS = {
  ram: MemoryStick,
  gps: ShieldCheck,
  crypto_nic: Navigation,
  heuristic: Cpu,
}

export default function GameHeader({
  activeSlot,
  isBlocked,
  threats = [],
  onAbort,
  traveling = false,
  travelRemainingMs = 0,
  travelTotalMs = 30_000,
  travelLabel = null,
  onAbortTravel = null,
  onOpenLoadout = null,
  onOpenAbilities = null,
  onOpenArchive = null,
  onOpenRulebook = null,
  onOpenDirectory = null,
  onConcludeMatch = null,
  concluding = false,
  isHost = false,
  executorGigs = [],
  servers = [],
}) {
  const { profile, signOut } = useAuth()
  const { playClick } = useAudio()
  const { active: nightTruce } = useNightTruce()
  const [now, setNow] = useState(Date.now())
  const [aborting, setAborting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const showCloseCycle = Boolean(isHost && onConcludeMatch)

  function requestCloseCycle() {
    if (!showCloseCycle || concluding) return
    if (!window.confirm(CONFIRM_CLOSE_CYCLE)) return
    playClick()
    void onConcludeMatch()
  }

  useEffect(() => {
    const stealthed = stealthRemainingMs(profile) > 0
    const hasGigTimer = executorGigs.some((g) => g.deadline)
    const hasClassTimer = Boolean(
      profile?.kick_immune_until ||
        profile?.nda_until ||
        profile?.frozen_until ||
        profile?.spoof_until,
    )
    if (
      !activeSlot?.end_time &&
      threats.length === 0 &&
      !traveling &&
      !stealthed &&
      !hasGigTimer &&
      !hasClassTimer
    ) {
      return
    }
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [
    activeSlot?.end_time,
    activeSlot?.id,
    threats.length,
    traveling,
    profile?.stealth_until,
    profile?.kick_immune_until,
    profile?.nda_until,
    profile?.frozen_until,
    profile?.spoof_until,
    executorGigs,
  ])

  const stealthMs = stealthRemainingMs(profile, now)

  if (!profile) return null

  const busy = Boolean(
    profile.status === 'busy' &&
      activeSlot?.user_id === profile.id &&
      activeSlot?.action_type &&
      activeSlot?.end_time,
  )
  const { progress, remainingMs } = busy
    ? actionProgress(activeSlot, now)
    : { progress: 0, remainingMs: 0 }
  const busyIcon = busy ? getActionIcon(activeSlot.action_type) : null
  const logo = factionLogo(profile.faction)
  const classIcon = roleIcon(profile.role)

  async function handleAbort() {
    if (!onAbort || aborting) return
    setAborting(true)
    await onAbort()
    setAborting(false)
  }

  return (
    <>
    <header className="sticky top-0 z-20 border-b border-zinc-800/90 bg-zinc-950/85 backdrop-blur-md">
      {nightTruce && (
        <div className="border-b border-red-500/40 bg-red-950/90 px-4 py-2 text-center">
          <p className="font-display text-xs uppercase tracking-[0.28em] text-red-300">
            [ OFFLINE MODE - NIGHT TRUCE ACTIVE ]
          </p>
          <p className="mt-0.5 text-xs text-red-400/80">
            Manutenzione 23:00–08:00 · Europe/Rome · Trace/Kick solo su ops già
            in corso
          </p>
        </div>
      )}
      <div className="mx-auto max-w-6xl px-4 py-2">
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3">
              <img
                src="/logo.png"
                alt="Zero Trust Logo"
                className="h-10 w-auto shrink-0 rounded-md object-contain shadow-md md:h-12 lg:h-16"
              />
              <div className="min-w-0 flex-1">
                <p className="sr-only">Zero Trust</p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-bold uppercase tracking-wide text-zinc-100 sm:text-base md:text-lg">
                    {profile.name}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-2">
                    {logo ? (
                      <img
                        src={logo}
                        alt={factionBarTag(profile.faction)}
                        title={factionBarTag(profile.faction)}
                        className="h-6 w-6 rounded-sm object-contain"
                      />
                    ) : (
                      <span
                        className={`font-display text-xs uppercase tracking-[0.18em] ${factionBarClass(profile.faction)}`}
                      >
                        [{factionBarTag(profile.faction)}]
                      </span>
                    )}
                    {profile.role && (
                      <>
                        {classIcon && (
                          <img
                            src={classIcon}
                            alt=""
                            className="h-6 w-6 rounded-sm object-contain"
                          />
                        )}
                        <span className="text-xs font-normal uppercase tracking-wider text-slate-400">
                          {roleLabel(profile.role)}
                        </span>
                      </>
                    )}
                  </span>
                  {isBlocked && (
                    <span className="ml-2 shrink-0 text-xs font-normal uppercase tracking-wider text-red-400">
                      BLOCKED
                    </span>
                  )}
                  {traveling && (
                    <span className="ml-2 hidden shrink-0 text-xs font-normal uppercase tracking-wider text-fuchsia-400/90 md:inline">
                      TRAVELING
                    </span>
                  )}
                  {busy && (
                    <span className="ml-2 hidden shrink-0 text-xs font-normal uppercase tracking-wider text-amber-400/90 md:inline">
                      BUSY · {activeSlot.action_type}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1 md:hidden">
              <DebugPanel />
              <ChromeButton
                icon={Settings}
                label="Settings"
                title="Impostazioni"
                onClick={() => setSettingsOpen(true)}
              />
              <ChromeButton
                icon={LogOut}
                label="Logout"
                title="Logout"
                onClick={signOut}
              />
            </div>

            <div className="hidden shrink-0 items-center gap-1.5 md:flex">
              <HeaderStats profile={profile} />
              <ChromeButton
                icon={Settings}
                label="Settings"
                title="Impostazioni"
                onClick={() => setSettingsOpen(true)}
                showLabel
              />
              <ChromeButton
                icon={LogOut}
                label="Logout"
                title="Logout"
                onClick={signOut}
                showLabel
              />
            </div>
          </div>

          <div className="hidden flex-wrap items-center gap-1.5 md:flex">
            {onOpenArchive && profile.role === 'analyst' && (
              <NavChip
                icon={Archive}
                label="Archivio Intel"
                title="Archivio Intel"
                tone="cyan"
                onClick={() => {
                  playClick()
                  onOpenArchive()
                }}
              />
            )}
            {onOpenDirectory && (
              <NavChip
                icon={Users}
                label="Utenti"
                title="Directory di Rete"
                tone="cyan"
                onClick={() => {
                  playClick()
                  onOpenDirectory()
                }}
              />
            )}
            {onOpenAbilities && (
              <NavChip
                icon={IdCard}
                label="Personaggio"
                title="Profilo Personaggio"
                tone="amber"
                onClick={() => {
                  playClick()
                  onOpenAbilities()
                }}
              />
            )}
            {onOpenLoadout && (
              <NavChip
                icon={Backpack}
                label="Loadout"
                title="Inventario / Loadout"
                tone="fuchsia"
                onClick={() => {
                  playClick()
                  onOpenLoadout()
                }}
              />
            )}
            <NavChip
              icon={BookOpen}
              label="Regolamento"
              title="Regolamento"
              tone="cyan"
              onClick={() => {
                playClick()
                onOpenRulebook?.()
              }}
            />
            {showCloseCycle && (
              <NavChip
                icon={Flag}
                label="Chiudi ciclo"
                title="Concludi la partita e vai alla schermata di fine ciclo"
                tone="red"
                disabled={concluding}
                onClick={requestCloseCycle}
              />
            )}
            <DebugPanel />
          </div>

          <div className="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap md:hidden">
            <HeaderStats profile={profile} />
            {showCloseCycle && (
              <NavChip
                icon={Flag}
                label="Chiudi ciclo"
                title="Concludi la partita"
                tone="red"
                disabled={concluding}
                onClick={requestCloseCycle}
              />
            )}
          </div>
        </div>

        {executorGigs.length > 0 && (
          <div className="mt-3">
            <GigObjectiveBanner
              gigs={executorGigs}
              catalogs={{ servers }}
              now={now}
            />
          </div>
        )}

        <ActiveStatus
          equippedIds={parseEquippedHardware(profile.equipped_hardware)}
          stealthMs={stealthMs}
          heat={profile.heat ?? 0}
          inventory={profile.inventory}
          profile={profile}
          now={now}
        />

        {traveling && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 uppercase tracking-wider text-fuchsia-400/80">
                <Timer className="h-3.5 w-3.5" />
                Connecting / Travel
                {travelLabel ? ` · ${travelLabel}` : ''}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-display text-fuchsia-300">
                  {formatRemaining(travelRemainingMs)}
                </span>
                {onAbortTravel && (
                  <button
                    type="button"
                    onClick={() => void onAbortTravel()}
                    className="text-xs uppercase tracking-wider text-zinc-400 hover:text-red-300"
                  >
                    Annulla
                  </button>
                )}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden bg-zinc-800">
              <div
                className="h-full bg-fuchsia-400 transition-[width] duration-200 ease-linear"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round(
                      ((travelTotalMs - travelRemainingMs) /
                        Math.max(1, travelTotalMs)) *
                        100,
                    ),
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {busy && (
          <div className="mt-3 border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-row items-center gap-3">
                {busyIcon && (
                  <img
                    src={busyIcon.src}
                    alt={busyIcon.alt}
                    className={`h-10 w-10 shrink-0 object-contain sm:h-12 sm:w-12 ${busyIcon.glowClass}`}
                  />
                )}
                <div className="flex min-w-0 flex-col text-left">
                  <span
                    className={`font-display text-sm font-bold uppercase tracking-wide sm:text-lg ${
                      busyIcon?.labelClass ?? 'text-amber-200'
                    }`}
                  >
                    {busyIcon?.label ?? activeSlot.action_type} in corso
                  </span>
                  <span className="text-xs text-zinc-400">
                    Slot {activeSlot.slot_id} · Completamento tra{' '}
                    {formatRemaining(remainingMs)}
                    {activeSlot.is_immune ? ' · SCUDO ATTIVO' : ''}
                  </span>
                </div>
              </div>
              <span
                className={`shrink-0 font-display text-sm ${
                  busyIcon?.labelClass ?? 'text-amber-300'
                }`}
              >
                {formatRemaining(remainingMs)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden bg-zinc-800">
              <div
                className={`h-full transition-[width] duration-200 ease-linear ${
                  busyIcon?.barClass ?? 'bg-amber-400'
                }`}
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        <ThreatAlertBanner
          threats={threats}
          onAbort={busy ? handleAbort : null}
          aborting={aborting}
        />
      </div>
    </header>
    <SettingsModal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
    />
    </>
  )
}

function HeaderStats({ profile }) {
  return (
    <>
      <StatTooltip
        text={reputationTooltip(profile.reputation ?? 3)}
        align="right"
      >
        <Metric
          icon={Star}
          label="Rep"
          value={`${profile.reputation ?? 3}/5`}
          accent="text-amber-200"
          className="cursor-help"
        />
      </StatTooltip>
      <Metric
        icon={Coins}
        label="Creds"
        value={`${profile.creds} ₵`}
        accent="text-amber-300"
      />
      <Metric
        icon={Zap}
        label="PA"
        value={`${profile.pa} / ${PA_MAX}`}
        accent="text-cyan-300"
      />
    </>
  )
}

const NAV_TONES = {
  cyan: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20',
  amber:
    'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20',
  fuchsia:
    'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20',
  red: 'border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20',
}

function NavChip({ icon: Icon, label, title, tone, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center gap-1.5 border px-1.5 py-1.5 text-xs uppercase tracking-wider transition lg:px-2 disabled:cursor-not-allowed disabled:opacity-50 ${NAV_TONES[tone]}`}
      title={title}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden lg:inline">{label}</span>
    </button>
  )
}

function ChromeButton({
  icon: Icon,
  label,
  title,
  onClick,
  showLabel = false,
}) {
  const { playClick } = useAudio()
  return (
    <button
      type="button"
      onClick={(event) => {
        playClick()
        onClick?.(event)
      }}
      className="inline-flex shrink-0 items-center gap-1.5 border border-zinc-700 px-2 py-1.5 text-xs uppercase tracking-wider text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
      title={title}
    >
      <Icon className="h-3.5 w-3.5" />
      {showLabel ? (
        <span className="hidden lg:inline">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </button>
  )
}

function Metric({ icon: Icon, label, value, accent, className = '' }) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 border border-zinc-700/80 bg-zinc-900/80 px-2 py-1 sm:px-2.5 ${className}`}
    >
      <Icon className={`h-3.5 w-3.5 ${accent}`} strokeWidth={1.75} />
      <div className="text-left leading-tight">
        <p className="text-xs uppercase tracking-wider text-zinc-500">
          {label}
        </p>
        <p className={`text-sm font-medium ${accent}`}>{value}</p>
      </div>
    </div>
  )
}

function remainingUntil(iso, now) {
  if (!iso) return 0
  return Math.max(0, new Date(iso).getTime() - now)
}

function ActiveStatus({ equippedIds = [], stealthMs, heat, inventory, profile, now }) {
  const equippedItems = (equippedIds ?? [])
    .map((id) => getCatalogItem(id))
    .filter(Boolean)
  const heatPoints = Math.max(0, Math.min(HEAT_MAX, Number(heat) || 0))
  const passives = inventoryPassives(inventory)

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-2">
      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
        Status
      </p>

      {equippedItems.length === 0 ? (
        <span
          className="inline-flex items-center gap-1.5 border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-xs uppercase tracking-wider text-zinc-600"
          title="Nessun hardware equipaggiato"
        >
          <Cpu className="h-3 w-3" />
          No HW
        </span>
      ) : (
        equippedItems.map((hw) => {
          const HwIcon = HARDWARE_ICONS[hw.id] ?? Cpu
          return (
            <span
              key={hw.id}
              className="inline-flex items-center gap-1.5 border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-xs uppercase tracking-wider text-cyan-200"
              title={hw.blurb}
            >
              {hw.image ? (
                <img src={hw.image} alt="" className="h-4 w-4 object-contain" />
              ) : (
                <HwIcon className="h-3 w-3" />
              )}
              {hw.name}
            </span>
          )
        })
      )}

      {passives.map((item) => {
        const Icon = item.id === 'bailout' ? Shield : Lock
        const label = item.statusLabel ?? item.name
        return (
          <span
            key={item.id}
            className="inline-flex items-center gap-1.5 border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs uppercase tracking-wider text-emerald-200"
            title={`${item.name} — attivazione automatica`}
          >
            <Icon className="h-3 w-3" />
            {label}
            {item.count > 1 ? ` ×${item.count}` : ''}
          </span>
        )
      })}

      {profile?.has_legal_shield && (
        <span
          className="inline-flex items-center gap-1.5 border border-blue-500/50 bg-blue-500/10 px-2 py-1 text-xs uppercase tracking-wider text-blue-200"
          title="La prossima operazione base (Attacco, Difesa, Farming) è protetta dai Kick"
        >
          <Shield className="h-3 w-3" />
          [SCUDO LEGALE]
        </span>
      )}
      {remainingUntil(profile?.kick_immune_until, now) > 0 && (
        <span className="inline-flex items-center gap-1.5 border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs uppercase tracking-wider text-amber-200">
          <Shield className="h-3 w-3" />
          Immunity {formatRemaining(remainingUntil(profile.kick_immune_until, now))}
        </span>
      )}
      {remainingUntil(profile?.frozen_until, now) > 0 && (
        <span className="inline-flex items-center gap-1.5 border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-xs uppercase tracking-wider text-cyan-200">
          <Snowflake className="h-3 w-3" />
          Freeze {formatRemaining(remainingUntil(profile.frozen_until, now))}
        </span>
      )}
      {remainingUntil(profile?.nda_until, now) > 0 && (
        <span className="inline-flex items-center gap-1.5 border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-xs uppercase tracking-wider text-fuchsia-200">
          <Lock className="h-3 w-3" />
          NDA {formatRemaining(remainingUntil(profile.nda_until, now))}
        </span>
      )}
      {remainingUntil(profile?.spoof_until, now) > 0 && (
        <span className="inline-flex items-center gap-1.5 border border-zinc-500/40 bg-zinc-800/80 px-2 py-1 text-xs uppercase tracking-wider text-zinc-200">
          <EyeOff className="h-3 w-3" />
          Spoof {formatRemaining(remainingUntil(profile.spoof_until, now))}
        </span>
      )}

      {stealthMs > 0 && (
        <span
          className="inline-flex items-center gap-1.5 border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs uppercase tracking-wider text-emerald-200"
          title="Wiper Scrubber"
        >
          <EyeOff className="h-3 w-3" />
          Wiper {formatRemaining(stealthMs)}
        </span>
      )}

      <StatTooltip text={heatTooltip(heatPoints)} align="left">
        <span
          className={`inline-flex cursor-help items-center gap-1.5 border px-2 py-1 text-xs uppercase tracking-wider ${
            heatPoints > 0
              ? 'border-red-500/40 bg-red-500/10 text-red-200'
              : 'border-zinc-800 bg-zinc-900/60 text-zinc-500'
          }`}
        >
          <span className="inline-flex items-center gap-0.5">
            {Array.from({ length: HEAT_MAX }, (_, i) => (
              <Skull
                key={i}
                className={`h-3 w-3 ${
                  i < heatPoints ? 'text-red-400' : 'text-zinc-700'
                }`}
              />
            ))}
          </span>
          Sospetto {heatPoints}/{HEAT_MAX}
        </span>
      </StatTooltip>
    </div>
  )
}
