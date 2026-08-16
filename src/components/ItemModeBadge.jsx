import { isSoftwareItem } from '../lib/afterlifeCatalog'

/** Tag ATTIVO / PASSIVO sulle card software (Market e Loadout). */
export default function ItemModeBadge({ item, className = '' }) {
  if (!item || !isSoftwareItem(item.id)) return null
  const passive = Boolean(item.passive)
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
        passive
          ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : 'border border-orange-500/40 bg-orange-500/10 text-orange-300'
      } ${className}`}
    >
      {passive ? 'Passivo' : 'Attivo'}
    </span>
  )
}
