import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSearch, logSearchClick } from '../hooks/useEntries'
import { useDebounce } from '../hooks/useDebounce'
import { TypeIcon } from './TypeIcon'
import type { SearchResult } from '../types'

/** Where a search hit lives: items open their album modal, lore opens its page. */
const hrefFor = (r: SearchResult) =>
  r.type === 'item' ? `/items?open=${r.slug}` : `/entry/${r.slug}`

/**
 * Hero search input with a live autocomplete dropdown. Suggestions come from the
 * global `/search` endpoint, which spans every published entry AND the full item
 * catalogue (matched by name and lore text). Picking one jumps straight to it;
 * submitting runs the full search on the browse page.
 */
export function SearchBox({ placeholder }: { placeholder?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)

  // Debounce so a fast typist doesn't fire an ilike scan on every keystroke.
  const debouncedQ = useDebounce(q.trim(), 250)
  const { data: results = [] } = useSearch(debouncedQ)

  // Reset the highlighted row whenever the suggestion list changes.
  useEffect(() => setActive(-1), [results])

  // Close the dropdown when clicking outside the component.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const goTo = (r: SearchResult) => {
    logSearchClick(r.slug)
    setOpen(false)
    setQ('')
    navigate(hrefFor(r))
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (active >= 0 && results[active]) {
      goTo(results[active])
      return
    }
    if (!q.trim()) return
    setOpen(false)
    navigate(`/browse?q=${encodeURIComponent(q.trim())}`)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || !results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    }
  }

  const showDropdown = open && q.trim().length >= 2

  return (
    <div ref={boxRef} className="relative w-full">
      <form onSubmit={submit}>
        <div className="flex items-center gap-2 rounded-full border border-line-2 bg-surface py-1.5 pl-5 pr-1.5 transition focus-within:border-accent/60">
          <SearchIcon />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={showDropdown}
            aria-autocomplete="list"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-fg outline-none placeholder:text-fg-mute"
          />
          <button type="submit" className="btn shrink-0 rounded-full">
            {t('home.search')}
          </button>
        </div>
      </form>

      {showDropdown && (
        <div className="panel absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden py-1 text-left shadow-xl">
          {results.length > 0 ? (
            <ul role="listbox">
              {results.map((r, i) => (
                <li key={r.slug}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => goTo(r)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                      i === active ? 'bg-surface-2' : 'hover:bg-surface-2'
                    }`}
                  >
                    {r.image ? (
                      <img
                        src={r.image}
                        alt=""
                        className="h-6 w-6 shrink-0 object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <TypeIcon type={r.type} className="h-4 w-4 shrink-0 text-fg-mute" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {r.name}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-mute">
                      {t(`types.${r.type}`)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-fg-mute">{t('browse.empty')}</p>
          )}

          <button
            type="button"
            onClick={() => submit({ preventDefault() {} } as FormEvent)}
            className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-xs text-fg-dim transition hover:bg-surface-2"
          >
            <SearchIcon small />
            {t('home.searchFor', { q: q.trim() })}
          </button>
        </div>
      )}
    </div>
  )
}

function SearchIcon({ small }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`${small ? 'h-3.5 w-3.5' : 'h-5 w-5'} shrink-0 text-fg-mute`}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  )
}
