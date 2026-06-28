import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFacets } from '../hooks/useEntries'

interface Props {
  type?: string
  classification: string
  boss: string
  onClassificationChange: (value: string) => void
  onBossChange: (value: string) => void
  onClear: () => void
}

/** Filter bar for the bestiary: creature type (classification) + boss rank. */
export function BestiaryFilters({
  type,
  classification,
  boss,
  onClassificationChange,
  onBossChange,
  onClear,
}: Props) {
  const { t } = useTranslation()
  const { data: facets } = useFacets(type)

  // Facets come sorted by count; sort alphabetically so the long dropdown is scannable.
  const classifications = useMemo(
    () => [...(facets?.classifications ?? [])].sort((a, b) => a.value.localeCompare(b.value)),
    [facets],
  )

  const hasActiveFilter = !!classification || boss === '0' || boss === '1'

  const rankOptions: { value: string; label: string; count?: number }[] = [
    { value: '', label: t('filters.all') },
    { value: '1', label: t('filters.bossesOnly'), count: facets?.bosses },
    { value: '0', label: t('filters.regularOnly') },
  ]

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      {/* Creature type */}
      <label className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-fg-mute">
          {t('filters.classification')}
        </span>
        <select
          value={classification}
          onChange={(e) => onClassificationChange(e.target.value)}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-accent/60"
        >
          <option value="">{t('filters.allClassifications')}</option>
          {classifications.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value} ({c.count})
            </option>
          ))}
        </select>
      </label>

      {/* Boss rank — segmented control */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-fg-mute">
          {t('filters.rank')}
        </span>
        <div className="inline-flex overflow-hidden rounded-md border border-line">
          {rankOptions.map((opt, i) => (
            <button
              key={opt.value || 'all'}
              type="button"
              onClick={() => onBossChange(opt.value)}
              className={`px-3 py-1.5 text-sm font-semibold transition ${i > 0 ? 'border-l border-line' : ''} ${
                boss === opt.value
                  ? 'bg-accent/15 text-accent'
                  : 'bg-surface text-fg-dim hover:text-fg'
              }`}
            >
              {opt.label}
              {opt.count != null && <span className="ml-1 text-xs opacity-70">{opt.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {hasActiveFilter && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-bold uppercase tracking-wider text-fg-mute underline-offset-2 transition hover:text-accent hover:underline"
        >
          {t('filters.clear')}
        </button>
      )}
    </div>
  )
}
