import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY = 'tibia_atlas_cookies'

/**
 * Consent banner. The site only uses functional local storage (language, theme,
 * player volume, game progress) and no tracking, so a single "Accept" is enough —
 * there is nothing to opt out of. We remember the choice in local storage so the
 * banner does not come back on every visit.
 */
export function CookieBanner() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  // Read the stored choice on mount (client-only; avoids SSR/hydration flashes).
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== 'ok') setVisible(true)
    } catch {
      // Storage blocked (private mode, etc.) — just show the banner.
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'ok')
    } catch {
      /* ignore — nothing else depends on it persisting */
    }
    setVisible(false)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-4 sm:pb-4">
      <div
        role="dialog"
        aria-label={t('cookies.accept')}
        className="panel mx-auto flex max-w-[86rem] flex-col gap-3 p-4 shadow-xl sm:flex-row sm:items-center sm:gap-5"
      >
        <p className="flex-1 text-sm leading-relaxed text-fg-dim">
          {t('cookies.message')}{' '}
          <Link to="/about" className="underline decoration-fg-mute/40 underline-offset-2 hover:text-fg">
            {t('cookies.more')}
          </Link>
        </p>
        <button
          type="button"
          onClick={accept}
          className="shrink-0 cursor-pointer rounded-[2px] border border-accent bg-accent px-5 py-2 text-sm font-semibold tracking-wide text-white transition hover:brightness-110"
        >
          {t('cookies.accept')}
        </button>
      </div>
    </div>
  )
}
