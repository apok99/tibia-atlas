import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useKillRanking } from '../hooks/useKillStats'

/**
 * A live ledger of the most-hunted creatures across every Tibia world in the
 * last 24h — real CipSoft data, ranked ink-list style (not a flashy dashboard).
 * Useful for players and impossible to fake, so it reads as a real tool.
 */
export function MostHunted() {
  const { t, i18n } = useTranslation()
  const { data, isLoading } = useKillRanking({
    world: 'all',
    metric: 'killed',
    window: 'day',
    limit: 10,
  })

  const rows = data ?? []
  const max = rows.length ? Math.max(...rows.map((r) => r.killed)) : 0
  const fmt = new Intl.NumberFormat(i18n.language)

  return (
    <section>
      <div className="mb-5 flex items-center gap-3">
        <span className="h-1.5 w-1.5 rotate-45 bg-accent" aria-hidden="true" />
        <h2 className="font-title text-sm uppercase tracking-[0.18em] text-fg">
          {t('home.huntedTitle')}
        </h2>
        <span className="rule-gilt flex-1" />
        <Link to="/killstats" className="small-caps font-medium text-accent hover:underline">
          {t('home.seeAll')}
        </Link>
      </div>

      <ol className="panel divide-y divide-line overflow-hidden">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                <span className="skeleton h-4 w-4" />
                <span className="skeleton h-9 w-9 rounded-[2px]" />
                <span className="skeleton h-4 flex-1" />
              </li>
            ))
          : rows.map((r, i) => (
              <li key={`${r.race}-${i}`}>
                <Link
                  to={r.slug ? `/entry/${r.slug}` : '/killstats'}
                  className="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-bg-2"
                >
                  <span className="w-5 shrink-0 text-center font-title text-sm font-medium text-fg-mute">
                    {i + 1}
                  </span>
                  <span className="sprite-tile grid h-9 w-9 shrink-0 place-items-center rounded-[2px] border border-line">
                    {r.image ? (
                      <img
                        src={r.image}
                        alt=""
                        className="sprite max-h-7 max-w-7 object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-fg-mute" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium capitalize text-fg group-hover:text-accent">
                      {r.race}
                    </span>
                    {/* subtle magnitude bar */}
                    <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-bg-2">
                      <span
                        className="block h-full rounded-full bg-accent/50"
                        style={{ width: max ? `${Math.max(4, (r.killed / max) * 100)}%` : '0%' }}
                      />
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-accent">
                    {fmt.format(r.killed)}
                  </span>
                </Link>
              </li>
            ))}
      </ol>

      <p className="mt-2 px-1 text-[11px] italic text-fg-mute">{t('home.last24hAllWorlds')}</p>
    </section>
  )
}
