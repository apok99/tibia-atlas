import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePopular } from '../hooks/useEntries'
import { EntryCard } from '../components/EntryCard'
import { EntryCardSkeleton } from '../components/Skeleton'
import { DiscoverCarousel } from '../components/DiscoverCarousel'
import { HomeKillStats } from '../components/HomeKillStats'
import { SearchBox } from '../components/SearchBox'
import type { EntryType } from '../types'

const categories: EntryType[] = [
  'creature', 'character', 'city', 'organization', 'quest', 'event', 'location', 'item',
]

export function HomePage() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<EntryType | undefined>(undefined)
  const popular = usePopular({ type: filter, per_page: 12 })

  return (
    <div className="space-y-12">
      {/* Hero — Google-style: centered logo, one big search, minimal chrome. */}
      <section className="flex flex-col items-center px-4 pt-8 pb-2 text-center sm:pt-12">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
          <span className="text-accent">Tibia</span> Atlas
        </h1>
        <p className="mt-3 max-w-xl text-sm text-fg-mute">{t('home.heroSubtitle')}</p>

        <div className="mt-7 w-full max-w-xl">
          <SearchBox placeholder={t('home.searchHero')} />
        </div>
      </section>

      <DiscoverCarousel />

      <HomeKillStats />

      {/* Most popular — all-time, filterable by category. */}
      <section>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-fg">{t('home.popular')}</h2>
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <FilterChip active={!filter} onClick={() => setFilter(undefined)}>
            {t('home.allCategories')}
          </FilterChip>
          {categories.map((c) => (
            <FilterChip key={c} active={filter === c} onClick={() => setFilter(c)}>
              {t(`types.${c}`)}
            </FilterChip>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {popular.isLoading
            ? Array.from({ length: 6 }).map((_, i) => <EntryCardSkeleton key={i} />)
            : popular.data?.data.map((e) => <EntryCard key={e.id} entry={e} />)}
        </div>

        {!popular.isLoading && !popular.data?.data.length && (
          <p className="py-8 text-center text-sm text-fg-mute">{t('browse.empty')}</p>
        )}
      </section>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
        active
          ? 'border-accent bg-accent text-white'
          : 'border-line bg-surface text-fg-dim hover:border-line-2 hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}
