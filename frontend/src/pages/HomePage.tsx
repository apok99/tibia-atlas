import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SearchBox } from '../components/SearchBox'
import { MapPlate } from '../components/MapPlate'
import { Seo, websiteJsonLd, organizationJsonLd } from '../lib/seo'

const chapters: { num: string; to: string; titleKey: string; descKey: string; lead: boolean }[] = [
  { num: 'I', to: '/map', titleKey: 'nav.map', descKey: 'home.chapMapDesc', lead: true },
  { num: 'II', to: '/browse/creature', titleKey: 'nav.bestiary', descKey: 'home.chapBestiaryDesc', lead: false },
  { num: 'III', to: '/history', titleKey: 'nav.library', descKey: 'home.chapLibraryDesc', lead: false },
]

export function HomePage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-14">
      <Seo path="/" jsonLd={[websiteJsonLd(), organizationJsonLd()]} />

      {/* Hero — text + search on the left, the framed map plate on the right. */}
      <section className="grid items-start gap-10 lg:grid-cols-[1fr_minmax(0,32rem)]">
        <div className="max-w-xl">
          <p className="font-title text-xs uppercase tracking-[0.28em] text-accent">
            <span aria-hidden="true">✦ </span>
            {t('home.atlasKicker')}
            <span aria-hidden="true"> ✦</span>
          </p>
          <h1 className="mt-4 font-title text-4xl font-semibold leading-[1.08] text-fg sm:text-6xl">
            {t('home.heroTitle')}
          </h1>
          <p className="mt-5 max-w-md text-lg italic leading-relaxed text-fg-dim">
            {t('home.heroLead')}
          </p>

          <div className="mt-7 max-w-md">
            <SearchBox placeholder={t('home.searchHero')} />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/map" className="btn">
              {t('home.exploreMap')} <span aria-hidden="true">↗</span>
            </Link>
            <Link to="/browse/creature" className="btn-quill">
              {t('home.exploreBestiary')}
            </Link>
          </div>
        </div>

        <MapPlate />
      </section>

      {/* Bestiordle — the daily creature game, featured on the home. */}
      <Link
        to="/wordle"
        className="atlas-plate group flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:gap-6"
      >
        <span className="grid shrink-0 grid-cols-3 gap-1" aria-hidden="true">
          {['bg-canon', 'bg-theory', 'bg-line-2', 'bg-line-2', 'bg-canon', 'bg-theory'].map((c, i) => (
            <span key={i} className={`h-5 w-5 rounded-[2px] ${c}`} />
          ))}
        </span>
        <div className="flex-1">
          <p className="font-title text-[11px] uppercase tracking-[0.2em] text-accent">
            {t('wordle.kicker')}
          </p>
          <h3 className="mt-1 font-title text-xl uppercase tracking-[0.06em] text-fg">
            {t('wordle.brand')}
          </h3>
          <p className="mt-1 text-sm italic leading-relaxed text-fg-dim">{t('wordle.subtitle')}</p>
        </div>
        <span className="btn shrink-0">
          {t('wordle.play')} <span aria-hidden="true">→</span>
        </span>
      </Link>

      {/* The chapters — few, clear sections, like a book's table of contents. */}
      <section>
        <div className="mb-5 flex items-center gap-3">
          <span className="h-1.5 w-1.5 rotate-45 bg-accent" aria-hidden="true" />
          <h2 className="font-title text-sm uppercase tracking-[0.18em] text-fg">
            {t('home.chapters')}
          </h2>
          <span className="rule-gilt flex-1" />
        </div>
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
    </div>
  )
}
