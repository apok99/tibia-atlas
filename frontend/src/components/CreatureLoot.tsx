import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { LootItem } from '../types'

/** How many drops to show before collapsing behind a "show more" button. */
const LOOT_LIMIT = 18

/** Compact gp label: 35000 → "35k", 1200 → "1.2k", 100 → "100". */
function formatGp(v: number): string {
  if (v >= 1000) {
    const k = v / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
  }
  return String(v)
}

/**
 * The items a creature drops, as a grid of sprite tiles that link through to
 * each item's catalogue page. Notable (valuable) drops lead. Renders nothing
 * when the creature has no known loot.
 */
export function CreatureLoot({ items }: { items: LootItem[] | undefined }) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)

  if (!items || items.length === 0) return null

  const shown = showAll ? items : items.slice(0, LOOT_LIMIT)
  const hidden = items.length - shown.length

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="h-3.5 w-1 rounded-full bg-accent" />
        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-fg">{t('entry.loot')}</h2>
        <span className="ml-auto font-mono text-xs tabular-nums text-fg-mute">{items.length}</span>
      </header>

      <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {shown.map((it) => (
          <Link
            key={it.slug}
            to={`/items/${it.slug}`}
            title={it.name}
            className="group flex flex-col items-center gap-1 rounded-md border border-line bg-surface/50 p-2 text-center transition hover:-translate-y-0.5 hover:border-accent/60 hover:bg-surface"
          >
            <span className="sprite-tile grid h-12 w-12 place-items-center rounded">
              {it.image ? (
                <img
                  src={it.image}
                  alt=""
                  loading="lazy"
                  className="sprite max-h-10 max-w-10 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] transition group-hover:scale-110"
                />
              ) : (
                <span className="text-lg text-fg-mute">◆</span>
              )}
            </span>
            <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-fg-dim transition group-hover:text-accent-2">
              {it.name}
            </span>
            {it.value != null && (
              <span className="inline-flex items-center gap-0.5 font-mono text-[10px] font-bold tabular-nums text-theory">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-theory/80" />
                {formatGp(it.value)}
              </span>
            )}
          </Link>
        ))}
      </div>

      {hidden > 0 && (
        <div className="border-t border-line px-4 py-3">
          <button
            onClick={() => setShowAll(true)}
            className="w-full rounded-md border border-line py-2 text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:border-accent/60 hover:text-accent"
          >
            {t('items.showMore')} · +{hidden}
          </button>
        </div>
      )}
    </section>
  )
}
