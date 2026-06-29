import { useTranslation } from 'react-i18next'
import { compact } from './CountUp'
import type { KillWorld } from '../hooks/useKillStats'

const REGION_COLOR: Record<string, string> = {
  Europe: '#6fa8c4',
  'South America': '#d8a23a',
  'North America': '#d23d2f',
  'Oceania': '#79b169',
}
const FALLBACK = '#8a8577'

/**
 * "Pulse of the worlds": every game world as a glowing orb whose size maps to
 * its online population and whose colour maps to its region. The orbs twinkle
 * with staggered delays for a living, hypnotic server-wall effect.
 */
export function WorldPulse({ worlds }: { worlds: KillWorld[] }) {
  const { t } = useTranslation()
  if (!worlds.length) return null

  const sorted = [...worlds].sort((a, b) => b.players_online - a.players_online)
  const max = sorted[0].players_online || 1
  const online = sorted.filter((w) => w.players_online > 0).length

  const regions = Object.entries(REGION_COLOR)

  return (
    <section className="ks-panel mt-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="ks-panel-title">{t('ks.pulseTitle')}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-mute">
          {regions.map(([name, color]) => (
            <span key={name} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
              {name}
            </span>
          ))}
        </div>
      </div>
      <p className="mb-4 text-xs text-fg-mute">{t('ks.pulseHint', { n: online })}</p>

      <div className="ks-pulse-grid">
        {sorted.map((w, i) => {
          const ratio = w.players_online / max
          const size = 12 + Math.sqrt(ratio) * 38 // 12..50px, sqrt so small worlds stay visible
          const color = REGION_COLOR[w.location ?? ''] ?? FALLBACK
          return (
            <span
              key={w.name}
              className="ks-orb"
              style={{
                width: `${size}px`,
                height: `${size}px`,
                background: color,
                boxShadow: `0 0 ${6 + ratio * 18}px ${color}`,
                animationDelay: `${(i % 24) * 0.12}s`,
                opacity: w.players_online > 0 ? 1 : 0.25,
              }}
            >
              <span className="ks-orb-tip">
                {w.name} · {compact(w.players_online)}
              </span>
            </span>
          )
        })}
      </div>
    </section>
  )
}
