import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SearchBox } from '../components/SearchBox'
import { MapPlate } from '../components/MapPlate'
import { MostHunted } from '../components/MostHunted'
import { Seo, websiteJsonLd, organizationJsonLd } from '../lib/seo'

export function HomePage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-14">
      <Seo path="/" jsonLd={[websiteJsonLd(), organizationJsonLd()]} />

      {/* Hero — text + search on the left, the framed map plate on the right.
          Two balanced columns so the copy and the map fill the width and sit
          close together instead of drifting apart on the wide page. */}
      <section className="grid items-center gap-8 lg:grid-cols-2 lg:gap-10">
        <div>
          <p className="font-title text-sm uppercase tracking-[0.3em] text-accent">
            <span aria-hidden="true">✦ </span>
            {t('home.atlasKicker')}
            <span aria-hidden="true"> ✦</span>
          </p>
          <h1 className="mt-4 font-title text-5xl font-semibold leading-[1.05] text-fg sm:text-6xl xl:text-7xl">
            {t('home.heroTitle')}
          </h1>
          <p className="mt-6 max-w-xl text-lg italic leading-relaxed text-fg-dim xl:text-xl">
            {t('home.heroLead')}
          </p>

          <div className="mt-8 max-w-xl">
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

      {/* The dashboard's rotating creature orbit — real "most hunted" data. */}
      <MostHunted />
    </div>
  )
}
