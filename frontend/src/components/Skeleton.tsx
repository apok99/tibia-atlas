/** A single shimmering placeholder block. Pass Tailwind sizing via className. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

/** Placeholder that matches the layout of <EntryCard>. */
export function EntryCardSkeleton() {
  return (
    <div className="panel flex items-stretch overflow-hidden">
      <div className="flex w-24 shrink-0 items-center justify-center border-r border-line p-4">
        <Skeleton className="h-14 w-14 rounded" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-3">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  )
}

/** A responsive grid of card skeletons, mirroring the real entry grids. */
export function EntryGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <EntryCardSkeleton key={i} />
      ))}
    </div>
  )
}

/** Placeholder matching a single <BookCard> in the library grid. */
export function BookCardSkeleton() {
  return (
    <div className="flex flex-col rounded-md border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="mt-0.5 h-5 w-5 shrink-0 rounded" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-4/5" />
      <div className="mt-4 flex items-center justify-between gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  )
}

/** A grid of book-card skeletons, mirroring the real library grid. */
export function BookGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <BookCardSkeleton key={i} />
      ))}
    </div>
  )
}

/** Placeholder rows for the library's shelves sidebar. */
export function ShelfListSkeleton({ count = 12 }: { count?: number }) {
  // A few stable-looking widths so the rows don't all line up.
  const widths = ['w-3/4', 'w-2/3', 'w-5/6', 'w-1/2', 'w-4/5', 'w-3/5']
  return (
    <div className="space-y-0.5" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-2 px-2.5 py-2">
          <Skeleton className={`h-3.5 ${widths[i % widths.length]}`} />
          <Skeleton className="h-3 w-6 shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** Placeholder panel for the focused book reading view (no back link — the
 *  reader renders the real one above it). */
export function BookReaderSkeleton() {
  return (
    <div className="panel mx-auto max-w-3xl p-6 sm:p-10" aria-busy="true">
      <div className="flex flex-col items-center gap-3 border-b border-line pb-5">
        <Skeleton className="h-8 w-8 rounded" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <div className="mt-6 space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className={`h-4 ${i % 4 === 3 ? 'w-2/3' : 'w-full'}`} />
        ))}
      </div>
    </div>
  )
}

/** Full-page placeholder for a single entry while its lore loads. */
export function EntryPageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-3 w-16" />

      {/* Hero */}
      <div className="panel overflow-hidden">
        <div className="flex flex-col gap-6 p-6 sm:flex-row">
          <Skeleton className="mx-auto h-40 w-40 shrink-0 sm:mx-0" />
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 border-r border-line px-4 py-3">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
        <div className="space-y-5">
          <div className="panel space-y-3 p-5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-11/12" />
          </div>
          <div className="panel space-y-3 p-5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="space-y-3">
          <EntryCardSkeleton />
          <EntryCardSkeleton />
        </div>
      </div>
    </div>
  )
}
