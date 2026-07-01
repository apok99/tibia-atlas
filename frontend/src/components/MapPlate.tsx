import { Link } from 'react-router-dom'

// A small slice of the real world (Thais region, surface floor) as a 4×2 tile
// mosaic — used as a framed "map plate" on the home hero.
const TILE_X = [31744, 32000, 32256, 32512]
const TILE_Y = [32000, 32256]
const TILES = TILE_Y.flatMap((y) => TILE_X.map((x) => `/minimap/Minimap_Color_${x}_${y}_7.png`))

// A couple of hand-placed ink marks — the kind of annotation a person scribbles
// on their own map, not a generated stat pill.
const MARKS = [
  { left: '30%', top: '38%', note: 'aquí cazan dragones' },
  { left: '68%', top: '62%', note: 'ruinas' },
]

/**
 * The world map as a plate torn from the atlas: the real minimap, aged to sepia
 * and set in a double-ruled frame with a compass, a Latin caption and a wax
 * seal — deliberately hand-made, not a dashboard card.
 */
export function MapPlate() {
  return (
    <figure className="atlas-plate relative m-0 p-3">
      <figcaption className="mb-2 flex items-baseline justify-between px-0.5">
        <span className="font-title text-[11px] uppercase tracking-[0.22em] text-fg-dim">
          Tabula Tibiæ
        </span>
        <span className="font-title text-[10px] uppercase tracking-[0.2em] text-fg-mute">N ↑</span>
      </figcaption>

      <Link
        to="/map"
        className="group relative block overflow-hidden rounded-[2px] border border-line-2"
      >
        {/* Real minimap mosaic, aged to sepia so it reads as an old map, not a screenshot. */}
        <div className="grid aspect-[2/1] grid-cols-4 grid-rows-2">
          {TILES.map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              className="h-full w-full object-cover transition duration-500 group-hover:saturate-100"
              style={{ imageRendering: 'pixelated', filter: 'sepia(0.55) saturate(0.8) contrast(1.05)' }}
            />
          ))}
        </div>

        {/* Aged vignette to blend the plate into the parchment. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ boxShadow: 'inset 0 0 44px rgba(74,54,26,0.55)' }}
        />

        {/* Hand-inked annotations. */}
        {MARKS.map((m) => (
          <span
            key={m.note}
            className="pointer-events-none absolute hidden -translate-x-1/2 -translate-y-1/2 sm:block"
            style={{ left: m.left, top: m.top }}
          >
            <span className="mb-0.5 block text-center text-lg leading-none text-accent">✕</span>
            <span className="whitespace-nowrap font-title text-[9px] italic tracking-wide text-fg">
              {m.note}
            </span>
          </span>
        ))}

        {/* Wax-seal call to action. */}
        <span className="absolute bottom-3 right-3 grid h-16 w-16 place-items-center rounded-full bg-accent text-center font-title text-[9px] font-medium uppercase leading-tight tracking-[0.08em] text-[color:var(--color-surface)] shadow-lg shadow-black/30 transition group-hover:scale-105">
          Abrir<br />el mapa
        </span>
      </Link>

      {/* Coordinate ticks along the bottom edge, like a real chart. */}
      <div className="mt-1.5 flex justify-between px-1 text-[8px] italic text-fg-mute">
        <span>32°O</span>
        <span>· · · · ·</span>
        <span>34°E</span>
      </div>
    </figure>
  )
}
