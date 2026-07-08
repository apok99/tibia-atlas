import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// localStorage flag so the tour only auto-opens on a visitor's first visit.
const SEEN_KEY = 'tibia_atlas_map_tour_seen'

export function mapTourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // storage blocked → don't nag
  }
}

function markTourSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

// Each step maps a hotbar/feature to a short explanation. `icon` is a Lucide-style
// 24×24 path matching the real control it describes; `key` picks the i18n copy.
type Step = { key: string; icon: string }
const STEPS: Step[] = [
  // compass / move around
  { key: 'nav', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z' },
  // search — creature
  { key: 'creature', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3' },
  // item drop
  { key: 'item', icon: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10' },
  // eye — spawns layer
  { key: 'spawns', icon: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  // skull — bosses
  { key: 'boss', icon: 'M9 12h.01M15 12h.01M8 20v2h8v-2M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20' },
  // sliders — filters
  { key: 'filters', icon: 'M4 6h16M7 12h10M10 18h4' },
  // navigation arrow — directions
  { key: 'directions', icon: 'M3 11 22 2l-9 19-2-8z' },
  // shared route — create & share
  { key: 'routes', icon: 'M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17.5 16 6.5' },
]

/** Guided onboarding for the map: a step-by-step tour of search, spawns, bosses,
 *  filters, directions and route-building. Auto-opens on a first visit; the map's
 *  "?" button reopens it any time. */
export function MapTutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [i, setI] = useState(0)

  // Reset to the first step every time it (re)opens.
  useEffect(() => {
    if (open) setI(0)
  }, [open])

  // Close on Escape while the tour is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close() {
    markTourSeen()
    onClose()
  }

  if (!open) return null

  const last = i === STEPS.length - 1
  const step = STEPS[i]

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={t('map.tutorial.title')}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-bg-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-4 pt-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
              {t('map.tutorial.step', { n: i + 1, total: STEPS.length })}
            </p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-fg">
              {t('map.tutorial.title')}
            </h2>
          </div>
          <button
            onClick={close}
            aria-label={t('map.tutorial.done')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-mute transition hover:bg-line/40 hover:text-fg"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — the current step */}
        <div key={step.key} className="tm-tour-step flex flex-col items-center px-6 py-7 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl border-2 border-accent/30 bg-accent/10 text-accent">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d={step.icon} />
            </svg>
          </span>
          <h3 className="mt-4 text-base font-black tracking-tight text-fg">
            {t(`map.tutorial.steps.${step.key}.title`)}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-fg-dim">
            {t(`map.tutorial.steps.${step.key}.body`)}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 pb-1">
          {STEPS.map((s, idx) => (
            <button
              key={s.key}
              onClick={() => setI(idx)}
              aria-label={t(`map.tutorial.steps.${s.key}.title`)}
              aria-current={idx === i}
              className={`h-1.5 rounded-full transition-all ${
                idx === i ? 'w-5 bg-accent' : 'w-1.5 bg-line hover:bg-line-2'
              }`}
            />
          ))}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <button
            onClick={close}
            className="text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-fg"
          >
            {t('map.tutorial.skip')}
          </button>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <button
                onClick={() => setI((v) => v - 1)}
                className="h-9 rounded-lg border border-line bg-bg-2 px-4 text-sm font-bold text-fg-dim transition hover:border-line-2 hover:text-fg"
              >
                {t('map.tutorial.back')}
              </button>
            )}
            <button
              onClick={() => (last ? close() : setI((v) => v + 1))}
              className="h-9 rounded-lg bg-accent px-5 text-sm font-bold text-white transition hover:bg-accent-2"
            >
              {last ? t('map.tutorial.done') : t('map.tutorial.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
