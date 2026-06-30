import { useEffect, useRef, useState } from 'react'
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from './LanguageSwitcher'
import { PlayerBar } from './PlayerBar'
import { SearchBox } from './SearchBox'

type NavItem = { to: string; key: string; end?: boolean }

// Flat list — used as-is for the mobile menu, which shows everything at once.
const navItems: NavItem[] = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/browse/creature', key: 'nav.bestiary' },
  { to: '/browse/character', key: 'nav.characters' },
  { to: '/browse/city', key: 'nav.cities' },
  { to: '/quests', key: 'nav.quests' },
  { to: '/items', key: 'nav.items' },
  { to: '/wordle', key: 'nav.wordle' },
  { to: '/history', key: 'nav.library' },
  { to: '/map', key: 'nav.map' },
  { to: '/killstats', key: 'nav.killstats' },
  { to: '/timeline', key: 'nav.timeline' },
  { to: '/soundtrack', key: 'nav.soundtrack' },
]

// Grouped into dropdowns for the desktop bar to keep it uncluttered.
const homeItem: NavItem = navItems[0]
const navGroups: { key: string; items: NavItem[] }[] = [
  {
    key: 'nav.explore',
    items: [
      { to: '/browse/creature', key: 'nav.bestiary' },
      { to: '/browse/character', key: 'nav.characters' },
      { to: '/browse/city', key: 'nav.cities' },
      { to: '/items', key: 'nav.items' },
      { to: '/map', key: 'nav.map' },
    ],
  },
  {
    key: 'nav.lore',
    items: [
      { to: '/history', key: 'nav.library' },
      { to: '/timeline', key: 'nav.timeline' },
      { to: '/quests', key: 'nav.quests' },
    ],
  },
  {
    key: 'nav.play',
    items: [
      { to: '/wordle', key: 'nav.wordle' },
      { to: '/killstats', key: 'nav.killstats' },
      { to: '/soundtrack', key: 'nav.soundtrack' },
    ],
  },
]

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
      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-md">
        {/* thin accent line at the very top */}
        <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3">
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <img
              src="/logo.png"
              alt="Tibia Atlas"
              className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]"
            />
            <span className="text-lg font-black tracking-tight">
              Tibia<span className="text-accent">Atlas</span>
            </span>
          </Link>

          <DesktopNav />

          {/* Search fills the centre of the bar on desktop. */}
          <div className="hidden flex-1 justify-center px-4 lg:flex">
            <div className="w-full max-w-md">
              <SearchBox placeholder={t('nav.search')} />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3 lg:ml-0">
            <LanguageSwitcher />
            {/* Hamburger — only below lg */}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={t('nav.menu')}
              aria-expanded={menuOpen}
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-line bg-surface text-fg-mute transition hover:text-fg lg:hidden"
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
              className="fixed inset-0 top-[var(--header-h,57px)] z-20 cursor-default bg-black/40 backdrop-blur-sm lg:hidden"
            />
            <nav className="relative z-30 max-h-[calc(100vh-57px)] overflow-y-auto border-t border-line bg-bg px-4 py-3 lg:hidden">
              <div className="mx-auto grid max-w-6xl grid-cols-2 gap-1 sm:grid-cols-3">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `rounded-md px-3 py-2.5 text-xs font-bold uppercase tracking-widest transition ${
                        isActive
                          ? 'bg-accent/15 text-accent'
                          : 'text-fg-mute hover:bg-surface hover:text-fg'
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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <PlayerBar />

      {/* Floating shortcut to the daily creature game (hidden on its own page). */}
      {location.pathname !== '/wordle' && (
        <Link
          to="/wordle"
          title={t('wordle.brand')}
          aria-label={t('wordle.brand')}
          className="group fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface shadow-lg shadow-black/30 transition hover:scale-105 hover:border-accent"
        >
          <span className="grid grid-cols-2 gap-0.5">
            <span className="block h-2.5 w-2.5 rounded-[2px] bg-emerald-600 transition group-hover:bg-emerald-500" />
            <span className="block h-2.5 w-2.5 rounded-[2px] bg-amber-500" />
            <span className="block h-2.5 w-2.5 rounded-[2px] bg-zinc-500" />
            <span className="block h-2.5 w-2.5 rounded-[2px] bg-emerald-600" />
          </span>
        </Link>
      )}

      <footer className="border-t border-line px-4 py-6 text-center text-xs text-fg-mute">
        <span className="font-bold uppercase tracking-widest text-fg-dim">Tibia Atlas</span> ·{' '}
        {t('tagline')} · <span className="opacity-70">Fan project — not affiliated with CipSoft.</span>
      </footer>
    </div>
  )
}

/**
 * Desktop navigation: a single "Home" link plus grouped dropdown menus.
 * Menus open on hover (with a small close delay to bridge the gap to the
 * panel) and toggle on click; a group lights up in accent when one of its
 * routes is active.
 */
function DesktopNav() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [open, setOpen] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()

  // Collapse any open menu when the route changes.
  useEffect(() => {
    setOpen(null)
  }, [pathname])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const enter = (key: string) => {
    clearTimeout(closeTimer.current)
    setOpen(key)
  }
  const leave = () => {
    closeTimer.current = setTimeout(() => setOpen(null), 120)
  }

  const isItemActive = (item: NavItem) =>
    item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + '/')

  return (
    <nav className="hidden shrink-0 items-center gap-0.5 lg:flex">
      <NavLink
        to={homeItem.to}
        end={homeItem.end}
        className={({ isActive }) =>
          `rounded-md px-3 py-2 text-xs font-bold uppercase tracking-widest transition ${
            isActive ? 'bg-accent/15 text-accent' : 'text-fg-mute hover:bg-surface hover:text-fg'
          }`
        }
      >
        {t(homeItem.key)}
      </NavLink>

      {navGroups.map((group) => {
        const groupActive = group.items.some(isItemActive)
        const isOpen = open === group.key
        return (
          <div
            key={group.key}
            className="relative"
            onMouseEnter={() => enter(group.key)}
            onMouseLeave={leave}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : group.key)}
              aria-expanded={isOpen}
              className={`flex cursor-pointer items-center gap-1 rounded-md px-3 py-2 text-xs font-bold uppercase tracking-widest transition ${
                groupActive || isOpen
                  ? 'text-accent'
                  : 'text-fg-mute hover:bg-surface hover:text-fg'
              }`}
            >
              {t(group.key)}
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {isOpen && (
              // pt-2 keeps the visual gap inside the hover area so the menu
              // doesn't flicker shut when the cursor crosses into the panel.
              <div className="absolute left-0 top-full z-30 pt-2">
                <div className="panel min-w-[12rem] overflow-hidden py-1 shadow-xl">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `block px-4 py-2 text-xs font-bold uppercase tracking-widest transition ${
                          isActive
                            ? 'bg-accent/15 text-accent'
                            : 'text-fg-mute hover:bg-surface-2 hover:text-fg'
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
        )
      })}
    </nav>
  )
}
