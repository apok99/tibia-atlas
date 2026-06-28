import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRandomEntries } from '../hooks/useEntries'
import { TypeIcon } from './TypeIcon'
import type { EntryListItem } from '../types'

const PER_PAGE = 3
const ROTATE_MS = 7000

/** Split a list into fixed-size pages. */
function chunk<T>(arr: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < arr.length; i += size) pages.push(arr.slice(i, i + size))
  return pages
}

/**
 * Home "Discover" carousel: a rotating sample of random entries (mixed types)
 * shown as sprite cards. No view counters — it's a serendipitous showcase that
 * always looks full, regardless of site traffic.
 */
export function DiscoverCarousel() {
  const { t } = useTranslation()
  const { data: entries, isLoading } = useRandomEntries(9)
  const [page, setPage] = useState(0)

  const pages = entries ? chunk(entries, PER_PAGE) : []

  useEffect(() => {
    if (pages.length <= 1) return
    const id = setInterval(() => setPage((p) => (p + 1) % pages.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [pages.length])

  if (!isLoading && (!entries || entries.length === 0)) return null

  const current = pages[page % (pages.length || 1)] ?? []

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-fg">{t('home.discover')}</h2>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-fg-mute">
          <CompassIcon /> {t('home.discoverSub')}
        </span>
        <span className="h-px flex-1 bg-line" />
        {pages.length > 1 && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => (p - 1 + pages.length) % pages.length)}
              aria-label={t('home.prev')}
              className="grid h-7 w-7 place-items-center rounded-full border border-line text-fg-mute transition hover:border-line-2 hover:text-fg"
            >
              <ChevronIcon dir="left" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => (p + 1) % pages.length)}
              aria-label={t('home.next')}
              className="grid h-7 w-7 place-items-center rounded-full border border-line text-fg-mute transition hover:border-line-2 hover:text-fg"
            >
              <ChevronIcon dir="right" />
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: PER_PAGE }).map((_, i) => <DiscoverCardSkeleton key={i} />)
          : current.map((e) => <DiscoverCard key={e.id} entry={e} />)}
      </div>

      {pages.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPage(i)}
              aria-label={`${i + 1}`}
              className={`h-1.5 rounded-full transition ${
                i === page % pages.length ? 'w-4 bg-accent' : 'w-1.5 bg-line hover:bg-line-2'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function DiscoverCard({ entry }: { entry: EntryListItem }) {
  const { t } = useTranslation()

  return (
    <Link
      to={`/entry/${entry.slug}`}
      className="panel group flex flex-col overflow-hidden transition hover:border-line-2"
    >
      <div className="sprite-tile relative flex h-32 items-center justify-center border-b border-line">
        {entry.primary_image ? (
          <img
            src={entry.primary_image}
            alt={entry.name ?? ''}
            className="sprite max-h-24 max-w-24 object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.7)] transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <TypeIcon type={entry.type} className="h-10 w-10 text-fg-mute" />
        )}
        {entry.boss && (
          <span className="absolute right-2 top-2 rounded-full bg-theory/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-theory">
            ☠ {t('home.boss')}
          </span>
        )}
      </div>
      <div className="p-3 text-center">
        <div className="flex items-center justify-center gap-1.5 text-fg-mute">
          <TypeIcon type={entry.type} className="h-3 w-3" />
          <span className="text-[10px] font-semibold uppercase tracking-wider">
            {t(`types.${entry.type}`)}
          </span>
        </div>
        <h3 className="mt-0.5 truncate font-bold text-fg transition group-hover:text-accent-2">
          {entry.name}
        </h3>
      </div>
    </Link>
  )
}

function DiscoverCardSkeleton() {
  return (
    <div className="panel flex flex-col overflow-hidden">
      <div className="h-32 animate-pulse border-b border-line bg-surface-2" />
      <div className="space-y-2 p-3">
        <div className="mx-auto h-2.5 w-16 animate-pulse rounded bg-surface-2" />
        <div className="mx-auto h-3.5 w-24 animate-pulse rounded bg-surface-2" />
      </div>
    </div>
  )
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5 5-2Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4">
      <path
        d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
