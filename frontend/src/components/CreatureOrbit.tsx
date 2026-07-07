import { CountUp } from './CountUp'
import { compact } from '../lib/format'

export interface OrbitItem {
  race: string
  killed: number
  image: string | null
  slug?: string | null
}

/**
 * Hypnotic centerpiece: the top creatures arranged on a circle that slowly
 * rotates. Each sprite counter-rotates so it stays upright while it orbits.
 * The non-rotating core shows a headline figure (e.g. total killed / 24h).
 */
export function CreatureOrbit({
  items,
  coreValue,
  coreLabel,
  coreSub,
  duration = 54,
  radius = 39,
}: {
  items: OrbitItem[]
  coreValue: number
  coreLabel: string
  coreSub?: string
  duration?: number
  radius?: number
}) {
  const ring = items.slice(0, 10)
  const n = ring.length || 1
  const spin = { animationDuration: `${duration}s` }

  return (
    <div className="ks-orbit">
      {/* rotating radar sweep + concentric guide rings */}
      <div className="ks-orbit-radar" />
      <div className="ks-orbit-track" />
      <div className="ks-orbit-track ks-orbit-track-2" />

      {/*
        The ring is only mounted once the creatures exist, so the ring's
        rotation and each sprite's counter-rotation start their CSS animations
        in the SAME paint and stay perfectly inverse — otherwise the ring (which
        mounts with the page) and the sprites (which mount when data arrives a
        few hundred ms later) drift out of phase and the sprites look tilted.
      */}
      {ring.length > 0 && (
        <div className="ks-orbit-ring" style={spin}>
          {ring.map((c, i) => {
            const angle = (i / n) * 2 * Math.PI - Math.PI / 2 // start at top, clockwise
            const left = 50 + radius * Math.cos(angle)
            const top = 50 + radius * Math.sin(angle)
            return (
              <div key={c.race} className="ks-orbit-slot" style={{ left: `${left}%`, top: `${top}%` }}>
                <div className="ks-orbit-sprite" style={spin}>
                  <span className="ks-orbit-rank">{i + 1}</span>
                  {c.image ? (
                    <img src={c.image} alt={c.race} loading="lazy" />
                  ) : (
                    <span className="ks-orbit-skull">☠</span>
                  )}
                  <span className="ks-orbit-count">{compact(c.killed)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* still core */}
      <div className="ks-orbit-core">
        <span className="ks-orbit-core-pulse" />
        <CountUp value={coreValue} className="ks-orbit-core-value" />
        <span className="ks-orbit-core-label">{coreLabel}</span>
        {coreSub && <span className="ks-orbit-core-sub">{coreSub}</span>}
      </div>
    </div>
  )
}
