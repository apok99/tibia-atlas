import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useGlossary } from '../hooks/useGlossary'
import { TypeIcon } from './TypeIcon'

/** Accent- and case-insensitive normalisation for matching (Paladín → paladin). */
const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

const MAX_RESULTS = 8

/**
 * Hero search input with a live autocomplete dropdown. Suggestions come from the
 * cached glossary (all published entries); picking one jumps straight to its
 * page, while submitting runs a full search on the browse page.
 */
export function SearchBox({ placeholder }: { placeholder?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: glossary } = useGlossary()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const term = normalize(q)
    if (term.length < 2 || !glossary) return []
    const scored: { item: (typeof glossary)[number]; score: number; idx: number }[] = []
    for (const item of glossary) {
      const idx = normalize(item.name).indexOf(term)
      if (idx === -1) continue
      // Prefix matches rank above mid-word matches; shorter names break ties.
      scored.push({ item, score: idx === 0 ? 0 : 1, idx })
    }
    scored.sort(
      (a, b) => a.score - b.score || a.idx - b.idx || a.item.name.length - b.item.name.length,
    )
    return scored.slice(0, MAX_RESULTS).map((s) => s.item)
  }, [q, glossary])

  // Reset the highlighted row whenever the suggestion list changes.
  useEffect(() => setActive(-1), [q])

  // Close the dropdown when clicking outside the component.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const goToEntry = (slug: string) => {
    setOpen(false)
    setQ('')
    navigate(`/entry/${slug}`)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (active >= 0 && results[active]) {
      goToEntry(results[active].slug)
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

  const showDropdown = open && (results.length > 0 || normalize(q).length >= 2)

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
                    onClick={() => goToEntry(r.slug)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                      i === active ? 'bg-surface-2' : 'hover:bg-surface-2'
                    }`}
                  >
                    <TypeIcon type={r.type} className="h-4 w-4 shrink-0 text-fg-mute" />
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
