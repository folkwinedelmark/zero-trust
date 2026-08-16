/**
 * Valore finale + breakdown colorato dei soli modificatori attivi.
 * Senza bonus: (Valore base). Con bonus: (50 base • +75% Exec • +30% RAM).
 */
export default function StatBreakdown({
  value,
  valueClass = 'text-slate-200',
  prefix,
  suffix,
  baseLabel,
  modifiers = [],
  emptyLabel = 'Valore base',
  className = '',
}) {
  const hasMods = modifiers.length > 0

  return (
    <span className={`text-sm text-slate-300 ${className}`}>
      {prefix ? <span className="text-slate-500">{prefix} </span> : null}
      <span className={`font-semibold ${valueClass}`}>{value}</span>
      {suffix ? <span className="text-slate-400"> {suffix}</span> : null}
      <span className="ml-1 text-xs text-slate-500">
        (
        {hasMods ? (
          <>
            <span className="text-slate-400">{baseLabel}</span>
            {modifiers.map((mod) => (
              <span key={`${mod.label}-${mod.value}`}>
                {' • '}
                <span className={mod.colorClass}>
                  {mod.value} {mod.label}
                </span>
              </span>
            ))}
          </>
        ) : (
          emptyLabel
        )}
        )
      </span>
    </span>
  )
}
