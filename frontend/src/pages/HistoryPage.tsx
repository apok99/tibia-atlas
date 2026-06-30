import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLibrary, useLibraryBook } from '../hooks/useEntries'
import { useDebounce } from '../hooks/useDebounce'
import {
  BookGridSkeleton,
  BookReaderSkeleton,
  ShelfListSkeleton,
} from '../components/Skeleton'
import { Seo, collectionJsonLd } from '../lib/seo'
import type { LibraryBookItem } from '../types'

/**
 * The Library of Tibia — every readable in-game book, transcribed from
 * TibiaWiki. Browse the shelves by location or search the whole collection,
 * then read a book in a focused, serif reading view.
 */
export function HistoryPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()

  const shelf = params.get('shelf') ?? ''
  const q = params.get('q') ?? ''
  const bookSlug = params.get('book') ?? ''
  const loreOnly = params.get('lore') === '1'

  // Search box: local state, debounced into the URL (preserving shelf).
  const [term, setTerm] = useState(q)
  const debounced = useDebounce(term.trim(), 350)
  useEffect(() => {
    if (debounced === q) return
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (debounced) n.set('q', debounced)
        else n.delete('q')
        n.delete('book')
        return n
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  // One call powers both panes: `data` is the filtered list, `groups` is always
  // the full set of shelves (for the sidebar).
  const { data: lib, isLoading, isPlaceholderData } = useLibrary(
    q ? { q } : shelf ? { group: shelf } : {},
  )

  // A signature of the *server* filter (q / shelf — NOT the client-side lore
  // toggle). We keep the previous data on screen across a language switch
  // (same signature → seamless), but show skeletons when the signature changes
  // (a new shelf or search) so a stale list never flashes.
  const querySig = q ? `q:${q}` : shelf ? `s:${shelf}` : 'all'
  const settledSig = useRef(querySig)
  useEffect(() => {
    if (!isPlaceholderData) settledSig.current = querySig
  }, [isPlaceholderData, querySig])
  const listLoading = isLoading || (isPlaceholderData && settledSig.current !== querySig)

  const open = (next: { shelf?: string; book?: string; lore?: boolean }) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev)
      if ('shelf' in next) {
        next.shelf ? n.set('shelf', next.shelf) : n.delete('shelf')
        n.delete('q')
        n.delete('book')
      }
      if ('book' in next) {
        next.book ? n.set('book', next.book) : n.delete('book')
      }
      if ('lore' in next) {
        next.lore ? n.set('lore', '1') : n.delete('lore')
        n.delete('book')
      }
      return n
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Reading view takes over the whole page.
  if (bookSlug) {
    return <BookReader slug={bookSlug} onBack={() => open({ book: '' })} />
  }

  const allBooks = lib?.data ?? []
  const books = loreOnly ? allBooks.filter((b) => b.is_lore_important) : allBooks
  const groups = lib?.groups ?? []
  // The right pane shows books whenever a search, a shelf, or the lore filter
  // is active; otherwise it invites the reader to pick a shelf.
  const hasView = Boolean(q || shelf || loreOnly)

  return (
    <div className="space-y-8">
      <Seo
        title={t('library.title')}
        description={t('library.intro')}
        path="/history"
        jsonLd={collectionJsonLd({ name: t('library.title'), description: t('library.intro'), path: '/history' })}
      />
      {/* Header */}
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-end sm:p-8">
          <div className="grid h-36 w-28 shrink-0 place-items-center rounded-md bg-gradient-to-br from-accent/30 via-surface-2 to-bg shadow-lg">
            <BookIcon className="h-14 w-14 text-accent" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-fg-mute">
              {t('library.kicker')}
            </div>
            <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              {t('library.title')}
            </h1>
            <p className="mt-3 max-w-2xl text-fg-dim">{t('library.intro')}</p>
          </div>
        </div>
      </section>

      {/* Search + lore filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-mute" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('library.search')}
            className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-fg placeholder:text-fg-mute focus:border-line-2 focus:outline-none"
          />
        </div>
        <button
          onClick={() => open({ lore: !loreOnly })}
          className={`flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold transition ${
            loreOnly
              ? 'border-gold bg-gold/15 text-gold'
              : 'border-line bg-surface text-fg-mute hover:border-line-2 hover:text-fg'
          }`}
          title={t('library.loreFilter')}
        >
          <StarIcon className="h-4 w-4" />
          {t('library.loreFilter')}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        {/* Shelves sidebar */}
        <aside className="space-y-1">
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.2em] text-fg-mute">
            {t('library.shelves')}
          </h2>
          <div className="max-h-[32rem] space-y-0.5 overflow-y-auto pr-1">
            {groups.length === 0 && isLoading ? (
              <ShelfListSkeleton />
            ) : (
              groups.map((g) => (
                <button
                  key={g.name}
                  onClick={() => open({ shelf: g.name })}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm transition ${
                    shelf === g.name && !q
                      ? 'bg-accent/15 text-accent'
                      : 'text-fg-dim hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  <span className="min-w-0 truncate">{g.name}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-mute">
                    {g.count}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Content */}
        <div>
          {!listLoading && q && (
            <p className="mb-4 text-sm text-fg-mute">{t('library.results', { count: books.length })}</p>
          )}
          {!listLoading && !q && shelf && (
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-black tracking-tight text-fg">{shelf}</h2>
              <span className="text-sm text-fg-mute">{t('library.results', { count: books.length })}</span>
            </div>
          )}

          {hasView && listLoading && <BookGridSkeleton />}

          {!listLoading && !hasView && (
            <p className="rounded-md border border-dashed border-line px-4 py-10 text-center text-fg-mute">
              {t('library.pickShelf')}
            </p>
          )}

          {!listLoading && hasView && books.length === 0 && (
            <p className="italic text-fg-mute">{t('library.noResults')}</p>
          )}

          {!listLoading && hasView && books.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {books.map((b) => (
                <BookCard key={b.slug} book={b} onOpen={() => open({ book: b.slug })} t={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BookCard({
  book,
  onOpen,
  t,
}: {
  book: LibraryBookItem
  onOpen: () => void
  t: (k: string, o?: Record<string, unknown>) => string
}) {
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col rounded-md border border-line bg-surface p-4 text-left transition hover:border-line-2 hover:bg-surface-2"
    >
      <div className="flex items-start gap-3">
        <BookIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent/80" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold leading-snug text-fg group-hover:text-accent-2">{book.title}</h3>
            {book.is_lore_important && (
              <span
                className="ml-1 mt-0.5 shrink-0 rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold"
                title={t('library.loreImportant')}
              >
                ★ Lore
              </span>
            )}
          </div>
          {book.author && (
            <p className="mt-0.5 text-xs text-fg-mute">
              {t('library.by')} {book.author}
            </p>
          )}
        </div>
      </div>
      {book.blurb && (
        <p className="mt-2 line-clamp-2 text-sm italic text-fg-dim">{book.blurb}</p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11px] text-fg-mute">
        {book.location ? <span className="truncate">{book.location}</span> : <span />}
        <span className="shrink-0 font-mono tabular-nums">
          {book.char_len.toLocaleString()} {t('library.chars')}
        </span>
      </div>
    </button>
  )
}

function BookReader({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { t } = useTranslation()
  const { data: book, isError } = useLibraryBook(slug)

  // `book` may briefly be the previous book (kept while the new one loads) — only
  // treat it as ready once its slug matches the one we're opening.
  const ready = !!book && book.slug === slug

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-fg"
      >
        {t('library.back')}
      </button>

      {!ready && !isError && <BookReaderSkeleton />}
      {isError && <p className="text-fg-mute">{t('common.error')}</p>}

      {ready && book && (
        <article className="panel mx-auto max-w-3xl p-6 sm:p-10">
          <header className="border-b border-line pb-5 text-center">
            <BookIcon className="mx-auto h-8 w-8 text-accent" />
            <h1 className="mt-3 text-3xl font-black tracking-tight text-fg sm:text-4xl">
              {book.title}
            </h1>
            {book.is_lore_important && (
              <span className="mt-2 inline-flex items-center gap-1 rounded border border-gold/40 bg-gold/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-gold">
                <StarIcon className="h-3 w-3" />
                {t('library.loreImportant')}
              </span>
            )}
            {book.author && (
              <p className="mt-2 text-sm text-fg-dim">
                {t('library.by')} <span className="font-semibold">{book.author}</span>
              </p>
            )}
            {book.location && (
              <p className="mt-1 text-xs text-fg-mute">
                {t('library.foundIn')}: {book.location}
              </p>
            )}
          </header>


          <div className="mt-6 whitespace-pre-line text-[1.08rem] leading-8 text-fg-dim [font-family:Georgia,'Times_New_Roman',serif] first-letter:float-left first-letter:mr-2 first-letter:text-6xl first-letter:font-black first-letter:leading-[0.8] first-letter:text-accent">
            {book.text}
          </div>

          {book.source_url && (
            <footer className="mt-8 border-t border-line pt-4 text-center">
              <a
                href={book.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold uppercase tracking-wider text-accent-2 transition hover:text-accent"
              >
                {t('library.readOn')} ↗
              </a>
            </footer>
          )}
        </article>
      )}
    </div>
  )
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}
