import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { TypeIcon } from './TypeIcon'
import type { EntryListItem } from '../types'

export function EntryCard({ entry }: { entry: EntryListItem }) {
  const { t } = useTranslation()

  // Items are draft catalogue entries with no public lore page; open their
  // album modal instead of a 404ing /entry route.
  const to = entry.type === 'item' ? `/items?open=${entry.slug}` : `/entry/${entry.slug}`

  return (
    <Link
      to={to}
      className="panel group flex items-stretch overflow-hidden transition hover:border-line-2"
    >
      <div className="sprite-tile relative flex w-24 shrink-0 items-center justify-center border-r border-line">
        {entry.primary_image ? (
          <img
            src={entry.primary_image}
            alt={entry.name ?? ''}
            className="sprite max-h-16 max-w-16 object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.7)] transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <TypeIcon type={entry.type} className="h-7 w-7 text-fg-mute" />
        )}
        {entry.featured && (
          <span className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
        )}
        {typeof entry.recommended_level === 'number' && (
          <span className="absolute bottom-1 left-1 rounded bg-bg/85 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent-2 ring-1 ring-line">
            {t('quests.lvl', { n: entry.recommended_level })}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center p-3">
        <div className="flex items-center gap-1.5 text-fg-mute">
          <TypeIcon type={entry.type} className="h-3 w-3" />
          <span className="text-[10px] font-semibold uppercase tracking-wider">
            {t(`types.${entry.type}`)}
          </span>
        </div>
        <h3 className="mt-0.5 truncate font-semibold text-fg transition group-hover:text-accent-2">
          {entry.name}
        </h3>
        {entry.overview && (
          <p className="mt-0.5 line-clamp-2 text-sm text-fg-mute">{entry.overview}</p>
        )}
      </div>
    </Link>
  )
}
