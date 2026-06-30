import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEntries } from '../hooks/useEntries'
import { EntryCard } from '../components/EntryCard'
import { EntryGridSkeleton } from '../components/Skeleton'
import { Seo, collectionJsonLd } from '../lib/seo'
import type { EntryListItem } from '../types'

/**
 * Recommended-level progression brackets. Quests are sorted into the first
 * tier whose `max` they fall under (ascending), so the page reads like a
 * level-by-level guide: where you should be at lvl 1, 50, 100, 130+.
 */
const TIERS: { key: string; max: number }[] = [
  { key: 'beginner', max: 50 },
  { key: 'intermediate', max: 100 },
  { key: 'advanced', max: 130 },
  { key: 'endgame', max: Infinity },
]

type AccessFilter = 'all' | 'Free' | 'Premium'

export function QuestsPage() {
  const { t } = useTranslation()
  // One page is plenty — the curated quest set is small. Pull the max.
  const { data, isLoading } = useEntries({ type: 'quest', per_page: 60 })

  const [q, setQ] = useState('')
  const [access, setAccess] = useState<AccessFilter>('all')

  // Apply the search + access controls, then bucket the survivors into level
  // tiers, each sorted by recommended level ascending. Quests with no level
  // fall into the last ("endgame") tier so they're never silently dropped.
  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const buckets = new Map<string, EntryListItem[]>(TIERS.map((tier) => [tier.key, []]))
    for (const quest of data?.data ?? []) {
      if (access !== 'all' && quest.access !== access) continue
      if (needle && !(quest.name ?? '').toLowerCase().includes(needle)) continue
      const lvl = quest.recommended_level ?? Infinity
      const tier = TIERS.find((candidate) => lvl < candidate.max) ?? TIERS[TIERS.length - 1]
      buckets.get(tier.key)!.push(quest)
    }
    for (const list of buckets.values()) {
      list.sort((a, b) => (a.recommended_level ?? Infinity) - (b.recommended_level ?? Infinity))
    }
    return buckets
  }, [data, q, access])

  const total = useMemo(
    () => [...grouped.values()].reduce((sum, list) => sum + list.length, 0),
    [grouped],
  )

  const accessOptions: AccessFilter[] = ['all', 'Free', 'Premium']

  return (
    <div>
      <Seo
        title={t('quests.title')}
        description={t('quests.intro')}
        path="/quests"
        jsonLd={collectionJsonLd({ name: t('quests.title'), description: t('quests.intro'), path: '/quests' })}
      />
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest text-accent">{t('quests.kicker')}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-black tracking-tight text-fg">
          {t('quests.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-fg-mute">{t('quests.intro')}</p>
      </header>

      {/* Controls — filter the level-grouped guide by name and access. */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('quests.searchPlaceholder')}
          className="w-full rounded-md border border-line bg-surface px-4 py-2 text-sm text-fg outline-none placeholder:text-fg-mute focus:border-accent/60 sm:w-72"
        />
        <div className="flex items-center gap-1.5">
          {accessOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => setAccess(opt)}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                access === opt
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line text-fg-mute hover:border-line-2 hover:text-fg'
              }`}
            >
              {t(`quests.access.${opt}`)}
            </button>
          ))}
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-fg-mute sm:ml-auto">
          {t('quests.count', { count: total })}
        </span>
      </div>

      {isLoading ? (
        <EntryGridSkeleton count={9} />
      ) : total === 0 ? (
        <p className="text-fg-mute">{t('quests.empty')}</p>
      ) : (
        <div className="space-y-12">
          {TIERS.map((tier) => {
            const quests = grouped.get(tier.key) ?? []
            if (quests.length === 0) return null
            return (
              <section key={tier.key}>
                <div className="mb-4 flex items-baseline gap-3 border-b border-line pb-2">
                  <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-fg">
                    <span className="h-5 w-1.5 rounded-full bg-accent" />
                    {t(`quests.tier.${tier.key}`)}
                  </h2>
                  <span className="text-xs font-bold uppercase tracking-wider text-fg-mute">
                    {t(`quests.range.${tier.key}`)}
                  </span>
                  <span className="ml-auto text-xs font-bold uppercase tracking-wider text-fg-mute">
                    {t('quests.count', { count: quests.length })}
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {quests.map((quest) => (
                    <EntryCard key={quest.id} entry={quest} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
