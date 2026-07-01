import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Theme = 'light' | 'dark'

/** Read the theme set by the inline boot script (see index.html), defaulting
 *  to the parchment "day" atlas so first-time visitors meet the identity. */
function getInitialTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'dark') return 'dark'
  }
  return 'light'
}

/** Day / night switch for the atlas — parchment by daylight, tooled leather by
 *  candlelight. Persists the choice; the boot script applies it before paint. */
export function ThemeToggle() {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* private mode — ignore */
    }
  }, [theme])

  const dark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={t(dark ? 'nav.lightMode' : 'nav.darkMode')}
      title={t(dark ? 'nav.lightMode' : 'nav.darkMode')}
      className="grid h-9 w-9 place-items-center rounded-[2px] border border-line bg-surface text-fg-dim transition hover:text-accent"
    >
      {dark ? (
        /* sun — switch back to the daylight atlas */
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
        </svg>
      ) : (
        /* moon — switch to the candlelit night atlas */
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.5 14.2A8 8 0 0 1 9.8 3.5a0.6 0.6 0 0 0-.8-.75A9 9 0 1 0 21.25 15a0.6 0.6 0 0 0-.75-.8Z" />
        </svg>
      )}
    </button>
  )
}
