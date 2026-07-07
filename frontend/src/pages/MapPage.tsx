import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../lib/api'
import { planRoute, type RoutePlan } from '../lib/routing'
import { Seo } from '../lib/seo'
import { Icon, iconMarkup } from '../lib/icons'
import { useGlossary } from '../hooks/useGlossary'
import { useTopSearches, type TopSearch } from '../hooks/useKillStats'
import { TypeIcon } from '../components/TypeIcon'
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
  { name: "Ab'Dendriel", x: 32665, y: 31652, floor: 7 },
  { name: 'Ankrahmun', x: 33146, y: 32816, floor: 7 },
  { name: 'Carlin', x: 32343, y: 31792, floor: 7 },
  { name: 'Cormaya', x: 33307, y: 31999, floor: 7 },
  { name: 'Darashia', x: 33236, y: 32432, floor: 7 },
  { name: 'Edron', x: 33211, y: 31830, floor: 7 },
  { name: 'Farmine', x: 33030, y: 31500, floor: 7 },
  { name: 'Kazordoon', x: 32614, y: 31923, floor: 7 },
  { name: 'Krailos', x: 33580, y: 31584, floor: 7 },
  { name: 'Liberty Bay', x: 32309, y: 32794, floor: 7 },
  { name: 'Port Hope', x: 32629, y: 32769, floor: 7 },
  { name: 'Rathleton', x: 33607, y: 31955, floor: 7 },
  { name: 'Rookgaard', x: 32097, y: 32219, floor: 7 },
  { name: 'Roshamuul', x: 33524, y: 32477, floor: 7 },
  { name: 'Svargrond', x: 32278, y: 31146, floor: 7 },
  { name: 'Thais', x: 32365, y: 32224, floor: 7 },
  { name: 'Venore', x: 32947, y: 32081, floor: 7 },
  { name: 'Yalahar', x: 32805, y: 31234, floor: 7 },
]

// Named hunting regions / dungeons / islands shown as smaller on-map labels
// (not in the navigation dropdowns). Coordinates are approximate centres within
// the covered tile region — anchored to known landmarks or the community map
// data — and easy to nudge if any feels off.
type Place = Landmark & { kind: 'city' | 'region' }
// Coordinates verified from TibiaWiki's {{Mapper Coords}} (the location field of
// each place's article): game_x = floor*256 + offset. Underground areas are
// labelled at their surface position so the name marks the spot on the map.
const REGIONS: { name: string; x: number; y: number }[] = [
  // Thais & central mainland
  { name: 'Mount Sternum', x: 32494, y: 32072 },
  { name: 'Femor Hills', x: 32569, y: 31803 },
  { name: 'Fibula', x: 32261, y: 32385 },
  { name: 'Plains of Havoc', x: 32735, y: 32297 },
  { name: 'Demona', x: 32479, y: 31663 },
  { name: 'Outlaw Camp', x: 32643, y: 32222 },
  { name: 'Maze of Lost Souls', x: 32490, y: 31697 },
  { name: 'Dark Cathedral', x: 32664, y: 32344 },
  // Carlin & northern / western islands
  { name: 'Folda', x: 32020, y: 31572 },
  { name: 'Ramoa', x: 31931, y: 32567 },
  { name: 'Goroma', x: 32095, y: 32583 },
  { name: 'Treasure Island', x: 32156, y: 32948 },
  { name: 'Laguna Islands', x: 32466, y: 32939 },
  // Ab'Dendriel & orc lands
  { name: 'Elvenbane', x: 32590, y: 31645 },
  { name: 'Mistrock', x: 32567, y: 31442 },
  { name: 'Orc Fortress', x: 32930, y: 31774 },
  { name: 'Vengoth', x: 32916, y: 31516 },
  // Edron & the east
  { name: 'Cyclopolis', x: 33251, y: 31698 },
  { name: 'Hero Cave', x: 33164, y: 31638 },
  { name: 'Stonehome', x: 33303, y: 31773 },
  { name: 'Grimvale', x: 33333, y: 31690 },
  { name: 'Oramond', x: 33479, y: 31986 },
  // Venore & the Ghostlands
  { name: 'Shadowthorn', x: 33075, y: 32170 },
  { name: 'Drefia', x: 33018, y: 32443 },
  { name: 'Forbidden Lands', x: 32973, y: 32549 },
  // Desert (Darashia / Ankrahmun)
  { name: "Mal'ouquah", x: 33041, y: 32627 },
  { name: 'Chor', x: 32952, y: 32855 },
  // Tiquanda jungle (Port Hope)
  { name: 'Tiquanda', x: 32812, y: 32699 },
  { name: 'Banuta', x: 32807, y: 32542 },
  { name: 'Trapwood', x: 32688, y: 32911 },
  // Underground demon lairs
  { name: 'Hellgate', x: 32675, y: 31647 },
  // Svargrond archipelago (ice)
  { name: 'Nibelor', x: 32353, y: 31053 },
  { name: 'Helheim', x: 32478, y: 31179 },
  { name: 'Okolnir', x: 32230, y: 31412 },
  { name: 'Formorgar Glacier', x: 32102, y: 31144 },
  { name: 'Chyllfroest', x: 32060, y: 31034 },
]

// Every name drawn on the map: the cities (prominent) plus the regions (subtle).
const MAP_LABELS: Place[] = [
  ...LANDMARKS.map((l): Place => ({ ...l, kind: 'city' })),
  ...REGIONS.map((r): Place => ({ ...r, floor: 7, kind: 'region' })),
]

type Marker = { id: string; x: number; y: number; floor: number; label: string }
type Cluster = { x: number; y: number; z: number; count: number; score: number }
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

// A point-of-interest from the imported client minimap markers
// (public/map-markers.json, generated by tools/gen-map-markers.mjs).
type Poi = { x: number; y: number; z: number; desc: string; color: string; icon: string }

// Lucide-style line-icon paths (24x24), matching the rest of the UI — a real
// icon set reads far clearer than glyphs.
const POI_ICONS = {
  // skull — spawns & bosses
  boss: 'M9 12h.01M15 12h.01M8 20v2h8v-2M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20',
  // up/down arrows — travel between floors (teleports, stairs, holes, levitate)
  travel: 'M3 16l4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16',
  // shopping bag — services (depot, bank, store, trainer)
  service:
    'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  // scroll — quest mechanics (levers, chests, missions)
  quest:
    'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3M19 17V5a2 2 0 0 0-2-2H4',
  // map pin — everything else
  poi: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
} as const

// Colour + icon for a marker, inferred from its description so the overlay reads
// at a glance: red = spawns/bosses, blue = travel/access, green = services,
// gold = quest mechanics, violet = everything else.
function poiStyle(desc: string): { color: string; icon: string } {
  const d = desc.toLowerCase()
  if (/spawn|boss|raid|\blair\b/.test(d)) return { color: '#d23d2f', icon: POI_ICONS.boss }
  if (/teleport|exit|entrance|portal|stair|ladder|\bhole\b|way to|shortcut|levitate|rope spot|passage|tunnel|harbour|harbor|boat|ship/.test(d))
    return { color: '#3fa7d6', icon: POI_ICONS.travel }
  if (/depot|\bbank\b|store|shop|market|trainer|training|offline|magic store|post/.test(d))
    return { color: '#6cc551', icon: POI_ICONS.service }
  if (/quest|lever|switch|chest|mission|reward|book|\bkey\b|door|sign|note|mechanism|button|pull|painting|pick hole|dig/.test(d))
    return { color: '#e0a531', icon: POI_ICONS.quest }
  return { color: '#9b8cff', icon: POI_ICONS.poi }
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
// Clusters are scored for task/bounty hunting: many creatures packed into a
// small area rank highest (kill the quota fast, walk little), so clusters[0]
// is the recommended "best spawn".
function clusterSpawns(spawns: Spawn[], threshold = 40): Cluster[] {
  const acc: {
    sx: number
    sy: number
    x: number
    y: number
    z: number
    count: number
    minx: number
    maxx: number
    miny: number
    maxy: number
  }[] = []
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
      if (s.x < hit.minx) hit.minx = s.x
      if (s.x > hit.maxx) hit.maxx = s.x
      if (s.y < hit.miny) hit.miny = s.y
      if (s.y > hit.maxy) hit.maxy = s.y
    } else {
      acc.push({ sx: s.x, sy: s.y, x: s.x, y: s.y, z: s.z, count: 1, minx: s.x, maxx: s.x, miny: s.y, maxy: s.y })
    }
  }
  return acc
    .map((c) => {
      // spread = longest side of the cluster's bounding box (tiles). A tight,
      // dense cluster beats a loose one of similar size: a spread equal to the
      // clustering threshold halves the score.
      const spread = Math.max(c.maxx - c.minx, c.maxy - c.miny)
      return { x: c.x, y: c.y, z: c.z, count: c.count, score: c.count / (1 + spread / threshold) }
    })
    .sort((a, b) => b.score - a.score)
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
//         &r=<sx,sy,sf,slabel>;<ex,ey,ef,elabel>   (route: start ; end)
function encodeMarkers(markers: Marker[]): string {
  return markers
    .map((m) => [Math.round(m.x), Math.round(m.y), m.floor, encodeURIComponent(m.label)].join(','))
    .join(';')
}

// A route endpoint as stored in the URL hash. Structurally matches the
// component's RoutePoint so restored values drop straight into state.
type HashRoutePoint = { x: number; y: number; floor: number; label?: string }

function encodeRoutePoint(p: HashRoutePoint | null): string {
  return p ? [Math.round(p.x), Math.round(p.y), p.floor, encodeURIComponent(p.label ?? '')].join(',') : ''
}

function decodeRoutePoint(chunk: string): HashRoutePoint | null {
  if (!chunk) return null
  const [rx, ry, rf, ...rest] = chunk.split(',')
  if (!rx || !ry || !rf) return null
  const label = decodeURIComponent(rest.join(',') || '')
  return { x: Number(rx), y: Number(ry), floor: Number(rf), label: label || undefined }
}

function parseHash(): {
  x?: number
  y?: number
  z?: number
  floor?: number
  markers: Marker[]
  creatures: string[]
  routeStart: HashRoutePoint | null
  routeEnd: HashRoutePoint | null
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
  let routeStart: HashRoutePoint | null = null
  let routeEnd: HashRoutePoint | null = null
  if (parts.r) {
    const [s, e] = parts.r.split(';')
    routeStart = decodeRoutePoint(s ?? '')
    routeEnd = decodeRoutePoint(e ?? '')
  }
  return { x: num('x'), y: num('y'), z: num('z'), floor: num('f'), markers, creatures, routeStart, routeEnd }
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
  const poiGroupRef = useRef<L.LayerGroup | null>(null)
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
  const [showPoi, setShowPoi] = useState(false) // imported minimap markers layer
  const [showFilters, setShowFilters] = useState(false) // collapsible refine panel
  const [markerDraft, setMarkerDraft] = useState<{ x: number; y: number; floor: number } | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [shownCount, setShownCount] = useState(0) // spawns currently drawn

  // "How to get there" routing (A* over minimap walkability). An endpoint can be
  // set by clicking the map (no label) or by picking a city (label = its name).
  type RoutePoint = { x: number; y: number; floor: number; label?: string }
  // A shared link may carry a route — open the directions panel and restore its
  // endpoints so the plan can be recomputed (see the restore effect below).
  const [routeMode, setRouteMode] = useState(!!(initial.routeStart || initial.routeEnd))
  const [routeStart, setRouteStart] = useState<RoutePoint | null>(initial.routeStart)
  const [routeEnd, setRouteEnd] = useState<RoutePoint | null>(initial.routeEnd)
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null)
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeMsg, setRouteMsg] = useState<string | null>(null)
  const routeGroupRef = useRef<L.LayerGroup | null>(null)
  const routeModeRef = useRef(routeMode)
  const routeStartRef = useRef(routeStart)
  const routeEndRef = useRef(routeEnd)
  const computeRouteRef = useRef<(s: RoutePoint, e: RoutePoint) => void>(() => {})
  routeModeRef.current = routeMode
  routeStartRef.current = routeStart
  routeEndRef.current = routeEnd
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
  const showPoiRef = useRef(showPoi)
  const poiRef = useRef<Poi[]>([])
  const addMarkerRef = useRef<(m: Marker) => void>(() => {})
  const removeMarkerRef = useRef<(id: string) => void>(() => {})
  const openMarkerModalRef = useRef<(d: { x: number; y: number; floor: number }) => void>(() => {})
  const renderSpritesRef = useRef<() => void>(() => {})
  const renderPoiRef = useRef<() => void>(() => {})
  const rebuildOverlayRef = useRef<() => void>(() => {})
  addMarkerRef.current = (m) => setMarkers((prev) => [...prev, m])
  removeMarkerRef.current = (id) => setMarkers((prev) => prev.filter((m) => m.id !== id))
  openMarkerModalRef.current = (d) => {
    setDraftLabel('')
    setMarkerDraft(d)
  }

  // Compute a multi-modal route (walk + boat) between two points and store the
  // plan; a draw effect renders its legs on the map.
  computeRouteRef.current = async (s, e) => {
    setRouteMsg(null)
    setRoutePlan(null)
    setRouteBusy(true)
    try {
      const plan = await planRoute(
        { x: s.x, y: s.y, floor: s.floor },
        { x: e.x, y: e.y, floor: e.floor },
      )
      if (!plan) {
        setRouteMsg(t('map.routeNone'))
        return
      }
      setRoutePlan(plan)
      // Jump to the start floor so the beginning of the route is visible.
      setFloor(s.floor)
    } catch {
      setRouteMsg(t('map.routeError'))
    } finally {
      setRouteBusy(false)
    }
  }

  // Set a route endpoint from a city dropdown; auto-route once both ends exist.
  function pickCityEndpoint(which: 'start' | 'end', name: string) {
    const l = LANDMARKS.find((x) => x.name === name)
    if (!l) return
    const pt: RoutePoint = { x: l.x, y: l.y, floor: l.floor, label: l.name }
    if (which === 'start') {
      setRouteStart(pt)
      const e = routeEndRef.current
      if (e) computeRouteRef.current(pt, e)
    } else {
      setRouteEnd(pt)
      const s = routeStartRef.current
      if (s) computeRouteRef.current(s, pt)
    }
  }

  function clearRouteEndpoint(which: 'start' | 'end') {
    if (which === 'start') setRouteStart(null)
    else setRouteEnd(null)
    setRoutePlan(null)
    setRouteMsg(null)
  }

  function resetRoute() {
    setRouteStart(null)
    setRouteEnd(null)
    setRoutePlan(null)
    setRouteMsg(null)
  }

  // A route endpoint's <select> value: the city name, a sentinel for a clicked
  // point, or '' when unset.
  const endpointValue = (p: RoutePoint | null) => (p ? (p.label ?? '__pt__') : '')

  // Floor label matching the selector (0 = surface, +N above, -N below).
  const floorLabel = (f: number) =>
    f === SURFACE ? '0' : f < SURFACE ? `+${SURFACE - f}` : `${SURFACE - f}`

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
        ? `<img src="${escapeHtml(images[ci]!)}" alt="" loading="lazy" style="width:${imgPx}px;height:${imgPx}px" />`
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

  // Draw the imported minimap POI markers for the current floor. De-duplicated
  // by a screen-pixel grid (like the creature sprites) so dense clusters thin
  // out instead of piling up; each shows its label on hover and coords on click.
  renderPoiRef.current = () => {
    const grp = poiGroupRef.current
    const map = mapRef.current
    if (!grp || !map) return
    grp.clearLayers()
    if (!showPoiRef.current) return
    const f = floorRef.current
    const b = map.getBounds()
    const N = b.getNorth()
    const S = b.getSouth()
    const E = b.getEast()
    const W = b.getWest()
    const cell = 34
    const seen = new Set<string>()
    for (const m of poiRef.current) {
      if (m.z !== f) continue
      const lat = -m.y
      const lng = m.x
      if (lat < S || lat > N || lng < W || lng > E) continue
      const pt = map.latLngToContainerPoint([lat, lng])
      const key = Math.floor(pt.x / cell) + '_' + Math.floor(pt.y / cell)
      if (seen.has(key)) continue
      seen.add(key)
      const icon = L.divIcon({
        className: '',
        html: `<div class="tm-poi" style="--poi:${m.color}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg></div>`,
        iconSize: [0, 0],
      })
      L.marker(toLatLng(m.x, m.y), { icon })
        .addTo(grp)
        .bindTooltip(escapeHtml(m.desc), { direction: 'top', offset: [0, -9] })
        .bindPopup(
          `<div><div style="font-weight:700">${escapeHtml(m.desc)}</div>` +
            `<div style="opacity:.55;font-size:11px;margin-top:2px">${m.x}, ${m.y}, z${m.z}</div></div>`,
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
    if (routeStartRef.current || routeEndRef.current)
      hash += `&r=${encodeRoutePoint(routeStartRef.current)};${encodeRoutePoint(routeEndRef.current)}`
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
    const poiGroup = L.layerGroup().addTo(map)
    const spawnGroup = L.layerGroup().addTo(map)
    const cityGroup = L.layerGroup().addTo(map)
    const markersGroup = L.layerGroup().addTo(map)
    const routeGroup = L.layerGroup().addTo(map)

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
    poiGroupRef.current = poiGroup
    routeGroupRef.current = routeGroup
    setMapReady((v) => v + 1)

    map.on('click', (e: L.LeafletMouseEvent) => {
      const x = Math.round(e.latlng.lng)
      const y = Math.round(-e.latlng.lat)

      // "Directions" mode: first click sets the start, second the destination
      // (and kicks off the route computation).
      if (routeModeRef.current) {
        const pt = { x, y, floor: floorRef.current }
        // Fill whichever endpoint is still empty (start first); once both are
        // set, a further click replaces the destination.
        if (!routeStartRef.current) {
          setRouteStart(pt)
          const e = routeEndRef.current
          if (e) computeRouteRef.current(pt, e)
        } else {
          setRouteEnd(pt)
          computeRouteRef.current(routeStartRef.current, pt)
        }
        return
      }

      // "Add marker" mode: open the naming modal for a new user marker.
      if (placingRef.current) {
        setPlacing(false)
        openMarkerModalRef.current({ x, y, floor: floorRef.current })
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
      renderPoiRef.current()
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
      poiGroupRef.current = null
      routeGroupRef.current = null
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
    for (const lm of MAP_LABELS) {
      if (lm.floor !== floor) continue
      const cls = lm.kind === 'city' ? 'tm-city' : 'tm-city tm-region'
      const icon = L.divIcon({
        className: '',
        html: `<div class="${cls}">${escapeHtml(lm.name)}</div>`,
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
          ? `<img src="${escapeHtml(cr.image)}" alt="" loading="lazy" />`
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

  // Draw the computed route + start/destination pins. The route belongs to the
  // start point's floor, so it only shows while that floor is selected.
  useEffect(() => {
    const grp = routeGroupRef.current
    if (!grp) return
    grp.clearLayers()
    if (routePlan) {
      // Legs live on specific floors; only draw those on the floor in view.
      for (const leg of routePlan.legs) {
        if (leg.kind === 'walk') {
          if (leg.floor !== floor || leg.path.length < 2) continue
          const latlngs = leg.path.map((p) => toLatLng(p.x, p.y))
          // Ink on parchment: a warm cream casing under a dark sepia core, so the
          // walking line reads like a hand-drawn route over the busy minimap and
          // matches the atlas identity (no map-app blue).
          grp.addLayer(
            L.polyline(latlngs, { color: '#f4e7c6', weight: 7, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }),
          )
          grp.addLayer(
            L.polyline(latlngs, { color: '#3b2313', weight: 3.5, opacity: 1, lineJoin: 'round', lineCap: 'round' }),
          )
        } else if (leg.kind === 'boat') {
          // Ferry hop: drawn on whichever end's floor is in view (the Kazordoon
          // steamboat docks underground, so a crossing can span floors).
          if (floor !== leg.fromFloor && floor !== leg.toFloor) continue
          // Dashed crossing in the same ink-and-parchment pair (same geometry +
          // dashArray, so the two dash patterns overlay exactly).
          const seg = [toLatLng(leg.from.x, leg.from.y), toLatLng(leg.to.x, leg.to.y)]
          grp.addLayer(
            L.polyline(seg, { color: '#3b2313', weight: 5, opacity: 0.55, dashArray: '2 9', lineCap: 'round' }),
          )
          grp.addLayer(
            L.polyline(seg, { color: '#f4e7c6', weight: 2.5, opacity: 0.95, dashArray: '2 9', lineCap: 'round' }),
          )
          grp.addLayer(
            L.marker(toLatLng((leg.from.x + leg.to.x) / 2, (leg.from.y + leg.to.y) / 2), {
              icon: L.divIcon({
                className: '',
                html: `<div class="tm-route-boat">${iconMarkup(leg.icon)} ${escapeHtml(leg.toName)}</div>`,
                iconSize: [0, 0],
              }),
              interactive: false,
            }),
          )
        } else if (leg.kind === 'stairs') {
          if (leg.floor !== floor) continue
          // A floor change happens here — a clickable badge that jumps the view
          // to the destination floor. Rope spots and shovel piles show their tool
          // so the player knows what to bring.
          const glyph =
            leg.tool === 'rope' ? iconMarkup('rope') : leg.tool === 'shovel' ? iconMarkup('pickaxe') : leg.dir === 'down' ? '▼' : leg.dir === 'up' ? '▲' : '⇄'
          const cls = leg.dir === 'down' ? 'is-down' : leg.dir === 'up' ? 'is-up' : 'is-tp'
          grp.addLayer(
            L.marker(toLatLng(leg.from.x, leg.from.y), {
              icon: L.divIcon({
                className: '',
                html: `<div class="tm-route-stair ${cls}">${glyph} ${escapeHtml(t('map.floor'))} ${floorLabel(leg.toFloor)}</div>`,
                iconSize: [0, 0],
              }),
            }).on('click', () => setFloor(leg.toFloor)),
          )
        }
      }
    }
    const pin = (p: RoutePoint, label: string, color: string) =>
      L.marker(toLatLng(p.x, p.y), {
        icon: L.divIcon({
          className: '',
          html: `<div class="tm-route-pin" style="--rp:${color}">${label}</div>`,
          iconSize: [0, 0],
        }),
        interactive: false,
      })
    if (routeStart && routeStart.floor === floor)
      grp.addLayer(pin(routeStart, t('map.routeStartLabel'), '#4f7a3a'))
    if (routeEnd && routeEnd.floor === floor)
      grp.addLayer(pin(routeEnd, t('map.routeEndLabel'), '#9c3b2e'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStart, routeEnd, routePlan, floor, mapReady])

  // Keep the placing cursor + ref in sync (route mode also uses the crosshair).
  useEffect(() => {
    placingRef.current = placing
    const c = mapRef.current?.getContainer()
    if (c) c.classList.toggle('tm-placing', placing || routeMode)
  }, [placing, routeMode])

  // --- "all creatures" overlay: every spawn on the current floor ---
  const { data: allSpawns } = useQuery<AllSpawns>({
    queryKey: ['map-all-spawns', floor],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<AllSpawns>('/spawns', { params: { z: floor } })
      return data
    },
  })

  // Imported client minimap markers (points of interest) — a static asset,
  // fetched once and kept for the whole session.
  const { data: poiData } = useQuery<[number, number, number, number, string][]>({
    queryKey: ['map-poi'],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch('/map-markers.json')
      if (!res.ok) throw new Error('poi fetch failed')
      return res.json()
    },
  })

  // Pre-process the raw markers into styled POIs, then (re)draw when the layer
  // is toggled, the floor changes, or the map remounts.
  useEffect(() => {
    showPoiRef.current = showPoi
    if (poiData && poiRef.current.length === 0) {
      poiRef.current = poiData.map(([x, y, z, , desc]) => ({ x, y, z, desc, ...poiStyle(desc) }))
    }
    renderPoiRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPoi, poiData, floor, mapReady])

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

  // Restore creatures + a shared route from the link (once, StrictMode-safe).
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    initial.creatures.forEach((slug, i) => void addCreature(slug, i === 0))
    // Recompute the plan for a shared route once both endpoints are present.
    if (initial.routeStart && initial.routeEnd)
      computeRouteRef.current(initial.routeStart, initial.routeEnd)
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

  // Fly straight to the recommended best spawn for a task/bounty: the densest,
  // most compact cluster (clusters[0], since they are sorted by score).
  function jumpToBest(slug: string) {
    const cr = creaturesRef.current.find((c) => c.slug === slug)
    if (!cr || cr.clusters.length === 0) return
    setCreatures((prev) => prev.map((c) => (c.slug === slug ? { ...c, jumpIdx: 0 } : c)))
    const cl = cr.clusters[0]
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
  const activeFilterCount = [catFilter, zoneFilter, levelFilter].filter(Boolean).length

  // "Most searched" rail: the site's trending creature searches. Only creatures
  // with a slug + sprite can be plotted, so filter to those.
  const { data: topSearched } = useTopSearches(20)
  const hot = useMemo(
    () =>
      (topSearched?.data ?? [])
        .filter((r): r is TopSearch & { slug: string; image: string } => r.type === 'creature' && !!r.slug && !!r.image)
        .slice(0, 12),
    [topSearched],
  )
  const activeSlugs = useMemo(() => new Set(creatures.map((c) => c.slug)), [creatures])

  return (
    <div className="space-y-3">
      <Seo title={t('map.title')} description={t('map.intro')} path="/map" />
      {/* Compact header — title and intro share a row on wide screens so the
          controls and map sit higher up the page. */}
      <div className="flex flex-col gap-x-8 gap-y-1 md:flex-row md:items-baseline md:justify-between">
        <div className="shrink-0">
          <p className="text-xs font-bold uppercase tracking-widest text-accent">{t('map.kicker')}</p>
          <h1 className="text-2xl font-black tracking-tight">{t('map.title')}</h1>
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-fg-dim">{t('map.intro')}</p>
      </div>

      {/* Primary toolbar — creature search + navigation + actions, one row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <div className="relative">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-mute"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder={t('map.searchCreature')}
              className="h-12 w-full rounded-xl border-2 border-line bg-bg-2 pl-12 pr-4 text-base font-semibold text-fg shadow-sm outline-none transition placeholder:font-medium placeholder:text-fg-mute hover:border-line-2 focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </div>
          {searchOpen && debouncedQuery.trim().length >= 2 && searchResults && searchResults.length > 0 && (
            <ul className="absolute z-[1100] mt-2 max-h-80 w-full overflow-auto rounded-xl border-2 border-line bg-bg-2 py-1.5 shadow-2xl">
              {searchResults.map((r) => (
                <li key={r.slug}>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addCreature(r.slug)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2"
                  >
                    {r.image ? (
                      <img
                        src={r.image}
                        alt=""
                        className="h-6 w-6 shrink-0 object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <TypeIcon type={r.type} className="h-4 w-4 shrink-0 text-fg-mute" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {r.name}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-mute">
                      {t(`types.${r.type}`)}
                    </span>
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
          className="h-11 rounded-lg border border-line bg-bg-2 px-3 text-sm font-bold uppercase tracking-wider text-fg-dim outline-none transition hover:border-line-2"
        >
          <option value="">{t('map.goTo')}</option>
          {LANDMARKS.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {/* Directions — the headline action, keeps its label */}
          <button
            onClick={() => {
              const next = !routeMode
              setRouteMode(next)
              if (next) setPlacing(false)
              resetRoute()
            }}
            className={`inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-bold uppercase tracking-wider transition ${
              routeMode
                ? 'border-accent bg-accent text-white shadow-[0_4px_14px_-6px_rgba(156,59,46,0.9)]'
                : 'border-line bg-bg-2 text-fg-dim hover:border-line-2 hover:text-fg'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="3 11 22 2 13 21 11 13 3 11" />
            </svg>
            {routeMode ? t('map.routeActive') : t('map.route')}
          </button>

          {/* Add marker — icon only */}
          <button
            onClick={() => {
              setPlacing((p) => !p)
              setRouteMode(false)
            }}
            title={t('map.addMarker')}
            aria-label={t('map.addMarker')}
            className={`grid h-11 w-11 place-items-center rounded-lg border transition ${
              placing
                ? 'border-accent bg-accent text-white'
                : 'border-line bg-bg-2 text-fg-dim hover:border-line-2 hover:text-fg'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
              <path d="M12 8v4M10 10h4" />
            </svg>
          </button>

          {/* Clear markers — icon only, with count */}
          {markers.length > 0 && (
            <button
              onClick={() => setMarkers([])}
              title={`${t('map.clear')} (${markers.length})`}
              aria-label={`${t('map.clear')} (${markers.length})`}
              className="relative grid h-11 w-11 place-items-center rounded-lg border border-line bg-bg-2 text-fg-mute transition hover:border-line-2 hover:text-fg"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
              <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                {markers.length}
              </span>
            </button>
          )}

          {/* Share link — icon only */}
          <button
            onClick={share}
            title={t('map.share')}
            aria-label={t('map.share')}
            className={`grid h-11 w-11 place-items-center rounded-lg border transition ${
              copied
                ? 'border-canon bg-canon/15 text-canon'
                : 'border-line bg-bg-2 text-fg-dim hover:border-line-2 hover:text-fg'
            }`}
          >
            {copied ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Directions bar — origin/destination pickers (city dropdown or map click).
          Quiet paper inset like the layer panel below, so it blends with the page
          instead of reading as a brighter plate. */}
      {routeMode && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-bg-2/40 px-3 py-2.5 text-sm">
          {/* Origin */}
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-canon ring-2 ring-white/80" />
            <select
              value={endpointValue(routeStart)}
              onChange={(e) => {
                const v = e.target.value
                if (v === '') clearRouteEndpoint('start')
                else if (v !== '__pt__') pickCityEndpoint('start', v)
              }}
              className="h-9 rounded-lg border border-line bg-bg-2 px-2.5 text-sm font-semibold text-fg-dim outline-none transition hover:border-line-2 focus:border-accent"
            >
              <option value="">{t('map.routeFrom')}</option>
              {routeStart && !routeStart.label && <option value="__pt__">{t('map.routePoint')}</option>}
              {LANDMARKS.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-fg-mute" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>

          {/* Destination */}
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent ring-2 ring-white/80" />
            <select
              value={endpointValue(routeEnd)}
              onChange={(e) => {
                const v = e.target.value
                if (v === '') clearRouteEndpoint('end')
                else if (v !== '__pt__') pickCityEndpoint('end', v)
              }}
              className="h-9 rounded-lg border border-line bg-bg-2 px-2.5 text-sm font-semibold text-fg-dim outline-none transition hover:border-line-2 focus:border-accent"
            >
              <option value="">{t('map.routeTo')}</option>
              {routeEnd && !routeEnd.label && <option value="__pt__">{t('map.routePoint')}</option>}
              {LANDMARKS.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status / itinerary */}
          {routeBusy ? (
            <span className="text-fg-dim">{t('map.routeBusy')}</span>
          ) : routePlan ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-dim">
              {routePlan.totalTiles > 0 && routePlan.legs.length > 1 && (
                <span className="mr-1 rounded-[2px] border border-line bg-bg-2 px-2 py-0.5 font-bold tabular-nums text-fg">
                  {routePlan.totalTiles.toLocaleString()} {t('map.routeDist')}
                </span>
              )}
              {(() => {
                // Gear the player must bring for this route (rope / shovel legs).
                const tools = new Set(
                  routePlan.legs.flatMap((l) => (l.kind === 'stairs' && l.tool ? [l.tool] : [])),
                )
                if (tools.size === 0) return null
                const words = [
                  ...(tools.has('rope') ? [t('map.routeNeedRope')] : []),
                  ...(tools.has('shovel') ? [t('map.routeNeedShovel')] : []),
                ]
                return (
                  <span className="mr-1 rounded-[2px] border border-theory/60 bg-theory/10 px-2 py-0.5 font-semibold text-fg-dim">
                    {tools.has('rope') && <Icon name="rope" />} {tools.has('shovel') && <Icon name="pickaxe" />}{' '}
                    {t('map.routeBring', { items: words.join(' + ') })}
                  </span>
                )
              })()}
              {routePlan.legs
                .filter((leg) => leg.kind !== 'walk' || leg.tiles > 2)
                .map((leg, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-gold">·</span>}
                  {leg.kind === 'walk' ? (
                    <span className="flex items-center gap-1">
                      <Icon name="walk" />
                      {leg.tiles.toLocaleString()} {t('map.routeDist')}
                    </span>
                  ) : leg.kind === 'boat' ? (
                    <span className="flex items-center gap-1 font-semibold text-interp">
                      <Icon name={leg.icon} />
                      {leg.lineName === 'Barco'
                        ? t('map.routeBoatTo', { city: leg.toName })
                        : `${leg.lineName} → ${leg.toName}`}
                    </span>
                  ) : (
                    <button
                      onClick={() => setFloor(leg.toFloor)}
                      title={t('map.floor')}
                      className="flex items-center gap-1 font-semibold text-accent transition hover:text-accent-2"
                    >
                      <span aria-hidden>
                        {leg.tool === 'rope' ? <Icon name="rope" /> : leg.tool === 'shovel' ? <Icon name="pickaxe" /> : leg.dir === 'down' ? '▼' : leg.dir === 'up' ? '▲' : '⇄'}
                      </span>
                      {leg.tool === 'rope'
                        ? t('map.routeRope', { floor: floorLabel(leg.toFloor) })
                        : leg.tool === 'shovel'
                          ? t('map.routeShovel', { floor: floorLabel(leg.toFloor) })
                          : leg.dir === 'teleport'
                            ? t('map.routeTeleport', { floor: floorLabel(leg.toFloor) })
                            : t('map.routeStairs', { floor: floorLabel(leg.toFloor) })}
                    </button>
                  )}
                </span>
              ))}
            </span>
          ) : !routeStart || !routeEnd ? (
            <span className="text-fg-dim">{t('map.routeHintStart')}</span>
          ) : null}
          {routeMsg && <span className="font-semibold text-accent">{routeMsg}</span>}

          {(routeStart || routeEnd || routePlan) && (
            <button
              onClick={resetRoute}
              className="ml-auto text-sm font-bold uppercase tracking-wider text-fg-mute transition hover:text-accent"
            >
              ✕ {t('map.routeClear')}
            </button>
          )}
        </div>
      )}

      {/* Spawn overlay control panel */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-line bg-bg-2/40 px-3 py-2.5">
        {/* Primary display mode — one choice at a time */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-bg p-1">
            {(
              [
                { key: 'hide', label: t('map.modeHide'), on: 'bg-line text-fg' },
                { key: 'all', label: `● ${t('map.modeAll')}`, on: 'bg-accent text-white' },
                { key: 'boss', label: `☠ ${t('map.bosses')}`, on: 'bg-theory text-white' },
              ] as const
            ).map((seg) => {
              const mode = !showAll ? 'hide' : bossOnly ? 'boss' : 'all'
              const active = mode === seg.key
              return (
                <button
                  key={seg.key}
                  onClick={() => {
                    if (seg.key === 'hide') setShowAll(false)
                    else if (seg.key === 'all') {
                      setShowAll(true)
                      setBossOnly(false)
                    } else {
                      setShowAll(true)
                      setBossOnly(true)
                    }
                  }}
                  className={`rounded-md px-3.5 py-1.5 text-sm font-bold uppercase tracking-wider transition ${
                    active ? seg.on : 'text-fg-mute hover:text-fg'
                  }`}
                >
                  {seg.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Imported client markers (points of interest) */}
        <button
          onClick={() => setShowPoi((v) => !v)}
          title={t('map.markersHint')}
          className={`h-9 rounded-lg border px-3.5 text-sm font-bold uppercase tracking-wider transition ${
            showPoi
              ? 'border-interp bg-interp/15 text-interp'
              : 'border-line bg-bg-2 text-fg-dim hover:border-line-2 hover:text-fg'
          }`}
        >
          ⚑ {t('map.markersLayer')}
        </button>

        <span className="hidden h-7 w-px bg-line sm:block" />

        {/* Refine — toggles the collapsible filter row below */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          title={t('map.filters')}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-sm font-bold uppercase tracking-wider transition ${
            showFilters || activeFilterCount
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-line bg-bg-2 text-fg-dim hover:border-line-2 hover:text-fg'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          {t('map.filters')}
          {activeFilterCount > 0 && (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>

        {showAll && (
          <span className="ml-auto text-sm font-bold tabular-nums text-fg-dim">
            {shownCount.toLocaleString()} <span className="font-semibold text-fg-mute">{t('map.spawnsShown')}</span>
          </span>
        )}
      </div>

      {/* Collapsible refine panel — hidden until "Filtros" is opened, so it
          doesn't take a permanent row above the map. */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg-2/40 px-3 py-2.5">
          <select
            value={catFilter}
            onChange={(e) => {
              setCatFilter(e.target.value)
              setShowAll(true)
            }}
            title={t('map.category')}
            className="h-9 rounded-lg border border-line bg-bg-2 px-3 text-sm font-semibold text-fg-dim outline-none transition hover:border-line-2 focus:border-accent"
          >
            <option value="">{t('map.category')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={zoneFilter}
            onChange={(e) => {
              setZoneFilter(e.target.value)
              setShowAll(true)
            }}
            title={t('map.zone')}
            className="h-9 rounded-lg border border-line bg-bg-2 px-3 text-sm font-semibold text-fg-dim outline-none transition hover:border-line-2 focus:border-accent"
          >
            <option value="">{t('map.zone')}</option>
            {LANDMARKS.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>

          <select
            value={levelFilter}
            onChange={(e) => {
              setLevelFilter(e.target.value)
              setShowAll(true)
            }}
            title={t('map.level')}
            className="h-9 rounded-lg border border-line bg-bg-2 px-3 text-sm font-semibold text-fg-dim outline-none transition hover:border-line-2 focus:border-accent"
          >
            <option value="">{t('map.level')}</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setCatFilter('')
                setZoneFilter('')
                setLevelFilter('')
              }}
              className="text-sm font-bold uppercase tracking-wider text-accent transition hover:text-accent-2"
            >
              ✕ {t('map.clearFilters')}
            </button>
          )}
        </div>
      )}

      {/* Map + "most searched" quick-access rail: a single background-less column
          of creature icons down the left edge. Tapping one plots it on the map. */}
      <div className="flex gap-2 sm:gap-3">
        {hot.length > 0 && (
          <aside className="order-1 flex h-[78vh] min-h-[440px] shrink-0 flex-col items-center gap-1.5 overflow-y-auto px-1">
            {hot.map((r) => {
              const on = activeSlugs.has(r.slug)
              const name = r.name ?? r.term
              return (
                <button
                  key={r.slug}
                  onClick={() => (on ? removeCreature(r.slug) : addCreature(r.slug))}
                  title={name}
                  aria-label={name}
                  className={`group grid h-11 w-11 shrink-0 place-items-center rounded-lg transition ${
                    on ? 'bg-accent/15 ring-1 ring-inset ring-accent/50' : 'hover:bg-bg-2'
                  }`}
                >
                  <img
                    src={r.image}
                    alt={name}
                    loading="lazy"
                    className="sprite h-10 w-10 object-contain transition group-hover:scale-110"
                  />
                </button>
              )
            })}
          </aside>
        )}

      <div className="relative order-2 flex-1 overflow-hidden rounded-lg border border-line bg-[#0e1015]">
        <div ref={containerRef} className="h-[78vh] min-h-[440px] w-full" style={{ background: '#0e1015' }} />

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
      </div>

      {/* Active creature legend — sits below the map so adding creatures never
          pushes the map down the page. */}
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
              {cr.image && <img src={cr.image} alt="" loading="lazy" className="tm-legend-sprite" />}
              <span className="text-fg">{cr.name}</span>
              <span className="text-fg-mute">
                {spawnsOnFloor(cr)}/{cr.spawns.length}
              </span>
              {cr.clusters.length > 0 && (
                <button
                  onClick={() => jumpToBest(cr.slug)}
                  className="flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent transition hover:bg-accent/25"
                  title={t('map.bestSpawn')}
                >
                  <span aria-hidden>⭐</span>
                  <span className="tabular-nums">{cr.clusters[0].count}×</span>
                  <span className="text-accent/70">z{cr.clusters[0].z}</span>
                </button>
              )}
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

      {/* Imported-marker category legend — below the map, shown only with the layer on */}
      {showPoi && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs font-semibold text-fg-dim">
          <span className="text-[10px] font-bold uppercase tracking-widest text-fg-mute">
            {t('map.markersLegend')}
          </span>
          {[
            { c: '#d23d2f', i: POI_ICONS.boss, l: t('map.poiBoss') },
            { c: '#3fa7d6', i: POI_ICONS.travel, l: t('map.poiTravel') },
            { c: '#6cc551', i: POI_ICONS.service, l: t('map.poiService') },
            { c: '#e0a531', i: POI_ICONS.quest, l: t('map.poiQuest') },
            { c: '#9b8cff', i: POI_ICONS.poi, l: t('map.poiOther') },
          ].map((e) => (
            <span key={e.l} className="flex items-center gap-1.5">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white/90"
                style={{ background: e.c }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d={e.i} />
                </svg>
              </span>
              {e.l}
            </span>
          ))}
        </div>
      )}

      <p className="text-xs text-fg-mute">{t('map.disclaimer')}</p>

      {/* New-marker naming modal (replaces the old window.prompt) */}
      {markerDraft && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setMarkerDraft(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-line bg-bg-2 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-black tracking-tight text-fg">
              {t('map.markerModalTitle')}
            </h3>
            <p className="mt-1 font-mono text-xs tabular-nums text-fg-mute">
              {markerDraft.x}, {markerDraft.y}, z{markerDraft.floor}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                addMarkerRef.current({
                  id: crypto.randomUUID(),
                  x: markerDraft.x,
                  y: markerDraft.y,
                  floor: markerDraft.floor,
                  label: draftLabel.trim(),
                })
                setMarkerDraft(null)
              }}
            >
              <input
                autoFocus
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setMarkerDraft(null)
                }}
                placeholder={t('map.markerPrompt')}
                className="mt-3 h-11 w-full rounded-lg border-2 border-line bg-bg px-3 text-sm font-semibold text-fg outline-none transition placeholder:font-medium placeholder:text-fg-mute focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMarkerDraft(null)}
                  className="h-10 rounded-lg border border-line bg-bg-2 px-4 text-sm font-bold uppercase tracking-wider text-fg-mute transition hover:border-line-2 hover:text-fg"
                >
                  {t('map.markerCancel')}
                </button>
                <button
                  type="submit"
                  className="h-10 rounded-lg bg-accent px-4 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-accent-2"
                >
                  {t('map.markerSave')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
