import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useItems, useItemFacets } from '../../hooks/useEntries'
import { useDebounce } from '../../hooks/useDebounce'
import type { EntryListItem } from '../../types'
import { ItemCard } from './ItemCard'
import { ItemDetailModal } from './ItemDetailModal'

const PER_PAGE = 60

export function ItemAlbum({
  has,
  toggle,
  countIn,
}: {
  has: (slug: string) => boolean
  toggle: (slug: string, category?: string) => void
  countIn: (category: string) => number
}) {
  const { t } = useTranslation()
  const { data: facets } = useItemFacets()

  const [category, setCategory] = useState('')
  const [equippable, setEquippable] = useState(false)
  const [search, setSearch] = useState('')
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const [openCategory, setOpenCategory] = useState('')

  // Stable callbacks so the memoized ItemCards don't all re-render when one is
  // toggled or the modal opens (only the card whose `collected` flips re-renders).
  const handleToggle = useCallback((slug: string, category: string) => toggle(slug, category), [toggle])
  const handleOpen = useCallback((slug: string, category: string) => {
    setOpenSlug(slug)
    setOpenCategory(category)
  }, [])
  const q = useDebounce(search.trim(), 350)

  // Accumulate pages for an infinite "show more" list.
  const [page, setPage] = useState(1)
  const [acc, setAcc] = useState<EntryListItem[]>([])

  const { data, isFetching } = useItems({
    category: category || undefined,
    equippable: equippable ? '1' : undefined,
    q: q || undefined,
    page,
    per_page: PER_PAGE,
  })

  // Reset the accumulator whenever the filters change.
  const sig = `${category}|${equippable}|${q}`
  const sigRef = useRef(sig)
  useEffect(() => {
    if (sigRef.current !== sig) {
      sigRef.current = sig
      setPage(1)
      setAcc([])
    }
  }, [sig])

  // Append (or replace on page 1) as pages arrive.
  useEffect(() => {
    if (!data) return
    setAcc((prev) =>
      data.meta.current_page === 1 ? data.data : dedupe([...prev, ...data.data]),
    )
  }, [data])

  const total = data?.meta.total ?? 0
  const hasMore = data ? data.meta.current_page < data.meta.last_page : false

  const grandTotal = facets?.total ?? 0

  // Per-category progress when a single category is in focus.
  const catCount = facets?.categories.find((c) => c.value === category)?.count ?? 0
  const catOwned = category ? countIn(category) : 0

  return (
    <div>
      {/* Controls. */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('items.search')}
          className="w-full rounded-md border border-line bg-surface px-4 py-2 text-sm text-fg outline-none placeholder:text-fg-mute focus:border-accent/60 sm:w-64"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent/60"
        >
          <option value="">
            {t('items.allCategories')} ({grandTotal})
          </option>
          {facets?.categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value} ({c.count})
            </option>
          ))}
        </select>
        <button
          onClick={() => setEquippable((v) => !v)}
          className={`rounded-md border px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${
            equippable
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-line text-fg-mute hover:border-line-2 hover:text-fg'
          }`}
        >
          {t('items.equippableOnly')}
        </button>
        <span className="text-xs font-bold uppercase tracking-wider text-fg-mute sm:ml-auto">
          {category
            ? `${category}: ${catOwned}/${catCount}`
            : `${total} ${t('nav.items')}`}
        </span>
      </div>

      {/* Grid of cromos. */}
      {acc.length === 0 && !isFetching ? (
        <p className="py-10 text-center text-fg-mute">{t('items.empty')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {acc.map((item) => (
            <ItemCard
              key={item.slug}
              item={item}
              collected={has(item.slug)}
              onToggle={handleToggle}
              onOpen={handleOpen}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={isFetching}
            className="rounded-md border border-line px-5 py-2 text-sm font-bold uppercase tracking-wider text-fg-mute transition hover:border-line-2 hover:text-fg disabled:opacity-50"
          >
            {isFetching ? '…' : t('items.showMore')}
          </button>
        </div>
      )}

      {openSlug && (
        <ItemDetailModal
          slug={openSlug}
          collected={has(openSlug)}
          onToggle={() => toggle(openSlug, openCategory)}
          onClose={() => setOpenSlug(null)}
        />
      )}
    </div>
  )
}

/** Guard against duplicate slugs if a page boundary shifts mid-import. */
function dedupe(list: EntryListItem[]): EntryListItem[] {
  const seen = new Set<string>()
  return list.filter((i) => (seen.has(i.slug) ? false : seen.add(i.slug)))
}
