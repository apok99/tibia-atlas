import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

// Surface floor (7) of Tibia as a full 10×8 grid of 256px minimap tiles. Laid
// out row-major (each Y row left-to-right) so it reads as one continuous world
// band, which we wrap horizontally to fake a spinning globe.
const X = [31744, 32000, 32256, 32512, 32768, 33024, 33280, 33536, 33792, 34048]
const Y = [30976, 31232, 31488, 31744, 32000, 32256, 32512, 32768]
const FLOOR = 7
const TILE = 72
const COLS = X.length
const ROWS = Y.length
const BAND_W = COLS * TILE
const BAND_H = ROWS * TILE

const TILES: string[] = []
for (const y of Y) for (const x of X) TILES.push(`/minimap/Minimap_Color_${x}_${y}_${FLOOR}.png`)

/**
 * A draggable "globe" of the Tibia world. It isn't a true 3D sphere — the map
 * band is translated (wrapping horizontally) and a highlight/limb-shadow overlay
 * sells the spherical read. Drag to spin; it auto-rotates slowly when idle.
 */
export function WorldGlobe({ diameter = 500 }: { diameter?: number }) {
  const bandRef = useRef<HTMLDivElement>(null)
  const offset = useRef({ x: BAND_W * 0.2, y: (BAND_H - diameter) / 2 })
  const drag = useRef<{ active: boolean; px: number; py: number }>({ active: false, px: 0, py: 0 })
  const rafRef = useRef<number | undefined>(undefined)
  const [grabbing, setGrabbing] = useState(false)

  const apply = () => {
    const o = offset.current
    o.x = ((o.x % BAND_W) + BAND_W) % BAND_W
    const maxY = Math.max(0, BAND_H - diameter)
    o.y = Math.min(maxY, Math.max(0, o.y))
    if (bandRef.current) bandRef.current.style.transform = `translate3d(${-o.x}px, ${-o.y}px, 0)`
  }

  useEffect(() => {
    offset.current.y = (BAND_H - diameter) / 2
    apply()
    const loop = () => {
      if (!drag.current.active) {
        offset.current.x += 0.14 // gentle idle spin
        apply()
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diameter])

  const onDown = (e: ReactPointerEvent) => {
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    drag.current = { active: true, px: e.clientX, py: e.clientY }
    setGrabbing(true)
  }
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current.active) return
    offset.current.x -= e.clientX - drag.current.px
    offset.current.y -= e.clientY - drag.current.py
    drag.current.px = e.clientX
    drag.current.py = e.clientY
    apply()
  }
  const onUp = () => {
    drag.current.active = false
    setGrabbing(false)
  }

  return (
    <div className="wg-wrap" style={{ width: diameter, height: diameter }}>
      <span className="wg-glow" />
      <div
        className={`wg-globe ${grabbing ? 'is-grabbing' : ''}`}
        style={{ width: diameter, height: diameter }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label="Globo del mundo de Tibia — arrástralo para girarlo"
      >
        <div className="wg-band" ref={bandRef} style={{ width: BAND_W * 2, height: BAND_H }}>
          {[0, 1].map((copy) => (
            <div
              key={copy}
              className="wg-grid"
              style={{
                width: BAND_W,
                height: BAND_H,
                gridTemplateColumns: `repeat(${COLS}, ${TILE}px)`,
                gridTemplateRows: `repeat(${ROWS}, ${TILE}px)`,
              }}
            >
              {TILES.map((src, i) => (
                <img key={i} src={src} alt="" draggable={false} className="wg-tile" />
              ))}
            </div>
          ))}
        </div>
        <span className="wg-shade" />
        <span className="wg-rim" />
      </div>
    </div>
  )
}
