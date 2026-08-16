import { Backpack, BookOpen, IdCard, Map, Users, Wine } from 'lucide-react'
import { useAudio } from '../hooks/useAudio'

const ITEMS = [
  { id: 'map', label: 'Mappa', icon: Map },
  { id: 'directory', label: 'Utenti', icon: Users },
  { id: 'abilities', label: 'Profilo', icon: IdCard },
  { id: 'loadout', label: 'Loadout', icon: Backpack },
  { id: 'hub', label: 'Hub', icon: Wine },
  { id: 'rulebook', label: 'Regole', icon: BookOpen },
]

export default function MobileBottomNav({
  active = 'map',
  onMap,
  onDirectory,
  onAbilities,
  onLoadout,
  onHub,
  onRulebook,
}) {
  const { playClick } = useAudio()
  const handlers = {
    map: onMap,
    directory: onDirectory,
    abilities: onAbilities,
    loadout: onLoadout,
    hub: onHub,
    rulebook: onRulebook,
  }

  return (
    <nav
      className="fixed right-0 bottom-0 left-0 z-50 flex items-center justify-around border-t border-zinc-800 bg-zinc-950 p-2 pb-safe md:hidden"
      aria-label="Navigazione principale"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon
        const isActive = active === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              playClick()
              handlers[item.id]?.()
            }}
            aria-current={isActive ? 'page' : undefined}
            className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1 ${
              isActive ? 'text-cyan-300' : 'text-zinc-500'
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={isActive ? 2 : 1.6} />
            <span className="text-[10px] font-medium uppercase tracking-wider">
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
