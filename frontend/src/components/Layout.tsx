import { NavLink, Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from './LanguageSwitcher'
import { PlayerBar } from './PlayerBar'

const navItems = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/browse/creature', key: 'nav.bestiary' },
  { to: '/browse/character', key: 'nav.characters' },
  { to: '/browse/city', key: 'nav.cities' },
  { to: '/quests', key: 'nav.quests' },
  { to: '/items', key: 'nav.items' },
  { to: '/history', key: 'nav.library' },
  { to: '/map', key: 'nav.map' },
  { to: '/killstats', key: 'nav.killstats' },
  { to: '/timeline', key: 'nav.timeline' },
  { to: '/soundtrack', key: 'nav.soundtrack' },
]

export function Layout() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md">
        {/* thin accent line at the very top */}
        <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded bg-accent text-sm font-black text-white shadow-[0_2px_8px_-2px_rgba(210,61,47,0.7)]">
              TA
            </span>
            <span className="text-lg font-black tracking-tight">
              Tibia<span className="text-accent">Atlas</span>
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `relative px-3 py-2 text-xs font-bold uppercase tracking-widest transition ${
                    isActive ? 'text-accent' : 'text-fg-mute hover:text-fg'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {t(item.key)}
                    {isActive && (
                      <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 lg:ml-2">
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <PlayerBar />

      <footer className="border-t border-line px-4 py-6 text-center text-xs text-fg-mute">
        <span className="font-bold uppercase tracking-widest text-fg-dim">Tibia Atlas</span> ·{' '}
        {t('tagline')} · <span className="opacity-70">Fan project — not affiliated with CipSoft.</span>
      </footer>
    </div>
  )
}
