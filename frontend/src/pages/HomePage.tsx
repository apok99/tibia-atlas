import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SearchBox } from '../components/SearchBox'
import { WorldGlobe } from '../components/WorldGlobe'
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

      {/* Hero — search on the left, a draggable world globe on the right. Two
          in-flow columns so the globe is never clipped. */}
      <section className="grid items-center gap-6 lg:min-h-[58vh] lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-4">
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

        {/* Globe — desktop (in flow, fully visible). */}
        <div className="hidden justify-self-end lg:block">
          <WorldGlobe diameter={520} />
          <p className="mt-1 text-center text-[11px] italic text-fg-mute">arrástrame</p>
        </div>

        {/* Globe — below lg, centred under the text. */}
        <div className="flex flex-col items-center lg:hidden">
          <WorldGlobe diameter={320} />
          <p className="mt-2 text-[11px] italic text-fg-mute">arrástrame</p>
        </div>
      </section>

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
