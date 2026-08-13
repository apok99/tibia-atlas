import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

// localStorage flag so the guide only auto-opens on a visitor's first visit.
// (Same key the old map-only tour used — veterans don't get nagged again.)
const SEEN_KEY = 'tibia_atlas_map_tour_seen'

export function guideSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // storage blocked → don't nag
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** 24×24 line icons, drawn to match the real control each topic describes. */
const ICONS: Record<string, string> = {
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  user: 'M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  box: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  npc: 'M12 3a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4zM5 21a7 7 0 0 1 14 0M9 21v-3M15 21v-3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  skull: 'M9 12h.01M15 12h.01M8 20v2h8v-2M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20',
  house: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  flame: 'M12 2c2 4-1 5-1 8a3 3 0 0 0 6 0c0-1-.3-2-.8-2.8C18.6 9 20 11.4 20 14a8 8 0 1 1-16 0c0-4 3-6.5 8-12z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  pin: 'M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  arrow: 'M3 11 22 2l-9 19-2-8z',
  share: 'M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17.5 16 6.5M8 12.5l8 4',
  rss: 'M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 18a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 1v4M12 19v4M1 12h4M19 12h4',
  frame: 'M4 4h16v16H4zM4 9h16M9 9v11',
  coins: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM18.09 10.37A6 6 0 1 1 10.34 18',
  scale: 'M12 3v18M7 6h10M5 6l-3 6h6zM19 6l-3 6h6zM8 21h8',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  shield: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z',
  chart: 'M3 21h18M7 21V10M12 21V4M17 21v-7',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  game: 'M6 12h4M8 10v4M15 11h.01M17.5 13.5h.01M7 6h10a5 5 0 0 1 5 5v2a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5v-2a5 5 0 0 1 5-5z',
  trophy: 'M8 3h8v6a4 4 0 0 1-8 0zM8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3M9 21h6M12 13v8',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z',
  layers: 'M12 2 2 7l10 5 10-5zM2 12l10 5 10-5M2 17l10 5 10-5',
  claw: 'M6 21c-2-5-2-9 0-13M10 21c-1.5-6-1.5-11 0-16M14 21c-1-6-1-12 .5-18M18 21c-.5-5-.5-9 .5-13',
  bag: 'M6 7h12l1 13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM9 7V5a3 3 0 0 1 6 0v2',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
}

type Topic = { key: string; icon: string; to?: string }
type Chapter = { key: string; icon: string; topics: Topic[] }

/**
 * The whole site, chapter by chapter. Each topic maps to a real control or page
 * — `to` is set only when there's somewhere to send the reader.
 */
const CHAPTERS: Chapter[] = [
  {
    key: 'start',
    icon: 'compass',
    topics: [
      { key: 'nav', icon: 'grid' },
      { key: 'search', icon: 'search' },
      { key: 'character', icon: 'user', to: '/map' },
      { key: 'prefs', icon: 'sliders' },
    ],
  },
  {
    key: 'map',
    icon: 'globe',
    topics: [
      { key: 'move', icon: 'compass', to: '/map' },
      { key: 'creature', icon: 'search', to: '/map' },
      { key: 'item', icon: 'box', to: '/map' },
      { key: 'npc', icon: 'npc', to: '/map' },
      { key: 'spawns', icon: 'eye', to: '/map' },
      { key: 'boss', icon: 'skull', to: '/map' },
      { key: 'houses', icon: 'house', to: '/map' },
      { key: 'lore', icon: 'book', to: '/map' },
      { key: 'raids', icon: 'flame', to: '/map' },
      { key: 'changes', icon: 'moon', to: '/map' },
      { key: 'markers', icon: 'pin', to: '/map' },
      { key: 'directions', icon: 'arrow', to: '/map' },
      { key: 'routes', icon: 'share', to: '/map' },
      { key: 'news', icon: 'rss', to: '/map' },
      { key: 'char', icon: 'user', to: '/map' },
      { key: 'world', icon: 'layers', to: '/map' },
    ],
  },
  {
    key: 'tools',
    icon: 'bag',
    topics: [
      { key: 'hunt', icon: 'target', to: '/map' },
      { key: 'zone', icon: 'frame', to: '/map' },
      { key: 'profit', icon: 'coins', to: '/map' },
      { key: 'split', icon: 'scale', to: '/map' },
      { key: 'log', icon: 'clock', to: '/map' },
      { key: 'bless', icon: 'shield', to: '/map' },
      { key: 'rashid', icon: 'bell', to: '/rashid' },
    ],
  },
  {
    key: 'bestiary',
    icon: 'claw',
    topics: [
      { key: 'browse', icon: 'search', to: '/browse/creature' },
      { key: 'entry', icon: 'book', to: '/browse/creature' },
      { key: 'combat', icon: 'shield' },
      { key: 'loot', icon: 'box' },
      { key: 'kills', icon: 'chart' },
    ],
  },
  {
    key: 'items',
    icon: 'box',
    topics: [
      { key: 'album', icon: 'grid', to: '/items' },
      { key: 'detail', icon: 'scale', to: '/items' },
      { key: 'trade', icon: 'coins', to: '/items' },
      { key: 'config', icon: 'sliders', to: '/items' },
    ],
  },
  {
    key: 'data',
    icon: 'chart',
    topics: [
      { key: 'killstats', icon: 'chart', to: '/killstats' },
      { key: 'pulse', icon: 'flame', to: '/map' },
      { key: 'prices', icon: 'house', to: '/map' },
      { key: 'soundtrack', icon: 'music', to: '/soundtrack' },
    ],
  },
  {
    key: 'games',
    icon: 'game',
    topics: [
      { key: 'wordle', icon: 'game', to: '/wordle' },
      { key: 'altar', icon: 'sparkle', to: '/altar' },
      { key: 'geo', icon: 'pin', to: '/geo' },
      { key: 'board', icon: 'trophy' },
    ],
  },
]

/** Accent- and case-insensitive, so "hunt" finds "Hunt" and "raton" finds "ratón". */
const norm = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()

/** Wraps every occurrence of `q` in the text so search hits stand out. */
function highlight(text: string, q: string): ReactNode {
  if (!q) return text
  const hay = norm(text)
  const needle = norm(q)
  const out: ReactNode[] = []
  let from = 0
  let at = hay.indexOf(needle)
  while (at !== -1 && needle) {
    out.push(text.slice(from, at))
    out.push(
      <mark key={`${at}-${from}`} className="rounded bg-accent/20 px-0.5 text-fg">
        {text.slice(at, at + needle.length)}
      </mark>,
    )
    from = at + needle.length
    at = hay.indexOf(needle, from)
  }
  out.push(text.slice(from))
  return out
}

function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name] ?? ICONS.compass} />
    </svg>
  )
}

/**
 * "How to use Tibia Atlas" — the site's manual in a single dialog: a chapter
 * rail on the left, cards on the right, and a search box that cuts across every
 * chapter. Opens from the map's "?" slot (auto-opens once on a first visit) and
 * from the footer link.
 */
export function SiteGuide({
  open,
  onClose,
  chapter,
}: {
  open: boolean
  onClose: () => void
  /** Chapter to land on — the map passes 'map' so its "?" opens the map manual. */
  chapter?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [active, setActive] = useState(chapter ?? CHAPTERS[0].key)
  const [q, setQ] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Every (re)open starts clean, on the chapter the caller asked for.
  useEffect(() => {
    if (!open) return
    setActive(chapter ?? CHAPTERS[0].key)
    setQ('')
  }, [open, chapter])

  // Escape closes; "/" jumps to the search box.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // A new chapter always starts read from the top.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [active, q])

  function close() {
    markSeen()
    onClose()
  }

  /** The map answers to both "/" (landing page) and "/map" — no link to here. */
  const alreadyHere = (to: string) =>
    to === pathname || (to === '/map' && (pathname === '/' || pathname === '/map'))

  function goTo(to: string) {
    close()
    if (!alreadyHere(to)) navigate(to)
  }

  const copy = (ch: string, key: string, field: 'title' | 'body') =>
    t(`guide.ch.${ch}.t.${key}.${field}`)

  // Search runs across every chapter; empty query falls back to the open one.
  const hits = useMemo(() => {
    const needle = norm(q.trim())
    if (!needle) return null
    const out: { ch: Chapter; topic: Topic }[] = []
    for (const ch of CHAPTERS) {
      for (const topic of ch.topics) {
        const hay = norm(
          `${copy(ch.key, topic.key, 'title')} ${copy(ch.key, topic.key, 'body')} ${t(
            `guide.ch.${ch.key}.title`,
          )}`,
        )
        if (hay.includes(needle)) out.push({ ch, topic })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, t])

  if (!open) return null

  const current = CHAPTERS.find((c) => c.key === active) ?? CHAPTERS[0]
  const shown: { ch: Chapter; topic: Topic }[] =
    hits ?? current.topics.map((topic) => ({ ch: current, topic }))

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={t('guide.title')}
    >
      <div
        className="flex h-[min(88vh,46rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-bg-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — title, cross-chapter search, close */}
        <div className="flex items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
              {t('guide.kicker')}
            </p>
            <h2 className="mt-0.5 truncate text-lg font-black tracking-tight text-fg">
              {t('guide.title')}
            </h2>
            <p className="mt-0.5 hidden text-xs text-fg-mute sm:block">{t('guide.subtitle')}</p>
          </div>

          <div className="relative mt-1 hidden w-56 shrink-0 sm:block">
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-fg-mute" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('guide.search')}
              aria-label={t('guide.search')}
              className="h-9 w-full rounded-lg border border-line bg-bg pl-8 pr-7 text-sm text-fg outline-none transition placeholder:text-fg-mute focus:border-accent"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                aria-label={t('guide.searchClear')}
                className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded text-fg-mute transition hover:text-fg"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <button
            onClick={close}
            aria-label={t('guide.close')}
            className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-fg-mute transition hover:bg-line/40 hover:text-fg"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Chapter rail — a scrollable chip row on phones, a column on desktop */}
          <nav
            aria-label={t('guide.chapters')}
            className="scroll-atlas flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-3 py-2 sm:w-52 sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden sm:border-b-0 sm:border-r sm:px-2.5 sm:py-3"
          >
            {CHAPTERS.map((ch) => {
              const on = !hits && ch.key === active
              return (
                <button
                  key={ch.key}
                  onClick={() => {
                    setQ('')
                    setActive(ch.key)
                  }}
                  aria-current={on}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-bold transition sm:w-full ${
                    on
                      ? 'bg-accent/12 text-accent'
                      : 'text-fg-dim hover:bg-line/30 hover:text-fg'
                  }`}
                >
                  <Icon name={ch.icon} className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap sm:truncate">{t(`guide.ch.${ch.key}.title`)}</span>
                  <span className="ml-auto hidden text-[11px] font-semibold text-fg-mute sm:block">
                    {ch.topics.length}
                  </span>
                </button>
              )
            })}
          </nav>

          {/* Content */}
          <div ref={bodyRef} className="scroll-atlas min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {/* Phone search — the header has no room for it */}
            <div className="relative mb-3 sm:hidden">
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-fg-mute" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('guide.search')}
                aria-label={t('guide.search')}
                className="h-9 w-full rounded-lg border border-line bg-bg pl-8 pr-3 text-sm text-fg outline-none transition placeholder:text-fg-mute focus:border-accent"
              />
            </div>

            <div key={hits ? `q:${q}` : active} className="tm-tour-step">
              {/* Chapter heading (hidden while searching — results span chapters) */}
              {hits ? (
                <p className="mb-3 text-xs font-bold uppercase tracking-widest text-fg-mute">
                  {t('guide.results', { count: hits.length })}
                </p>
              ) : (
                <div className="mb-4">
                  <h3 className="text-base font-black tracking-tight text-fg">
                    {t(`guide.ch.${current.key}.title`)}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-fg-dim">
                    {t(`guide.ch.${current.key}.blurb`)}
                  </p>
                </div>
              )}

              {hits && hits.length === 0 && (
                <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-mute">
                  {t('guide.noResults', { q: q.trim() })}
                </p>
              )}

              <ul className="space-y-2.5">
                {shown.map(({ ch, topic }) => (
                  <li
                    key={`${ch.key}.${topic.key}`}
                    className="flex gap-3 rounded-xl border border-line/70 bg-bg/40 p-3.5 transition hover:border-line-2"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                      <Icon name={topic.icon} />
                    </span>
                    <div className="min-w-0">
                      {hits && (
                        <p className="text-[10px] font-bold uppercase tracking-widest text-fg-mute">
                          {t(`guide.ch.${ch.key}.title`)}
                        </p>
                      )}
                      <h4 className="text-sm font-black tracking-tight text-fg">
                        {highlight(copy(ch.key, topic.key, 'title'), q.trim())}
                      </h4>
                      <p className="mt-1 text-[13px] leading-relaxed text-fg-dim">
                        {highlight(copy(ch.key, topic.key, 'body'), q.trim())}
                      </p>
                      {topic.to && !alreadyHere(topic.to) && (
                        <button
                          onClick={() => goTo(topic.to!)}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-accent transition hover:gap-1.5"
                        >
                          {t('guide.go')}
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Footer — where to find this again, and the way out */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
          <p className="hidden text-[11px] leading-snug text-fg-mute sm:block">{t('guide.hint')}</p>
          <div className="ml-auto flex items-center gap-2">
            {!hits && (
              <ChapterStep
                label={t('guide.nextChapter')}
                onClick={() => {
                  const i = CHAPTERS.findIndex((c) => c.key === current.key)
                  setActive(CHAPTERS[(i + 1) % CHAPTERS.length].key)
                }}
              />
            )}
            <button
              onClick={close}
              className="h-9 rounded-lg bg-accent px-5 text-sm font-bold text-white transition hover:bg-accent-2"
            >
              {t('guide.done')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChapterStep({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-9 rounded-lg border border-line bg-bg-2 px-4 text-sm font-bold text-fg-dim transition hover:border-line-2 hover:text-fg"
    >
      {label}
    </button>
  )
}
