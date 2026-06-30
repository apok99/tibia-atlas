import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRandomEntries } from '../hooks/useEntries'
import { EntryCard } from './EntryCard'
import { EntryCardSkeleton } from './Skeleton'

const ROTATE_MS = 8000

/** Sidebar/section widget that cycles through a small set of random published entries. */
export function RecommendedReading({ excludeSlug }: { excludeSlug?: string }) {
  const { t } = useTranslation()
  const { data: entries, isLoading } = useRandomEntries(6, { excludeSlug, preferImages: true })
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!entries || entries.length <= 1) return
    const id = setInterval(() => setIndex((i) => (i + 1) % entries.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [entries])

  // Nothing to recommend once loaded, but keep the slot reserved while loading.
  if (!isLoading && (!entries || entries.length === 0)) return null

  const Header = (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-fg">
        {t('home.recommended')}
      </h2>
      <span className="h-px flex-1 bg-line" />
    </div>
  )

  if (isLoading || !entries) {
    return (
      <section>
        {Header}
        <EntryCardSkeleton />
      </section>
    )
  }

  const entry = entries[index % entries.length]

  return (
    <section>
      {Header}
      <EntryCard key={entry.id} entry={entry} />
      <div className="mt-3 flex justify-center gap-1.5">
        {entries.map((e, i) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`${i + 1}`}
            className={`h-1.5 w-4 rounded-full transition ${
              i === index % entries.length ? 'bg-accent' : 'bg-line hover:bg-line-2'
            }`}
          />
        ))}
      </div>
    </section>
  )
}
