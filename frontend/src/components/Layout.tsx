import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { PlayerBar } from './PlayerBar'
import { SearchBox } from './SearchBox'

type NavItem = { to: string; key: string; end?: boolean }

// The atlas has few, clear "chapters" — the map is the star, then the bestiary,
// the library and the daily game. Everything else lives under "Más" so the bar
// stays uncluttered and focused (the whole point of the redesign).
const primaryNav: NavItem[] = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/map', key: 'nav.map' },
  { to: '/wordle', key: 'nav.wordle' },
  { to: '/browse/creature', key: 'nav.bestiary' },
  { to: '/history', key: 'nav.library' },
]

const moreNav: NavItem[] = [
  { to: '/browse/npc', key: 'nav.npcs' },
  { to: '/browse/character', key: 'nav.characters' },
  { to: '/browse/city', key: 'nav.cities' },
  { to: '/items', key: 'nav.items' },
  { to: '/quests', key: 'nav.quests' },
  { to: '/timeline', key: 'nav.timeline' },
  { to: '/killstats', key: 'nav.killstats' },
  { to: '/soundtrack', key: 'nav.soundtrack' },
]

// Flat list for the mobile menu (shows everything at once).
const allNav: NavItem[] = [...primaryNav, ...moreNav]

/** Small ink compass-rose — the brand mark. */
function CompassRose({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="25" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
      <polygon points="50,9 57,50 50,91 43,50" fill="currentColor" />
      <polygon points="9,50 50,43 91,50 50,57" fill="var(--color-accent)" />
      <circle cx="50" cy="50" r="3.5" fill="currentColor" />
    </svg>
  )
}

export function Layout() {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line-2 bg-bg/92 backdrop-blur-md">
        {/* Gilt double-rule at the very top — the edge of a bound page. */}
        <div className="h-px w-full bg-gold/70" />
        <div className="h-px w-full bg-gold/30" />

        <div className="mx-auto flex max-w-[86rem] items-center gap-5 px-4 py-2.5">
          <Link to="/" className="flex shrink-0 items-center gap-3">
            <CompassRose className="h-9 w-9 shrink-0 text-fg" />
            <span className="leading-none">
              <span className="font-title block whitespace-nowrap text-[1.15rem] font-semibold tracking-[0.08em] text-fg">
                TIBIA <span className="text-accent">ATLAS</span>
              </span>
              <span className="mt-0.5 hidden text-[11px] italic text-fg-mute sm:block">
                {t('brandSub')}
              </span>
            </span>
          </Link>

          <DesktopNav />

          {/* Search fills the centre of the bar on desktop. */}
          <div className="hidden flex-1 justify-center px-2 xl:flex">
            <div className="w-full max-w-xs">
              <SearchBox placeholder={t('nav.search')} />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle />
            <LanguageSwitcher />
            {/* Hamburger — only below lg */}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={t('nav.menu')}
              aria-expanded={menuOpen}
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-[2px] border border-line-2 bg-surface text-fg-dim transition hover:text-accent lg:hidden"
            >
              {menuOpen ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile / tablet menu */}
        {menuOpen && (
          <>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 top-[var(--header-h,57px)] z-20 cursor-default bg-black/30 backdrop-blur-sm lg:hidden"
            />
            <nav className="relative z-30 max-h-[calc(100vh-57px)] overflow-y-auto border-t border-line bg-bg-2 px-4 py-3 lg:hidden">
              <div className="mx-auto grid max-w-[86rem] grid-cols-2 gap-1 sm:grid-cols-3">
                {allNav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `nav-link rounded-[2px] px-3 py-2.5 ${
                        isActive
                          ? 'bg-accent/12 text-accent'
                          : 'hover:bg-surface hover:text-fg'
                      }`
                    }
                  >
                    {t(item.key)}
                  </NavLink>
                ))}
              </div>
            </nav>
          </>
        )}
      </header>

      <main className="mx-auto w-full max-w-[86rem] flex-1 px-4 py-8">
        {/* Route pages are lazy chunks; keep the chrome visible while one loads. */}
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>

      <PlayerBar />

      <footer className="mt-8 border-t border-line-2 px-4 py-8 text-center">
        <CompassRose className="mx-auto mb-3 h-7 w-7 text-fg-mute" />
        <p className="font-title text-xs uppercase tracking-[0.18em] text-fg-dim">Tibia Atlas</p>
        <p className="mx-auto mt-2 max-w-md text-sm italic text-fg-mute">
          {t('footer.signature')}
        </p>
        <p className="mt-3 text-[11px] text-fg-mute/80">
          {t('footer.disclaimer')}
        </p>
      </footer>
    </div>
  )
}

/**
 * Desktop navigation: a focused row of chapter links (map / bestiary / library /
 * game) plus a single "Más" dropdown for the secondary sections. A link lights
 * up in seal-red when its route is active.
 */
function DesktopNav() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const isItemActive = (item: NavItem) =>
    item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + '/')

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link rounded-[2px] px-3 py-2 ${
      isActive ? 'text-accent' : 'hover:text-fg'
    }`

  const moreActive = moreNav.some(isItemActive)

  return (
    <nav className="hidden shrink-0 items-center gap-0.5 lg:flex">
      {primaryNav.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
          {t(item.key)}
        </NavLink>
      ))}

      <div
        className="relative"
        onMouseEnter={() => {
          clearTimeout(closeTimer.current)
          setOpen(true)
        }}
        onMouseLeave={() => {
          closeTimer.current = setTimeout(() => setOpen(false), 120)
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`nav-link flex cursor-pointer items-center gap-1 rounded-[2px] px-3 py-2 ${
            moreActive || open ? 'text-accent' : 'hover:text-fg'
          }`}
        >
          {t('nav.more')}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {open && (
          <div className="absolute left-0 top-full z-30 pt-2">
            <div className="panel min-w-[12rem] overflow-hidden py-1 shadow-xl">
              {moreNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `nav-link block px-4 py-2 ${
                      isActive
                        ? 'bg-accent/12 text-accent'
                        : 'hover:bg-surface-2 hover:text-fg'
                    }`
                  }
                >
                  {t(item.key)}
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
