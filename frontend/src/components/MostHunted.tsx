import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useKillRanking, useKillOverview } from '../hooks/useKillStats'
import { CreatureOrbit } from './CreatureOrbit'

/**
 * The most-hunted creatures across every Tibia world (24h) shown as the
 * dashboard's rotating creature orbit inside a boxed panel, with explanatory
 * text beside it — real, un-fakeable CipSoft data.
 */
export function MostHunted() {
  const { t } = useTranslation()
  const { data: rows } = useKillRanking({ world: 'all', metric: 'killed', window: 'day', limit: 10 })
  const { data: overview } = useKillOverview('all')

  const items = (rows ?? []).map((r) => ({
    race: r.race,
    killed: r.killed,
    image: r.image,
    slug: r.slug,
  }))
  const total = overview?.totals.killed_24h ?? 0

  return (
    <section className="atlas-plate overflow-hidden">
      <div className="flex flex-col items-center gap-6 p-5 sm:flex-row sm:gap-8 sm:p-7">
        <div className="flex w-full max-w-[300px] shrink-0 items-center justify-center sm:w-[280px]">
          <CreatureOrbit
            items={items}
            coreValue={total}
            coreLabel={t('home.huntedCoreLabel')}
            coreSub={t('home.allWorlds')}
          />
        </div>

        <div className="max-w-md sm:ml-auto sm:text-right">
          <p className="font-title text-[11px] uppercase tracking-[0.22em] text-accent">
            {t('home.huntedKicker')}
          </p>
          <h2 className="mt-2 font-title text-2xl uppercase tracking-[0.06em] text-fg">
            {t('home.huntedTitle')}
          </h2>
          <p className="mt-3 text-[15px] italic leading-relaxed text-fg-dim">
            {t('home.huntedDesc')}
          </p>
          <Link to="/killstats" className="btn-quill mt-5 inline-flex">
            {t('home.seeAll')} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
