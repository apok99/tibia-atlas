import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { CountUp } from './CountUp'
import type { TopSearch } from '../hooks/useKillStats'

const TYPE_GLYPH: Record<string, string> = {
  creature: '🐾',
  character: '👑',
  city: '🏰',
  quest: '📜',
  item: '🛡️',
}

/**
 * "Most searched on the site" — an animated ranked list. Each row slides in with
 * a stagger; the count rolls up; the #1 entry gets a gold spotlight. Falls back
 * to most-viewed entries (label adapts) while the search log is still sparse.
 */
export function TopSearched({ source, items }: { source: 'searches' | 'views'; items: TopSearch[] }) {
  const { t } = useTranslation()
  const list = items.slice(0, 8)

  return (
    <section className="ks-panel flex h-full flex-col">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="ks-panel-title">{source === 'searches' ? t('ks.searchedTitle') : t('ks.viewedTitle')}</h2>
        <span className="text-[11px] text-fg-mute">{source === 'searches' ? t('ks.searchedSub') : t('ks.viewedSub')}</span>
      </div>

      {!list.length ? (
        <p className="py-12 text-center text-sm text-fg-mute">{t('ks.noData')}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-1.5">
          {list.map((s, i) => {
            const label = s.name ?? s.term
            const row = (
              <div className={`ks-search-row ${i === 0 ? 'is-first' : ''}`} style={{ animationDelay: `${i * 70}ms` }}>
                <span className="ks-search-rank">{i + 1}</span>
                <span className="ks-search-sprite">
                  {s.image ? (
                    <img src={s.image} alt="" loading="lazy" />
                  ) : (
                    <span>{TYPE_GLYPH[s.type ?? ''] ?? '🔍'}</span>
                  )}
                </span>
                <span className="ks-search-name capitalize">{label}</span>
                <span className="ks-search-trend">▲</span>
                <span className="ks-search-hits">
                  <CountUp value={s.hits} duration={1000} />
                </span>
              </div>
            )
            return s.slug ? (
              <Link key={`${s.term}-${i}`} to={`/entry/${s.slug}`} className="transition hover:brightness-125">
                {row}
              </Link>
            ) : (
              <div key={`${s.term}-${i}`}>{row}</div>
            )
          })}
        </div>
      )}
    </section>
  )
}
