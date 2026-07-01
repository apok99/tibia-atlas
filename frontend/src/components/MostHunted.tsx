import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useKillRanking, useKillOverview } from '../hooks/useKillStats'
import { CreatureOrbit } from './CreatureOrbit'

/**
 * The most-hunted creatures across every Tibia world (24h) shown as the
 * dashboard's rotating creature orbit — real, un-fakeable CipSoft data as the
 * home's living centrepiece.
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
    <section>
      <div className="mb-4 flex items-center gap-3">
        <span className="h-1.5 w-1.5 rotate-45 bg-accent" aria-hidden="true" />
        <h2 className="font-title text-sm uppercase tracking-[0.18em] text-fg">
          {t('home.huntedTitle')}
        </h2>
        <span className="rule-gilt flex-1" />
        <Link to="/killstats" className="small-caps font-medium text-accent hover:underline">
          {t('home.seeAll')}
        </Link>
      </div>

      <div className="flex justify-center py-2">
        <CreatureOrbit
          items={items}
          coreValue={total}
          coreLabel={t('home.huntedCoreLabel')}
          coreSub={t('home.allWorlds')}
        />
      </div>
    </section>
  )
}
