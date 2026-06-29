import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { TypeIcon } from '../TypeIcon'
import type { EntryListItem } from '../../types'
import { statChips, VocationDots } from './itemStats'

/**
 * A single "sticker" in the album. Clicking the card opens its detail; the
 * corner button toggles whether you've collected it. Owned cards are
 * full-colour with a golden ring, missing ones are dimmed and desaturated —
 * the classic missing-sticker look.
 */
export const ItemCard = memo(function ItemCard({
  item,
  collected,
  onToggle,
  onOpen,
}: {
  item: EntryListItem
  collected: boolean
  onToggle: (slug: string, category: string) => void
  onOpen: (slug: string, category: string) => void
}) {
  const { t } = useTranslation()
  const stats = item.item
  const chips = statChips(stats, t)
  const category = stats?.category ?? ''

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item.slug, category)}
      onKeyDown={(e) =>
        (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(item.slug, category))
      }
      className={`panel group relative flex cursor-pointer flex-col items-center gap-1.5 p-3 text-center transition ${
        collected
          ? 'border-accent/70 ring-1 ring-accent/40'
          : 'border-line opacity-75 hover:opacity-100 hover:border-line-2'
      }`}
    >
      {/* Collected toggle (separate from opening the detail). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggle(item.slug, category)
        }}
        aria-pressed={collected}
        title={collected ? t('items.owned') : t('items.markCollected')}
        className={`absolute right-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full text-[11px] font-black transition ${
          collected
            ? 'bg-accent text-white'
            : 'bg-bg/70 text-fg-mute ring-1 ring-line hover:text-fg'
        }`}
      >
        {collected ? '✓' : '+'}
      </button>

      {stats?.level ? (
        <span className="absolute left-1.5 top-1.5 rounded bg-bg/85 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent-2 ring-1 ring-line">
          {t('items.lvl', { n: stats.level })}
        </span>
      ) : null}

      <div className="sprite-tile flex h-16 w-16 items-center justify-center">
        {item.primary_image ? (
          <img
            src={item.primary_image}
            alt={item.name ?? ''}
            loading="lazy"
            className="sprite max-h-14 max-w-14 object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.7)] transition group-hover:scale-105"
          />
        ) : (
          <TypeIcon type="item" className="h-7 w-7 text-fg-mute" />
        )}
      </div>

      <h3 className="line-clamp-2 text-xs font-semibold leading-tight text-fg">{item.name}</h3>

      <div className="flex min-h-4 flex-wrap items-center justify-center gap-1">
        {chips.map((c) => (
          <span
            key={c.label}
            className="rounded bg-surface px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-fg-mute"
          >
            {c.label} <span className="tabular-nums text-fg">{c.value}</span>
          </span>
        ))}
        <VocationDots vocations={stats?.vocations ?? []} />
      </div>
    </div>
  )
})
