interface PaginationProps {
  currentPage: number
  lastPage: number
  onPageChange: (page: number) => void
}

/** Page numbers to render, with `null` standing in for an ellipsis gap. */
function buildPageList(current: number, last: number): (number | null)[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)

  const pages = new Set([1, 2, last - 1, last, current - 1, current, current + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b)

  const result: (number | null)[] = []
  let prev = 0
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push(null)
    result.push(p)
    prev = p
  }
  return result
}

export function Pagination({ currentPage, lastPage, onPageChange }: PaginationProps) {
  if (lastPage <= 1) return null

  return (
    <nav className="mt-6 flex items-center justify-center gap-1.5">
      <button
        type="button"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-fg-dim transition hover:border-accent/60 hover:text-fg disabled:opacity-40 disabled:hover:border-line disabled:hover:text-fg-dim"
        aria-label="Previous page"
      >
        ‹
      </button>

      {buildPageList(currentPage, lastPage).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="px-1 text-fg-mute">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            aria-current={p === currentPage ? 'page' : undefined}
            className={`min-w-[2.25rem] rounded-md border px-3 py-1.5 text-sm font-semibold transition ${
              p === currentPage
                ? 'border-accent/60 bg-accent/10 text-accent'
                : 'border-line text-fg-dim hover:border-accent/60 hover:text-fg'
            }`}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={currentPage >= lastPage}
        onClick={() => onPageChange(currentPage + 1)}
        className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-fg-dim transition hover:border-accent/60 hover:text-fg disabled:opacity-40 disabled:hover:border-line disabled:hover:text-fg-dim"
        aria-label="Next page"
      >
        ›
      </button>
    </nav>
  )
}
