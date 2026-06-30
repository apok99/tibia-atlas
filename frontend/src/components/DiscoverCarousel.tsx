import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRandomEntries } from '../hooks/useEntries'
import { TypeIcon } from './TypeIcon'
import type { EntryListItem } from '../types'

const PER_PAGE = 3
const ROTATE_MS = 12000

/** Split a list into fixed-size pages. */
function chunk<T>(arr: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < arr.length; i += size) pages.push(arr.slice(i, i + size))
  return pages
}

/** Open items in their album modal; everything else has a lore page. */
function entryTo(entry: EntryListItem): string {
  return entry.type === 'item' ? `/items?open=${entry.slug}` : `/entry/${entry.slug}`
}

/**
 * Home "Discover" spotlight: a rotating sample of random (image-bearing) entries
 * laid out as one large featured card + two supporting cards, with glow/sheen/
 * float flourishes so it reads as a showcase rather than three flat boxes.
 */
export function DiscoverCarousel() {
  const { t } = useTranslation()
  const { data: entries, isLoading } = useRandomEntries(9, { preferImages: true })
  const [page, setPage] = useState(0)

  const pages = entries ? chunk(entries, PER_PAGE) : []

  useEffect(() => {
    if (pages.length <= 1) return
    const id = setInterval(() => setPage((p) => (p + 1) % pages.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [pages.length])

  if (!isLoading && (!entries || entries.length === 0)) return null

  const current = pages[page % (pages.length || 1)] ?? []
  const [hero, ...rest] = current

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

      {isLoading ? (
        <DiscoverSkeleton />
      ) : (
        <div
          key={page}
          className="dc-rotate grid gap-3 md:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2"
        >
          {hero && <HeroCard entry={hero} />}
          {rest.map((e) => (
            <CompactCard key={e.id} entry={e} />
          ))}
        </div>
      )}

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

/** Hand-tuned ember motes (size / speed / delay / horizontal drift). */
const EMBERS = [
  { left: '14%', s: 4, d: 5.6, delay: 0, dx: '7px' },
  { left: '26%', s: 3, d: 6.6, delay: 1.3, dx: '-6px' },
  { left: '39%', s: 5, d: 5.1, delay: 2.2, dx: '9px' },
  { left: '51%', s: 3, d: 7.0, delay: 0.7, dx: '-4px' },
  { left: '64%', s: 4, d: 6.1, delay: 1.9, dx: '6px' },
  { left: '77%', s: 3, d: 5.9, delay: 3.1, dx: '-8px' },
  { left: '87%', s: 4, d: 6.8, delay: 2.5, dx: '5px' },
  { left: '32%', s: 2, d: 4.9, delay: 3.7, dx: '4px' },
]

/** Rising fire embers behind a sprite. `count` trims the mote list for compact cards. */
function Embers({ count = EMBERS.length }: { count?: number }) {
  return (
    <span className="dc-embers" aria-hidden>
      {EMBERS.slice(0, count).map((e, i) => (
        <span
          key={i}
          className="dc-ember"
          style={
            {
              left: e.left,
              '--s': `${e.s}px`,
              '--d': `${e.d}s`,
              '--delay': `${e.delay}s`,
              '--dx': e.dx,
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}

/** Shared type + region eyebrow row. */
function Eyebrow({ entry }: { entry: EntryListItem }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1.5 text-fg-mute">
      <TypeIcon type={entry.type} className="h-3 w-3" />
      <span className="text-[10px] font-semibold uppercase tracking-wider">
        {t(`types.${entry.type}`)}
      </span>
      {entry.region && (
        <>
          <span className="text-line-2">·</span>
          <span className="truncate text-[10px] font-medium uppercase tracking-wider text-fg-dim">
            {entry.region}
          </span>
        </>
      )}
    </div>
  )
}

function Badges({ entry }: { entry: EntryListItem }) {
  const { t } = useTranslation()
  return (
    <>
      {entry.boss && (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-theory/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-theory ring-1 ring-theory/30">
          ☠ {t('home.boss')}
        </span>
      )}
      {typeof entry.recommended_level === 'number' && (
        <span className="absolute bottom-2 left-2 z-10 rounded bg-bg/85 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent-2 ring-1 ring-line">
          {t('quests.lvl', { n: entry.recommended_level })}
        </span>
      )}
    </>
  )
}

function HeroCard({ entry }: { entry: EntryListItem }) {
  const { t } = useTranslation()
  return (
    <Link
      to={entryTo(entry)}
      className="dc-card dc-hero panel group flex flex-col md:col-span-2 lg:col-span-2 lg:row-span-2 lg:flex-row"
    >
      <div className="dc-stage relative flex min-h-[200px] items-center justify-center border-b border-line p-6 lg:min-h-0 lg:w-1/2 lg:border-b-0 lg:border-r">
        <Embers />
        <Badges entry={entry} />
        {entry.primary_image ? (
          <div className="dc-sprite-wrap">
            <img
              src={entry.primary_image}
              alt={entry.name ?? ''}
              className="dc-sprite sprite max-h-40 max-w-40"
              loading="lazy"
            />
          </div>
        ) : (
          <TypeIcon type={entry.type} className="h-16 w-16 text-fg-mute" />
        )}
      </div>
      <div className="relative z-[2] flex flex-1 flex-col justify-center p-5 lg:p-6">
        <Eyebrow entry={entry} />
        <h3 className="mt-1.5 text-xl font-black leading-tight text-fg transition group-hover:text-accent-2">
          {entry.name}
        </h3>
        {entry.overview && (
          <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-fg-dim">{entry.overview}</p>
        )}
        <span className="mt-4 inline-flex w-fit items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent-2">
          {t('home.readMore')}
          <span className="transition-transform group-hover:translate-x-1">→</span>
        </span>
      </div>
    </Link>
  )
}

function CompactCard({ entry }: { entry: EntryListItem }) {
  return (
    <Link
      to={entryTo(entry)}
      className="dc-card panel group flex items-stretch"
    >
      <div className="dc-stage relative flex w-24 shrink-0 items-center justify-center overflow-hidden border-r border-line">
        <Embers count={4} />
        <Badges entry={entry} />
        {entry.primary_image ? (
          <div className="dc-sprite-wrap">
            <img
              src={entry.primary_image}
              alt={entry.name ?? ''}
              className="dc-sprite sprite max-h-16 max-w-16"
              loading="lazy"
            />
          </div>
        ) : (
          <TypeIcon type={entry.type} className="h-8 w-8 text-fg-mute" />
        )}
      </div>
      <div className="relative z-[2] flex min-w-0 flex-1 flex-col justify-center p-3.5">
        <Eyebrow entry={entry} />
        <h3 className="mt-0.5 truncate font-bold text-fg transition group-hover:text-accent-2">
          {entry.name}
        </h3>
        {entry.overview && (
          <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-fg-mute">{entry.overview}</p>
        )}
      </div>
    </Link>
  )
}

function DiscoverSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2">
      <div className="panel flex flex-col overflow-hidden md:col-span-2 lg:col-span-2 lg:row-span-2 lg:flex-row">
        <div className="h-48 animate-pulse bg-surface-2 lg:h-auto lg:w-1/2" />
        <div className="flex-1 space-y-3 p-6">
          <div className="h-2.5 w-20 animate-pulse rounded bg-surface-2" />
          <div className="h-5 w-40 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
        </div>
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="panel flex items-stretch overflow-hidden">
          <div className="h-24 w-24 shrink-0 animate-pulse bg-surface-2" />
          <div className="flex-1 space-y-2 p-3.5">
            <div className="h-2.5 w-16 animate-pulse rounded bg-surface-2" />
            <div className="h-3.5 w-24 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
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
