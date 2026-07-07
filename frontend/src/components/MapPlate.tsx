import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRandomEntries } from '../hooks/useEntries'

// A slice of the real world (Thais region, surface floor) as a 4×3 tile mosaic
// — bigger and more square than before.
const TILE_X = [31744, 32000, 32256, 32512]
const TILE_Y = [31744, 32000, 32256]
const TILES = TILE_Y.flatMap((y) => TILE_X.map((x) => `/minimap/Minimap_Color_${x}_${y}_7.png`))

// Where the example creatures sit on the map. Colours echo the live map overlay.
const SPOTS = [
  { left: '26%', top: '30%', color: '#ff7a33' },
  { left: '60%', top: '26%', color: '#e0a531' },
  { left: '72%', top: '56%', color: '#d23d2f' },
  { left: '38%', top: '64%', color: '#ff7a33' },
  { left: '82%', top: '38%', color: '#e0a531' },
]

/** Small ink compass-rose for the plate header. */
function CompassRose() {
  return (
    <svg viewBox="0 0 100 100" className="h-5 w-5 text-fg-dim" aria-hidden="true">
      <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="3" />
      <polygon points="50,10 57,50 50,90 43,50" fill="currentColor" />
      <polygon points="10,50 50,43 90,50 50,57" fill="var(--color-accent)" />
      <circle cx="50" cy="50" r="3.5" fill="currentColor" />
    </svg>
  )
}

/**
 * The world map as a plate torn from the atlas: the real minimap, aged to sepia,
 * in a double-ruled frame, with example creatures pinned to it and an ink bar to
 * open the full interactive map.
 */
export function MapPlate() {
  const { t } = useTranslation()
  const { data: random } = useRandomEntries(12, { preferImages: true })

  const pinned = useMemo(() => {
    const creatures = (random ?? []).filter((e) => e.type === 'creature' && e.primary_image)
    return SPOTS.map((s, i) => ({ ...s, creature: creatures[i] ?? null }))
  }, [random])

  return (
    <figure className="atlas-plate relative m-0 p-3">
      <figcaption className="mb-2 flex items-center justify-between px-0.5">
        <span className="font-title text-[13px] uppercase tracking-[0.18em] text-fg">
          El mundo de Tibia
        </span>
        <CompassRose />
      </figcaption>

      <Link
        to="/map"
        className="group relative block overflow-hidden rounded-[2px] border border-line-2"
      >
        {/* Real minimap mosaic, aged to sepia so it reads as an old map. */}
        <div className="grid aspect-[4/3] grid-cols-4 grid-rows-3">
          {TILES.map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition duration-500 group-hover:saturate-100"
              style={{ imageRendering: 'pixelated', filter: 'sepia(0.5) saturate(0.85) contrast(1.05)' }}
            />
          ))}
        </div>

        {/* Aged vignette to blend the plate into the parchment. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ boxShadow: 'inset 0 0 44px rgba(74,54,26,0.5)' }}
        />

        {/* Example creatures pinned to the map, each with a pulsing ring. */}
        {pinned.map((p, i) => (
          <span
            key={i}
            className="pointer-events-none absolute z-[1] hidden -translate-x-1/2 -translate-y-1/2 sm:block"
            style={{ left: p.left, top: p.top }}
          >
            <span
              className="absolute inset-0 animate-ping rounded-full"
              style={{ background: p.color, opacity: 0.3 }}
            />
            <span
              className="relative grid h-9 w-9 place-items-center rounded-full border-2 bg-bg/85 shadow-lg backdrop-blur-sm transition group-hover:scale-110"
              style={{ borderColor: p.color }}
            >
              {p.creature?.primary_image ? (
                <img
                  src={p.creature.primary_image}
                  alt={p.creature.name ?? ''}
                  loading="lazy"
                  className="sprite max-h-6 max-w-6 object-contain"
                />
              ) : (
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              )}
            </span>
          </span>
        ))}

        {/* Ink bar to open the interactive map. */}
        <span className="absolute inset-x-0 bottom-0 z-[2] flex items-center justify-between gap-2 bg-fg/85 px-4 py-2.5 font-title text-[11px] uppercase tracking-[0.12em] text-[color:var(--color-surface)] backdrop-blur-sm">
          {t('home.openMapFull')}
          <span className="transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>
        </span>
      </Link>
    </figure>
  )
}
