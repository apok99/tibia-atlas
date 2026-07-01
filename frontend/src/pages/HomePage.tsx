import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePopular } from '../hooks/useEntries'
import { EntryCard } from '../components/EntryCard'
import { EntryCardSkeleton } from '../components/Skeleton'
import { MapPreview } from '../components/MapPreview'
import { SearchBox } from '../components/SearchBox'
import { Seo, websiteJsonLd, organizationJsonLd } from '../lib/seo'
import type { EntryType } from '../types'

const categories: EntryType[] = [
  'creature', 'character', 'city', 'organization', 'quest', 'event', 'location', 'item',
]

const chapters: { num: string; to: string; titleKey: string; descKey: string; lead: boolean }[] = [
  { num: 'I', to: '/map', titleKey: 'nav.map', descKey: 'home.chapMapDesc', lead: true },
  { num: 'II', to: '/browse/creature', titleKey: 'nav.bestiary', descKey: 'home.chapBestiaryDesc', lead: false },
  { num: 'III', to: '/history', titleKey: 'nav.library', descKey: 'home.chapLibraryDesc', lead: false },
]

export function HomePage() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<EntryType | undefined>(undefined)
  const popular = usePopular({ type: filter, per_page: 12 })

  return (
    <div className="space-y-14">
      <Seo path="/" jsonLd={[websiteJsonLd(), organizationJsonLd()]} />

      {/* Hero — an atlas frontispiece. Kicker, big serif title, quill search. */}
      <section className="pt-4 text-center sm:pt-8">
        <p className="font-title text-xs uppercase tracking-[0.28em] text-accent">
          <span aria-hidden="true">✦ </span>
          {t('home.atlasKicker')}
          <span aria-hidden="true"> ✦</span>
        </p>
        <h1 className="mx-auto mt-4 max-w-3xl font-title text-4xl font-semibold leading-[1.1] text-fg sm:text-6xl">
          {t('home.heroTitle')}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg italic leading-relaxed text-fg-dim">
          {t('home.heroLead')}
        </p>

        <div className="mx-auto mt-7 w-full max-w-xl">
          <SearchBox placeholder={t('home.searchHero')} />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link to="/map" className="btn">
            {t('home.exploreMap')} <span aria-hidden="true">↗</span>
          </Link>
          <Link to="/browse/creature" className="btn-quill">
            {t('home.exploreBestiary')}
          </Link>
        </div>

        <div className="rule-gilt mx-auto mt-10 max-w-md" />
      </section>

      {/* The map — the star of the atlas. */}
      <MapPreview />

      {/* The chapters — few, clear sections, like a book's table of contents. */}
      <section>
        <SectionHeading>{t('home.chapters')}</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-3">
          {chapters.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="atlas-plate group flex flex-col p-5 transition hover:-translate-y-0.5"
              style={{ borderColor: c.lead ? 'var(--color-accent)' : undefined }}
            >
              <span
                className="font-title text-4xl leading-none"
                style={{ color: c.lead ? 'var(--color-accent)' : 'var(--color-gold)' }}
              >
                {c.num}
              </span>
              <h3 className="mt-3 font-title text-base uppercase tracking-[0.08em] text-fg">
                {t(c.titleKey)}
              </h3>
              <p className="mt-2 text-sm italic leading-relaxed text-fg-dim">{t(c.descKey)}</p>
              <span className="small-caps mt-4 inline-flex items-center gap-1.5 font-medium text-accent">
                {t('home.readMore')}
                <span className="transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Most popular — all-time, filterable by category. */}
      <section>
        <SectionHeading>{t('home.popular')}</SectionHeading>

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
          <p className="py-8 text-center text-sm italic text-fg-mute">{t('browse.empty')}</p>
        )}
      </section>
    </div>
  )
}

/** Section eyebrow: a seal-red diamond, serif small-caps title, gilt rule. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="h-1.5 w-1.5 rotate-45 bg-accent" aria-hidden="true" />
      <h2 className="font-title text-sm uppercase tracking-[0.18em] text-fg">{children}</h2>
      <span className="rule-gilt flex-1" />
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
      className={`chip font-medium ${
        active
          ? 'border-accent bg-accent text-[color:var(--color-surface)]'
          : 'hover:border-line-2 hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}
