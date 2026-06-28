import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../lib/api'
import { useGlossary } from '../hooks/useGlossary'
import type { Entry, Spawn } from '../types'

// Minimap tiles are 256x256, named Minimap_Color_<gameX>_<gameY>_<floor>.png,
// aligned to a 256-unit grid in Tibia world coordinates.
const TILE = 256

// Bounds of the exported region (Tibia world coordinates), from the tile set.
const X_MIN = 31744
const X_MAX = 34304 // exclusive edge (last tile 34048 + 256)
const Y_MIN = 30976
const Y_MAX = 33024 // exclusive edge (last tile 32768 + 256)

// Floor 7 is the surface/ground level in Tibia; lower numbers are higher up.
const FLOORS = Array.from({ length: 16 }, (_, i) => i) // 0..15
const SURFACE = 7

// Distinct ring colours for each creature overlay.
const PALETTE = ['#d23d2f', '#3fa7d6', '#6cc551', '#e0a531', '#9b5de5', '#f15bb5', '#ff8c42', '#4ecdc4']

// Cities/landmarks (surface floor). Coordinates are approximate centres within
// the available tiles — tweak freely if any feels off.
type Landmark = { name: string; x: number; y: number; floor: number }
const LANDMARKS: Landmark[] = [
  { name: "Ab'Dendriel", x: 32732, y: 31637, floor: 7 },
  { name: 'Ankrahmun', x: 33097, y: 32673, floor: 7 },
  { name: 'Carlin', x: 32360, y: 31782, floor: 7 },
  { name: 'Cormaya', x: 33276, y: 31891, floor: 7 },
  { name: 'Darashia', x: 33213, y: 32468, floor: 7 },
  { name: 'Edron', x: 33193, y: 31784, floor: 7 },
  { name: 'Farmine', x: 32919, y: 31023, floor: 7 },
  { name: 'Kazordoon', x: 32649, y: 31925, floor: 7 },
  { name: 'Krailos', x: 33677, y: 31487, floor: 7 },
  { name: 'Liberty Bay', x: 32317, y: 32825, floor: 7 },
  { name: 'Port Hope', x: 32623, y: 32761, floor: 7 },
  { name: 'Rathleton', x: 33619, y: 31893, floor: 7 },
  { name: 'Rookgaard', x: 32097, y: 32219, floor: 7 },
  { name: 'Roshamuul', x: 33524, y: 32477, floor: 7 },
  { name: 'Svargrond', x: 32253, y: 31097, floor: 7 },
  { name: 'Thais', x: 32369, y: 32241, floor: 7 },
  { name: 'Venore', x: 32957, y: 32076, floor: 7 },
  { name: 'Yalahar', x: 32816, y: 31106, floor: 7 },
]

type Marker = { id: string; x: number; y: number; floor: number; label: string }
type Cluster = { x: number; y: number; z: number; count: number }
type ActiveCreature = {
  slug: string
  name: string
  image: string | null
  color: string
  spawns: Spawn[]
  clusters: Cluster[]
  jumpIdx: number
}

// "All creatures" overlay payload from GET /api/spawns?z=
type AllSpawns = {
  creatures: {
    slug: string
    name: string
    image: string | null
    classification: string | null
    difficulty: string | null
    boss: boolean
  }[]
  points: [number, number, number][]
}

// Official Tibia Bestiary difficulty levels, easiest → hardest.
const DIFFICULTIES = ['Harmless', 'Trivial', 'Easy', 'Medium', 'Hard', 'Challenging']

// Half-size (game tiles) of the square kept around a landmark for the "zone"
// filter — roughly a city plus its immediate hunting outskirts.
const ZONE_RADIUS = 200

// Safety ceiling on how many creature sprites to draw at once (the screen-grid
// de-duplication normally keeps it far below this).
const SPRITE_CAP = 1200

const inTileBounds = (x: number, y: number) =>
  x >= X_MIN && x < X_MAX && y >= Y_MIN && y < Y_MAX

// Group nearby spawns (same floor, within `threshold` tiles) into clusters so
// "next spawn" jumps to a different hunting area, not the adjacent tile.
function clusterSpawns(spawns: Spawn[], threshold = 40): Cluster[] {
  const acc: { sx: number; sy: number; x: number; y: number; z: number; count: number }[] = []
  for (const s of spawns) {
    let hit = null
    for (const c of acc) {
      if (c.z === s.z && Math.abs(c.x - s.x) <= threshold && Math.abs(c.y - s.y) <= threshold) {
        hit = c
        break
      }
    }
    if (hit) {
      hit.sx += s.x
      hit.sy += s.y
      hit.count++
      hit.x = Math.round(hit.sx / hit.count)
      hit.y = Math.round(hit.sy / hit.count)
    } else {
      acc.push({ sx: s.x, sy: s.y, x: s.x, y: s.y, z: s.z, count: 1 })
    }
  }
  return acc
    .map((c) => ({ x: c.x, y: c.y, z: c.z, count: c.count }))
    .sort((a, b) => b.count - a.count)
}

// Map a Tibia world coordinate to a Leaflet (lat,lng) point under CRS.Simple:
// lng = x and lat = -y so that larger game-y is lower on screen.
const toLatLng = (x: number, y: number): L.LatLngExpression => [-y, x]

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

// --- URL hash <-> map state ---------------------------------------------------
// Format: #f=<floor>&z=<zoom>&x=<cx>&y=<cy>&m=<x,y,f,label>;<...>&c=<slug>,<slug>
function encodeMarkers(markers: Marker[]): string {
  return markers
    .map((m) => [Math.round(m.x), Math.round(m.y), m.floor, encodeURIComponent(m.label)].join(','))
    .join(';')
}

function parseHash(): {
  x?: number
  y?: number
  z?: number
  floor?: number
  markers: Marker[]
  creatures: string[]
} {
  const h = window.location.hash.replace(/^#/, '')
  const parts: Record<string, string> = {}
  for (const kv of h.split('&')) {
    if (!kv) continue
    const i = kv.indexOf('=')
    if (i === -1) continue
    parts[kv.slice(0, i)] = kv.slice(i + 1)
  }
  const num = (k: string) => (parts[k] != null && parts[k] !== '' ? Number(parts[k]) : undefined)
  const markers: Marker[] = []
  if (parts.m) {
    for (const chunk of parts.m.split(';')) {
      if (!chunk) continue
      const [mx, my, mf, ...rest] = chunk.split(',')
      if (mx && my && mf) {
        markers.push({
          id: crypto.randomUUID(),
          x: Number(mx),
          y: Number(my),
          floor: Number(mf),
          label: decodeURIComponent(rest.join(',') || ''),
        })
      }
    }
  }
  const creatures = parts.c ? parts.c.split(',').filter(Boolean) : []
  return { x: num('x'), y: num('y'), z: num('z'), floor: num('f'), markers, creatures }
}

export function MapPage() {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.GridLayer | null>(null)
  const markersGroupRef = useRef<L.LayerGroup | null>(null)
  const cityGroupRef = useRef<L.LayerGroup | null>(null)
  const spawnGroupRef = useRef<L.LayerGroup | null>(null)
  const allGroupRef = useRef<L.LayerGroup | null>(null)
  const allSpriteGroupRef = useRef<L.LayerGroup | null>(null)
  // Current-floor "all creatures" data kept for click-to-identify and the
  // viewport sprite renderer.
  const allPointsRef = useRef<{
    points: [number, number, number][]
    names: string[]
    images: (string | null)[]
    slugs: string[]
    classifications: (string | null)[]
    difficulties: (string | null)[]
    bosses: boolean[]
  }>({ points: [], names: [], images: [], slugs: [], classifications: [], difficulties: [], bosses: [] })
  // Points after applying the category/zone filters — what actually gets drawn.
  const filteredRef = useRef<[number, number, number][]>([])

  // Initial state restored from the shared link (if any).
  const initial = useRef(parseHash()).current
  const [floor, setFloor] = useState(initial.floor ?? SURFACE)
  const [markers, setMarkers] = useState<Marker[]>(initial.markers)
  const [placing, setPlacing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [center, setCenter] = useState({ x: 0, y: 0 })

  // Creature spawn overlay.
  const [creatures, setCreatures] = useState<ActiveCreature[]>([])
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [showAll, setShowAll] = useState(true)
  const [catFilter, setCatFilter] = useState('') // '' = all classifications
  const [zoneFilter, setZoneFilter] = useState('') // '' = whole map
  const [levelFilter, setLevelFilter] = useState('') // '' = any difficulty
  const [bossOnly, setBossOnly] = useState(false) // show only bosses
  const [shownCount, setShownCount] = useState(0) // spawns currently drawn
  // Bumped each time the Leaflet map is (re)created so the overlay-drawing
  // effects re-run against the fresh layer groups — crucial under React
  // StrictMode's mount→cleanup→mount cycle in dev, where data-only deps may not
  // change between the two mounts and would otherwise leave overlays empty.
  const [mapReady, setMapReady] = useState(0)
  const colorIdx = useRef(0)
  // Slugs added or currently being fetched — guards against double-adds
  // (incl. React StrictMode's double effect invocation in dev).
  const pendingRef = useRef<Set<string>>(new Set())
  const restoredRef = useRef(false)

  // Refs to give once-bound Leaflet handlers access to the latest values.
  const floorRef = useRef(floor)
  const markersRef = useRef(markers)
  const placingRef = useRef(placing)
  const creaturesRef = useRef(creatures)
  const showAllRef = useRef(showAll)
  const catFilterRef = useRef(catFilter)
  const zoneFilterRef = useRef(zoneFilter)
  const levelFilterRef = useRef(levelFilter)
  const bossOnlyRef = useRef(bossOnly)
  const promptRef = useRef('')
  const addMarkerRef = useRef<(m: Marker) => void>(() => {})
  const removeMarkerRef = useRef<(id: string) => void>(() => {})
  const renderSpritesRef = useRef<() => void>(() => {})
  const rebuildOverlayRef = useRef<() => void>(() => {})
  promptRef.current = t('map.markerPrompt')
  addMarkerRef.current = (m) => setMarkers((prev) => [...prev, m])
  removeMarkerRef.current = (id) => setMarkers((prev) => prev.filter((m) => m.id !== id))

  // Recompute the filtered point set (category + zone) and redraw the overlay.
  rebuildOverlayRef.current = () => {
    const { points, classifications, difficulties, bosses } = allPointsRef.current
    const cat = catFilterRef.current
    const zone = zoneFilterRef.current
    const lvl = levelFilterRef.current
    const zoneLm = zone ? LANDMARKS.find((l) => l.name === zone) : null
    let f = points
    if (bossOnlyRef.current) f = f.filter((p) => bosses[p[2]])
    if (cat) f = f.filter((p) => classifications[p[2]] === cat)
    if (zoneLm)
      f = f.filter(
        (p) => Math.abs(p[0] - zoneLm.x) <= ZONE_RADIUS && Math.abs(p[1] - zoneLm.y) <= ZONE_RADIUS,
      )
    if (lvl) f = f.filter((p) => difficulties[p[2]] === lvl)
    filteredRef.current = f
    setShownCount(showAllRef.current ? f.length : 0)
    allGroupRef.current?.clearLayers() // force dots to redraw for the new set
    renderSpritesRef.current()
  }

  // Render the "all creatures" overlay: orange dots for every (filtered) spawn
  // (drawn once, self-healing if the layer ended up empty after a StrictMode
  // remount) plus creature sprites for the spawns in view, de-duplicated by a
  // screen grid so photos show at any zoom without piling up.
  renderSpritesRef.current = () => {
    const grp = allSpriteGroupRef.current
    const dotGrp = allGroupRef.current
    const map = mapRef.current
    if (!grp || !dotGrp || !map) return
    const points = filteredRef.current
    const { names, images } = allPointsRef.current

    // Dots: clear when hidden/empty, (re)draw when the layer is empty but should
    // have points (covers both first draw and the remount race).
    if (!showAllRef.current || !points.length) {
      dotGrp.clearLayers()
    } else if (dotGrp.getLayers().length === 0) {
      for (const [x, y] of points) {
        dotGrp.addLayer(
          L.circleMarker(toLatLng(x, y), {
            radius: 7,
            stroke: true,
            color: '#2a0d00',
            weight: 1,
            fillColor: '#ff7a33',
            fillOpacity: 0.9,
            interactive: false,
          }),
        )
      }
    }

    grp.clearLayers()
    if (!showAllRef.current || !points.length) return

    const b = map.getBounds()
    const N = b.getNorth()
    const S = b.getSouth()
    const E = b.getEast()
    const W = b.getWest()
    // Scale the sprite badge with zoom so it doesn't look tiny when zoomed in,
    // and keep the de-dup grid a bit larger than the badge to avoid overlap.
    const size = Math.max(28, Math.min(64, Math.round(22 + map.getZoom() * 9)))
    const imgPx = Math.round(size * 0.85)
    const cell = size + 6
    // De-duplicate by a screen-pixel grid: keep one representative sprite per
    // cell so photos appear at any zoom without overlapping (dense areas thin
    // out; the orange dots underneath still show every spawn).
    const seen = new Set<string>()
    const chosen: [number, number, number][] = []
    for (const p of points) {
      const lat = -p[1]
      const lng = p[0]
      if (lat < S || lat > N || lng < W || lng > E) continue
      const pt = map.latLngToContainerPoint([lat, lng])
      const key = Math.floor(pt.x / cell) + '_' + Math.floor(pt.y / cell)
      if (seen.has(key)) continue
      seen.add(key)
      chosen.push(p)
      if (chosen.length >= SPRITE_CAP) break
    }
    const { slugs } = allPointsRef.current
    for (const p of chosen) {
      const ci = p[2]
      const img = images[ci]
        ? `<img src="${escapeHtml(images[ci]!)}" alt="" style="width:${imgPx}px;height:${imgPx}px" />`
        : ''
      const icon = L.divIcon({
        className: '',
        html: `<div class="tm-spawn tm-spawn-all" style="--ring:#ff7a33;width:${size}px;height:${size}px">${img}</div>`,
        iconSize: [0, 0],
      })
      L.marker(toLatLng(p[0], p[1]), { icon })
        .addTo(grp)
        .bindPopup(
          `<div><div style="font-weight:700">${escapeHtml(names[ci])}</div>` +
            `<div style="opacity:.55;font-size:11px;margin:2px 0">${p[0]}, ${p[1]}, z${floorRef.current}</div>` +
            `<a href="/entry/${escapeHtml(slugs[ci] ?? '')}" style="color:var(--color-accent);font-size:11px;font-weight:700">${escapeHtml(t('map.viewEntry'))}</a></div>`,
        )
    }
  }

  function writeHash() {
    const map = mapRef.current
    if (!map) return
    const c = map.getCenter()
    let hash = `f=${floorRef.current}&z=${map.getZoom()}&x=${Math.round(c.lng)}&y=${Math.round(-c.lat)}`
    if (markersRef.current.length) hash += `&m=${encodeMarkers(markersRef.current)}`
    if (creaturesRef.current.length) hash += `&c=${creaturesRef.current.map((c) => c.slug).join(',')}`
    window.history.replaceState(null, '', '#' + hash)
  }

  // --- map init (once) ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      preferCanvas: true, // render the ~10k spawn dots on the map's own canvas
      minZoom: -4, // provisional; tightened to the fit-zoom once the size is known
      maxZoom: 5,
      zoomControl: true,
      attributionControl: false,
      maxBounds: [
        [-Y_MAX - TILE, X_MIN - TILE],
        [-Y_MIN + TILE, X_MAX + TILE],
      ],
      maxBoundsViscosity: 1.0,
    })

    const worldBounds = L.latLngBounds([-Y_MAX, X_MIN], [-Y_MIN, X_MAX])

    // Custom grid layer: map tile indices back to world-coordinate file names.
    const TibiaTiles = L.GridLayer.extend({
      createTile(coords: { x: number; y: number }) {
        const img = document.createElement('img')
        const gx = coords.x * TILE
        const gy = coords.y * TILE
        img.alt = ''
        img.style.imageRendering = 'pixelated'
        const f = (this as L.GridLayer).options as { floor: number }
        img.onerror = () => {
          img.style.visibility = 'hidden'
        }
        img.src = `/minimap/Minimap_Color_${gx}_${gy}_${f.floor}.png`
        return img
      },
    })

    const layer = new (TibiaTiles as unknown as new (
      o: L.GridLayerOptions & { floor: number },
    ) => L.GridLayer)({
      tileSize: TILE,
      // Always fetch the single native resolution (zoom 0) and let Leaflet
      // scale it; minZoom/maxZoom must span the map's range or the layer stops
      // drawing (GridLayer defaults to minZoom 0 → black when zoomed out).
      minNativeZoom: 0,
      maxNativeZoom: 0,
      minZoom: -5,
      maxZoom: 6,
      noWrap: true,
      bounds: worldBounds,
      floor: floorRef.current,
    })
    layer.addTo(map)

    // The "all creatures" dots (potentially ~10k) render on the map's own canvas
    // (preferCanvas) — DOM markers would not survive that count.
    const allGroup = L.layerGroup().addTo(map)
    const allSpriteGroup = L.layerGroup().addTo(map)
    const spawnGroup = L.layerGroup().addTo(map)
    const cityGroup = L.layerGroup().addTo(map)
    const markersGroup = L.layerGroup().addTo(map)

    // Restore the shared view, or default to Thais.
    if (initial.x != null && initial.y != null && initial.z != null) {
      map.setView(toLatLng(initial.x, initial.y), initial.z)
    } else {
      map.setView([-32198, 32368], 1)
    }

    mapRef.current = map
    layerRef.current = layer
    markersGroupRef.current = markersGroup
    cityGroupRef.current = cityGroup
    spawnGroupRef.current = spawnGroup
    allGroupRef.current = allGroup
    allSpriteGroupRef.current = allSpriteGroup
    setMapReady((v) => v + 1)

    map.on('click', (e: L.LeafletMouseEvent) => {
      const x = Math.round(e.latlng.lng)
      const y = Math.round(-e.latlng.lat)

      // "Add marker" mode: drop a user marker.
      if (placingRef.current) {
        const label = window.prompt(promptRef.current, '')
        setPlacing(false)
        if (label === null) return
        addMarkerRef.current({ id: crypto.randomUUID(), x, y, floor: floorRef.current, label: label.trim() })
        return
      }

      // Otherwise, if the "all creatures" layer is on, identify the nearest
      // (filtered) spawn within a small pixel tolerance and show what's there.
      const points = filteredRef.current
      const { names } = allPointsRef.current
      if (!points.length) return
      const tol = 8 / Math.pow(2, map.getZoom()) // ~8px tolerance in game units
      let bestD = Infinity
      let bestI = -1
      for (let i = 0; i < points.length; i++) {
        const dx = points[i][0] - x
        const dy = points[i][1] - y
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          bestI = i
        }
      }
      if (bestI >= 0 && bestD <= tol * tol) {
        const p = points[bestI]
        L.popup()
          .setLatLng(toLatLng(p[0], p[1]))
          .setContent(
            `<div><div style="font-weight:700">${escapeHtml(names[p[2]])}</div>` +
              `<div style="opacity:.55;font-size:11px">${p[0]}, ${p[1]}, z${floorRef.current}</div></div>`,
          )
          .openOn(map)
      }
    })

    // Wire the "delete" link inside marker popups.
    map.on('popupopen', (e: L.PopupEvent) => {
      const el = e.popup.getElement()
      const del = el?.querySelector('.tm-del') as HTMLElement | null
      if (del) {
        del.onclick = () => {
          const id = del.getAttribute('data-id')
          map.closePopup()
          if (id) removeMarkerRef.current(id)
        }
      }
    })

    const syncCenter = () => {
      const c = map.getCenter()
      setCenter({ x: Math.round(c.lng), y: Math.round(-c.lat) })
    }
    map.on('moveend zoomend', () => {
      syncCenter()
      writeHash()
      renderSpritesRef.current()
    })
    syncCenter()

    // The container may have zero size at mount (e.g. inside transitions);
    // recompute once layout settles and whenever it resizes. Clamp the minimum
    // zoom to the level that already shows the whole map — zooming out past that
    // left Leaflet computing a non-finite fit zoom and crashing.
    const resize = () => {
      map.invalidateSize()
      const fitZoom = map.getBoundsZoom(worldBounds, false)
      if (Number.isFinite(fitZoom)) {
        map.setMinZoom(fitZoom)
        if (map.getZoom() < fitZoom) map.setZoom(fitZoom)
      }
    }
    resize()
    const raf = requestAnimationFrame(resize)
    const ro = new ResizeObserver(resize)
    ro.observe(containerRef.current)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      map.remove()
      mapRef.current = null
      layerRef.current = null
      markersGroupRef.current = null
      cityGroupRef.current = null
      spawnGroupRef.current = null
      allGroupRef.current = null
      allSpriteGroupRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-render tiles when the floor changes.
  useEffect(() => {
    floorRef.current = floor
    const layer = layerRef.current
    if (layer) {
      ;(layer.options as L.GridLayerOptions & { floor: number }).floor = floor
      layer.redraw()
    }
    writeHash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor])

  // Re-draw user markers whenever the set or the floor changes (markers are
  // floor-specific: only those on the current floor are shown).
  useEffect(() => {
    markersRef.current = markers
    const grp = markersGroupRef.current
    if (grp) {
      grp.clearLayers()
      for (const mk of markers) {
        if (mk.floor !== floor) continue
        const icon = L.divIcon({
          className: '',
          html: `<div class="tm-marker"><div class="tm-pin"></div><div class="tm-label">${escapeHtml(mk.label || '?')}</div></div>`,
          iconSize: [0, 0],
        })
        const lm = L.marker(toLatLng(mk.x, mk.y), { icon }).addTo(grp)
        lm.bindPopup(
          `<div><div style="font-weight:700">${escapeHtml(mk.label || t('map.markerDefault'))}</div>` +
            `<div style="opacity:.55;font-size:11px;margin-top:2px">${mk.x}, ${mk.y}, z${mk.floor}</div>` +
            `<div class="tm-del" data-id="${mk.id}">${escapeHtml(t('map.delete'))}</div></div>`,
        )
      }
    }
    writeHash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, floor, mapReady])

  // Draw the city/zone name labels. Each landmark belongs to one floor (all the
  // surface ones live on floor 7), so a label only shows on its own floor.
  // Clicking a label flies to that city.
  useEffect(() => {
    const grp = cityGroupRef.current
    if (!grp) return
    grp.clearLayers()
    for (const lm of LANDMARKS) {
      if (lm.floor !== floor) continue
      const icon = L.divIcon({
        className: '',
        html: `<div class="tm-city">${escapeHtml(lm.name)}</div>`,
        iconSize: [0, 0],
      })
      L.marker(toLatLng(lm.x, lm.y), { icon, interactive: true, keyboard: false })
        .addTo(grp)
        .on('click', () => goTo(lm))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, mapReady])

  // Re-draw creature spawn icons on creature/floor change.
  useEffect(() => {
    creaturesRef.current = creatures
    const grp = spawnGroupRef.current
    if (grp) {
      grp.clearLayers()
      for (const cr of creatures) {
        const img = cr.image
          ? `<img src="${escapeHtml(cr.image)}" alt="" />`
          : ''
        for (const sp of cr.spawns) {
          if (sp.z !== floor) continue
          const icon = L.divIcon({
            className: '',
            html: `<div class="tm-spawn" style="--ring:${cr.color}">${img}</div>`,
            iconSize: [0, 0],
          })
          L.marker(toLatLng(sp.x, sp.y), { icon })
            .addTo(grp)
            .bindPopup(
              `<div><div style="font-weight:700">${escapeHtml(cr.name)}</div>` +
                `<div style="opacity:.55;font-size:11px;margin:2px 0">${sp.x}, ${sp.y}, z${sp.z}</div>` +
                `<a href="/entry/${escapeHtml(cr.slug)}" style="color:var(--color-accent);font-size:11px;font-weight:700">${escapeHtml(t('map.viewEntry'))}</a></div>`,
            )
        }
      }
    }
    writeHash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatures, floor, mapReady])

  // Keep the placing cursor + ref in sync.
  useEffect(() => {
    placingRef.current = placing
    const c = mapRef.current?.getContainer()
    if (c) c.classList.toggle('tm-placing', placing)
  }, [placing])

  // --- "all creatures" overlay: every spawn on the current floor ---
  const { data: allSpawns } = useQuery<AllSpawns>({
    queryKey: ['map-all-spawns', floor],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<AllSpawns>('/spawns', { params: { z: floor } })
      return data
    },
  })

  // Classifications present on the current floor, for the category filter.
  const categories = useMemo(() => {
    if (!allSpawns) return [] as string[]
    const s = new Set<string>()
    for (const c of allSpawns.creatures) if (c.classification) s.add(c.classification)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [allSpawns])

  useEffect(() => {
    showAllRef.current = showAll
    const grp = allGroupRef.current
    if (!grp) return
    if (!showAll || !allSpawns) {
      allPointsRef.current = {
        points: [],
        names: [],
        images: [],
        slugs: [],
        classifications: [],
        difficulties: [],
        bosses: [],
      }
    } else {
      // Only keep spawns within the available tile region; the rest (other
      // continents) would just litter the empty background.
      const pts = allSpawns.points.filter(([x, y]) => inTileBounds(x, y))
      allPointsRef.current = {
        points: pts,
        names: allSpawns.creatures.map((c) => c.name),
        images: allSpawns.creatures.map((c) => c.image),
        slugs: allSpawns.creatures.map((c) => c.slug),
        classifications: allSpawns.creatures.map((c) => c.classification),
        difficulties: allSpawns.creatures.map((c) => c.difficulty),
        bosses: allSpawns.creatures.map((c) => c.boss),
      }
    }
    rebuildOverlayRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSpawns, showAll, floor, mapReady])

  // Re-apply category/zone/level filters and fit the map to the matches so the
  // results are actually in view (filtered spawns are often far from where the
  // user is currently looking).
  useEffect(() => {
    catFilterRef.current = catFilter
    zoneFilterRef.current = zoneFilter
    levelFilterRef.current = levelFilter
    bossOnlyRef.current = bossOnly
    rebuildOverlayRef.current()

    const map = mapRef.current
    const f = filteredRef.current
    if (map && (catFilter || zoneFilter || levelFilter || bossOnly) && f.length) {
      let minLat = Infinity
      let maxLat = -Infinity
      let minLng = Infinity
      let maxLng = -Infinity
      for (const p of f) {
        const lat = -p[1]
        const lng = p[0]
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
      }
      map.fitBounds(
        L.latLngBounds([minLat, minLng], [maxLat, maxLng]),
        { padding: [40, 40], maxZoom: 4, animate: false },
      )
    }
  }, [catFilter, zoneFilter, levelFilter, bossOnly])

  // --- creature search (by name, via the published-names glossary) ---
  const debouncedQuery = useDebouncedValue(query, 250)
  const { data: glossary } = useGlossary()
  const searchResults = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (q.length < 2 || !glossary) return []
    return glossary
      .filter((g) => g.type === 'creature' && g.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const rank = (n: string) => (n.toLowerCase().startsWith(q) ? 0 : 1)
        return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)
      })
      .slice(0, 8)
  }, [debouncedQuery, glossary])

  // Restore creatures from a shared link (once, StrictMode-safe).
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    initial.creatures.forEach((slug, i) => void addCreature(slug, i === 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addCreature(slug: string, jump = true) {
    if (pendingRef.current.has(slug) || creaturesRef.current.some((c) => c.slug === slug)) {
      setQuery('')
      setSearchOpen(false)
      return
    }
    pendingRef.current.add(slug)
    try {
      const { data } = await api.get<{ data: Entry }>(`/entries/${slug}`)
      const e = data.data
      const color = PALETTE[colorIdx.current++ % PALETTE.length]
      const spawns = e.spawns ?? []
      // Cluster the in-bounds spawns (fall back to all) into hunting areas,
      // sorted by density — clusters[0] is the densest spot.
      const onMap = spawns.filter((s) => inTileBounds(s.x, s.y))
      const clusters = clusterSpawns(onMap.length ? onMap : spawns)
      const cr: ActiveCreature = {
        slug: e.slug,
        name: e.name ?? slug,
        image: e.primary_image,
        color,
        spawns,
        clusters,
        jumpIdx: 0,
      }
      setCreatures((prev) => [...prev, cr])
      setQuery('')
      setSearchOpen(false)

      // Jump to the densest cluster (within the available tile region).
      if (jump && clusters.length) {
        const c = clusters[0]
        floorRef.current = c.z
        setFloor(c.z)
        const map = mapRef.current
        if (map) map.setView(toLatLng(c.x, c.y), Math.max(map.getZoom(), 2))
      }
    } catch {
      // allow a retry if the fetch failed
      pendingRef.current.delete(slug)
    }
  }

  function removeCreature(slug: string) {
    pendingRef.current.delete(slug)
    setCreatures((prev) => prev.filter((c) => c.slug !== slug))
  }

  // Fly to the next/previous spawn cluster of a creature, switching floor.
  function cycleSpawn(slug: string, dir: 1 | -1) {
    const cr = creaturesRef.current.find((c) => c.slug === slug)
    if (!cr || cr.clusters.length === 0) return
    const next = (cr.jumpIdx + dir + cr.clusters.length) % cr.clusters.length
    setCreatures((prev) => prev.map((c) => (c.slug === slug ? { ...c, jumpIdx: next } : c)))
    const cl = cr.clusters[next]
    floorRef.current = cl.z
    setFloor(cl.z)
    const map = mapRef.current
    if (map) map.setView(toLatLng(cl.x, cl.y), Math.max(map.getZoom(), 3))
  }

  function goTo(l: Landmark) {
    floorRef.current = l.floor
    setFloor(l.floor)
    const map = mapRef.current
    if (map) map.setView(toLatLng(l.x, l.y), Math.max(map.getZoom(), 3))
  }

  async function share() {
    writeHash()
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt(t('map.copyManual'), window.location.href)
    }
  }

  const spawnsOnFloor = (cr: ActiveCreature) => cr.spawns.filter((s) => s.z === floor).length

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-accent">{t('map.kicker')}</p>
        <h1 className="text-2xl font-black tracking-tight">{t('map.title')}</h1>
        <p className="mt-1 text-sm text-fg-mute">{t('map.intro')}</p>
      </div>

      {/* Toolbar: search, navigation & tools */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Creature search */}
        <div className="relative">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder={t('map.searchCreature')}
            className="w-56 rounded-md border border-line bg-bg-2 px-3 py-2 text-xs font-semibold text-fg outline-none transition placeholder:text-fg-mute hover:border-line-2 focus:border-accent"
          />
          {searchOpen && debouncedQuery.trim().length >= 2 && searchResults && searchResults.length > 0 && (
            <ul className="absolute z-[1100] mt-1 max-h-72 w-64 overflow-auto rounded-md border border-line bg-bg-2 py-1 shadow-xl">
              {searchResults.map((r) => (
                <li key={r.slug}>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addCreature(r.slug)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-fg-dim transition hover:bg-line/40 hover:text-fg"
                  >
                    <span>{r.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Jump to a city (navigation only) */}
        <select
          value=""
          onChange={(e) => {
            const l = LANDMARKS.find((x) => x.name === e.target.value)
            if (l) goTo(l)
          }}
          className="rounded-md border border-line bg-bg-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-fg-dim outline-none transition hover:border-line-2"
        >
          <option value="">{t('map.goTo')}</option>
          {LANDMARKS.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPlacing((p) => !p)}
            className={`rounded-md border px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${
              placing
                ? 'border-accent bg-accent text-white'
                : 'border-line bg-bg-2 text-fg-dim hover:border-line-2 hover:text-fg'
            }`}
          >
            {placing ? t('map.placing') : t('map.addMarker')}
          </button>

          {markers.length > 0 && (
            <button
              onClick={() => setMarkers([])}
              className="rounded-md border border-line bg-bg-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:border-line-2 hover:text-fg"
            >
              {t('map.clear')} ({markers.length})
            </button>
          )}

          <button
            onClick={share}
            className="rounded-md border border-line bg-bg-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-fg-dim transition hover:border-line-2 hover:text-fg"
          >
            {copied ? t('map.copied') : t('map.share')}
          </button>
        </div>
      </div>

      {/* Spawn overlay control panel */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-bg-2/40 px-3 py-2.5">
        <button
          onClick={() => setShowAll((v) => !v)}
          className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
            showAll
              ? 'border-[#ff7043] bg-[#ff7043]/15 text-[#ff7043]'
              : 'border-line bg-bg-2 text-fg-dim hover:border-line-2 hover:text-fg'
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${showAll ? 'bg-[#ff7043]' : 'bg-fg-mute'}`}
          />
          {t('map.allCreatures')}
        </button>

        <span className="hidden h-6 w-px bg-line sm:block" />

        <label className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-mute">
            {t('map.category')}
          </span>
          <select
            value={catFilter}
            onChange={(e) => {
              setCatFilter(e.target.value)
              setShowAll(true)
            }}
            className="rounded-md border border-line bg-bg-2 px-2.5 py-1.5 text-xs font-semibold text-fg-dim outline-none transition hover:border-line-2 focus:border-accent"
          >
            <option value="">{t('map.allCategories')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-mute">
            {t('map.zone')}
          </span>
          <select
            value={zoneFilter}
            onChange={(e) => {
              setZoneFilter(e.target.value)
              setShowAll(true)
            }}
            className="rounded-md border border-line bg-bg-2 px-2.5 py-1.5 text-xs font-semibold text-fg-dim outline-none transition hover:border-line-2 focus:border-accent"
          >
            <option value="">{t('map.allZones')}</option>
            {LANDMARKS.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-mute">
            {t('map.level')}
          </span>
          <select
            value={levelFilter}
            onChange={(e) => {
              setLevelFilter(e.target.value)
              setShowAll(true)
            }}
            className="rounded-md border border-line bg-bg-2 px-2.5 py-1.5 text-xs font-semibold text-fg-dim outline-none transition hover:border-line-2 focus:border-accent"
          >
            <option value="">{t('map.allLevels')}</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => {
            setBossOnly((v) => !v)
            setShowAll(true)
          }}
          className={`rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
            bossOnly
              ? 'border-[#e0a531] bg-[#e0a531]/15 text-[#e0a531]'
              : 'border-line bg-bg-2 text-fg-dim hover:border-line-2 hover:text-fg'
          }`}
        >
          ☠ {t('map.bosses')}
        </button>

        {(catFilter || zoneFilter || levelFilter || bossOnly) && (
          <button
            onClick={() => {
              setCatFilter('')
              setZoneFilter('')
              setLevelFilter('')
              setBossOnly(false)
            }}
            className="text-xs font-bold uppercase tracking-wider text-accent transition hover:text-accent-2"
          >
            {t('map.clearFilters')}
          </button>
        )}

        {showAll && (
          <span className="ml-auto text-[11px] font-semibold tabular-nums text-fg-mute">
            {shownCount.toLocaleString()} {t('map.spawnsShown')}
          </span>
        )}
      </div>

      {/* Active creature legend */}
      {creatures.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {creatures.map((cr) => (
            <span
              key={cr.slug}
              className="flex items-center gap-2 rounded-full border border-line bg-bg-2 py-1 pl-1.5 pr-2 text-xs font-semibold text-fg-dim"
            >
              <span
                className="inline-block h-3 w-3 rounded-full border border-white/70"
                style={{ background: cr.color }}
              />
              {cr.image && <img src={cr.image} alt="" className="tm-legend-sprite" />}
              <span className="text-fg">{cr.name}</span>
              <span className="text-fg-mute">
                {spawnsOnFloor(cr)}/{cr.spawns.length}
              </span>
              {cr.clusters.length > 1 && (
                <span className="ml-0.5 flex items-center gap-1 rounded bg-line/40 px-1">
                  <button
                    onClick={() => cycleSpawn(cr.slug, -1)}
                    className="text-fg-mute transition hover:text-fg"
                    title={t('map.prevSpawn')}
                  >
                    ◀
                  </button>
                  <span className="text-[10px] tabular-nums text-fg-dim" title={t('map.spawnAreas')}>
                    {cr.jumpIdx + 1}/{cr.clusters.length}
                  </span>
                  <button
                    onClick={() => cycleSpawn(cr.slug, 1)}
                    className="text-fg-mute transition hover:text-fg"
                    title={t('map.nextSpawn')}
                  >
                    ▶
                  </button>
                </span>
              )}
              <button
                onClick={() => removeCreature(cr.slug)}
                className="ml-0.5 text-fg-mute transition hover:text-accent"
                title={t('map.delete')}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative overflow-hidden rounded-lg border border-line bg-[#0e1015]">
        <div ref={containerRef} className="h-[70vh] w-full" style={{ background: '#0e1015' }} />

        {/* Coordinate readout */}
        <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] rounded border border-line bg-bg/85 px-2 py-1 font-mono text-[11px] tabular-nums text-fg-dim backdrop-blur-md">
          {center.x}, {center.y}, z{floor}
        </div>

        {/* Floor selector */}
        <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-1 rounded-md border border-line bg-bg/90 p-2 backdrop-blur-md">
          <span className="mb-1 text-center text-[10px] font-bold uppercase tracking-widest text-fg-mute">
            {t('map.floor')}
          </span>
          {FLOORS.map((f) => {
            const rel = SURFACE - f // +N above surface, -N below
            const label = rel === 0 ? '0' : rel > 0 ? `+${rel}` : `${rel}`
            const active = f === floor
            return (
              <button
                key={f}
                onClick={() => setFloor(f)}
                title={`${t('map.floor')} ${f}`}
                className={`h-6 w-9 rounded text-[11px] font-bold tabular-nums transition ${
                  active
                    ? 'bg-accent text-white'
                    : f === SURFACE
                      ? 'bg-line/40 text-fg hover:bg-line'
                      : 'text-fg-mute hover:bg-line/40 hover:text-fg'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <p className="text-xs text-fg-mute">{t('map.disclaimer')}</p>
    </div>
  )
}

/** Local debounce (kept here to avoid an extra import path). */
function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
