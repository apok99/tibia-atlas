import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useEntries } from '../hooks/useEntries'
import { useDebounce } from '../hooks/useDebounce'
import { EntryCard } from '../components/EntryCard'
import { EntryGridSkeleton } from '../components/Skeleton'
import { Pagination } from '../components/Pagination'
import { BestiaryFilters } from '../components/BestiaryFilters'
import type { EntryType } from '../types'

export function BrowsePage() {
  const { type } = useParams<{ type: EntryType }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { t } = useTranslation()
  const [q, setQ] = useState(searchParams.get('q') ?? '')
  // The input updates instantly; the actual query waits until typing settles,
  // so we don't fire an ilike scan over the whole archive on every keystroke.
  const debouncedQ = useDebounce(q.trim(), 350)
  const page = Number(searchParams.get('page') ?? '1') || 1

  // Bestiary facets (creature type + boss rank) live in the URL so filtered
  // views are shareable and survive a refresh.
  const classification = searchParams.get('cls') ?? ''
  const boss = searchParams.get('boss') ?? ''
  const showFilters = type === 'creature'

  const { data, isLoading } = useEntries({
    type,
    q: debouncedQ || undefined,
    page,
    classification: classification || undefined,
    boss: boss === '0' || boss === '1' ? boss : undefined,
  })

  // Any filter change should reset back to page 1 (but not on initial load,
  // and not when React StrictMode double-invokes this effect in dev).
  const prevFilters = useRef({ q: debouncedQ, type, classification, boss })
  useEffect(() => {
    const p = prevFilters.current
    if (p.q === debouncedQ && p.type === type && p.classification === classification && p.boss === boss) return
    prevFilters.current = { q: debouncedQ, type, classification, boss }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('page')
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, type, classification, boss])

  const setFilter = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  }

  const clearFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('cls')
      next.delete('boss')
      return next
    })
  }

  const goToPage = (p: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('page', String(p))
      return next
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight text-fg">
          <span className="h-7 w-1.5 rounded-full bg-accent" />
          {type ? t(`types.${type}`) : t('home.browseAll')}
        </h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('browse.searchPlaceholder')}
          className="w-full rounded-md border border-line bg-surface px-4 py-2 text-sm text-fg outline-none placeholder:text-fg-mute focus:border-accent/60 sm:w-72"
        />
      </div>

      {showFilters && (
        <BestiaryFilters
          type={type}
          classification={classification}
          boss={boss}
          onClassificationChange={(v) => setFilter('cls', v)}
          onBossChange={(v) => setFilter('boss', v)}
          onClear={clearFilters}
        />
      )}

      {isLoading ? (
        <EntryGridSkeleton count={12} />
      ) : data && data.data.length > 0 ? (
        <>
          <p className="mb-4 text-xs font-bold uppercase tracking-wider text-fg-mute">
            {t('browse.results', { count: data.meta.total })}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.data.map((e) => (
              <EntryCard key={e.id} entry={e} />
            ))}
          </div>
          <Pagination currentPage={data.meta.current_page} lastPage={data.meta.last_page} onPageChange={goToPage} />
        </>
      ) : (
        <p className="text-fg-mute">{t('browse.empty')}</p>
      )}
    </div>
  )
}
