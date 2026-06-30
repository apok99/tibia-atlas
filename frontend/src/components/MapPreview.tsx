import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useGlossary } from '../hooks/useGlossary'
import { useRandomEntries } from '../hooks/useEntries'

// A 4×2 mosaic of real minimap tiles centred on the Thais region (surface,
// floor 7). 4 wide / 2 tall keeps every 256×256 tile square in a 2:1 frame, so
// the crop reads as an actual slice of the world rather than a stretched image.
const TILE_X = [31744, 32000, 32256, 32512]
const TILE_Y = [32000, 32256]
const TILES = TILE_Y.flatMap((y) => TILE_X.map((x) => `/minimap/Minimap_Color_${x}_${y}_7.png`))

// Headline "power" figures. Floors/cities/regions mirror the map page's own
// data (16 game floors, 18 landmark cities, 35 named regions); the creature
// count is filled in live from the glossary.
const FLOORS = 16
const CITIES = 18
const REGIONS = 35

// Where the creature sprites sit on the map — kept to the right-hand side so
// they stay over the visible minimap and clear of the text panel on the left.
// Colours echo the map's overlay legend (orange / gold / red).
const SPOTS = [
  { left: '64%', top: '26%', color: '#ff7a33', delay: '0s' },
  { left: '82%', top: '40%', color: '#e0a531', delay: '0.7s' },
  { left: '70%', top: '64%', color: '#ff7a33', delay: '1.3s' },
  { left: '90%', top: '68%', color: '#d23d2f', delay: '1.9s' },
  { left: '58%', top: '78%', color: '#ff7a33', delay: '2.5s' },
]

/**
 * Home "world map" showcase: a real minimap crop with live creature sprites
 * pinned to it (pulsing like the map's spawn overlay), a few headline figures
 * conveying the map's scope, and a CTA into the full interactive map page.
 */
export function MapPreview() {
  const { t } = useTranslation()
  const { data: glossary } = useGlossary()
  const { data: randomEntries } = useRandomEntries(12, { preferImages: true })

  const creatureCount = useMemo(
    () => (glossary ? glossary.filter((g) => g.type === 'creature').length : null),
    [glossary],
  )

  // A handful of real creatures (with sprites) to pin on the map.
  const pinned = useMemo(() => {
    const creatures = (randomEntries ?? []).filter((e) => e.type === 'creature' && e.primary_image)
    return SPOTS.map((spot, i) => ({ ...spot, creature: creatures[i] ?? null }))
  }, [randomEntries])

  const stats: { value: string; label: string }[] = [
    { value: creatureCount ? `${creatureCount}+` : '—', label: t('home.mapCreatures') },
    { value: `${FLOORS}`, label: t('home.mapFloors') },
    { value: `${CITIES}`, label: t('home.mapCities') },
    { value: `${REGIONS}+`, label: t('home.mapRegions') },
  ]

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-fg">{t('home.worldMap')}</h2>
        <span className="h-px flex-1 bg-line" />
        <Link
          to="/map"
          className="text-[11px] font-bold uppercase tracking-wider text-accent hover:underline"
        >
          {t('home.openMap')}
        </Link>
      </div>

      <Link
        to="/map"
        className="group relative block overflow-hidden rounded-lg border border-line transition hover:border-line-2"
      >
        {/* Real minimap mosaic backdrop */}
        <div className="absolute inset-0">
          <div className="grid h-full w-full grid-cols-4 grid-rows-2">
            {TILES.map((src) => (
              <img
                key={src}
                src={src}
                alt=""
                className="h-full w-full object-cover opacity-70 transition duration-500 group-hover:opacity-90"
                style={{ imageRendering: 'pixelated' }}
              />
            ))}
          </div>
          {/* Readability + framing gradients */}
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/80 to-bg/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg/90 via-transparent to-bg/40" />
        </div>

        {/* Creature sprites pinned to the map, each with a pulsing ring */}
        {pinned.map((p, i) => (
          <span
            key={i}
            className="pointer-events-none absolute z-[1] hidden -translate-x-1/2 -translate-y-1/2 sm:block"
            style={{ left: p.left, top: p.top }}
          >
            <span
              className="absolute inset-0 animate-ping rounded-full"
              style={{ background: p.color, opacity: 0.3, animationDelay: p.delay }}
            />
            <span
              className="relative grid h-10 w-10 place-items-center rounded-full border-2 bg-bg/85 shadow-lg backdrop-blur-sm transition group-hover:scale-110"
              style={{ borderColor: p.color }}
            >
              {p.creature?.primary_image ? (
                <img
                  src={p.creature.primary_image}
                  alt={p.creature.name ?? ''}
                  className="sprite max-h-7 max-w-7 object-contain"
                />
              ) : (
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              )}
            </span>
          </span>
        ))}

        {/* Content overlay */}
        <div className="relative z-[2] flex min-h-[15rem] flex-col justify-center gap-4 p-6 sm:max-w-[60%] sm:p-8">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-accent">
              {t('map.kicker')}
            </p>
            <h3 className="mt-1 text-2xl font-black leading-tight text-fg sm:text-3xl">
              {t('map.title')}
            </h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-fg-dim">
              {t('home.mapPreviewIntro')}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-md border border-line bg-surface/80 px-3 py-1.5 backdrop-blur-sm"
              >
                <span className="font-mono text-sm font-black tabular-nums text-accent-2">
                  {s.value}
                </span>
                <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-mute">
                  {s.label}
                </span>
              </div>
            ))}
          </div>

          <span className="inline-flex w-fit items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent-2">
            {t('home.openMap')}
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </span>
        </div>
      </Link>
    </section>
  )
}
