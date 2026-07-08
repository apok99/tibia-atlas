import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../lib/api'
import { planRoute, type RoutePlan, type RouteLeg } from '../lib/routing'
import { Seo } from '../lib/seo'
import { Icon, iconMarkup } from '../lib/icons'
import { useGlossary } from '../hooks/useGlossary'
import { useBosses, type BossRow } from '../hooks/useKillStats'
import { TypeIcon } from '../components/TypeIcon'
import { Skeleton } from '../components/Skeleton'
import type { Dropper, Entry, EntryListItem, ItemDetail, Spawn } from '../types'

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

// Boss "spawn heat" (0-100) → a qualitative bucket for the Boss Watch strip.
// High heat = no recent kills across worlds, so the boss is likely up; low heat
// = freshly killed (still on cooldown).
function heatBucket(heat: number): 'hot' | 'warm' | 'cold' {
  if (heat >= 66) return 'hot'
  if (heat >= 33) return 'warm'
  return 'cold'
}
const HEAT_STYLE = {
  hot: { cls: 'text-accent', glyph: '🔥', label: 'map.bossHot' },
  warm: { cls: 'text-gold', glyph: '🌡', label: 'map.bossWarm' },
  cold: { cls: 'text-interp', glyph: '❄', label: 'map.bossCold' },
} as const

// Cities/landmarks (surface floor). Coordinates are approximate centres within
// the available tiles — tweak freely if any feels off.
type Landmark = { name: string; x: number; y: number; floor: number }
const LANDMARKS: Landmark[] = [
  { name: "Ab'Dendriel", x: 32665, y: 31652, floor: 7 },
  { name: 'Ankrahmun', x: 33146, y: 32816, floor: 7 },
  { name: 'Carlin', x: 32343, y: 31792, floor: 7 },
  { name: 'Cormaya', x: 33307, y: 31999, floor: 7 },
  // NOTE: route anchors must sit on OPEN city ground. (33236,32432) is the
  // decorative walled garden (a sealed 39-tile pocket) — routes from the
  // dropdown died at the start there. Same for Venore's old (32947,32081).
  { name: 'Darashia', x: 33213, y: 32453, floor: 7 },
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
  { name: 'Venore', x: 32963, y: 32087, floor: 7 },
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
  { name: 'Tyrsung', x: 32464, y: 31173 },
  { name: 'Grimlund', x: 32021, y: 31294 },
  { name: 'Inukaya', x: 32367, y: 31058 },
  // Carlin & western isles
  { name: 'Senja', x: 32020, y: 31692 },
  { name: 'Vega', x: 31974, y: 31901 },
  { name: 'Isle of the Kings', x: 32126, y: 31665 },
  { name: 'Ghostlands', x: 32220, y: 31770 },
  { name: 'Fields of Glory', x: 32440, y: 31960 },
  { name: 'Mintwallin', x: 32540, y: 32200 },
  // Venore surroundings
  { name: 'Green Claw Swamp', x: 32820, y: 32020 },
  { name: 'Amazon Camp', x: 32839, y: 31920 },
  { name: 'Gnomebase Alpha', x: 33001, y: 31900 },
  // Southern seas
  { name: 'Meriana', x: 32132, y: 32912 },
  { name: 'Marapur', x: 33842, y: 32852 },
  { name: 'Murmuring Wilderness', x: 33690, y: 32780 },
  { name: 'Gnomprona', x: 33600, y: 32880 },
  // Zao & the far east
  { name: 'Zao', x: 33350, y: 31370 },
  { name: 'Razachai', x: 33074, y: 31100 },
  { name: 'Zzaion', x: 33262, y: 31100 },
  { name: 'Issavi', x: 33946, y: 31516 },
  { name: 'Warzones 4-6', x: 33800, y: 32170 },
  // Roshamuul & the dream realms
  { name: 'Roshamuul Prison', x: 33520, y: 32600 },
  { name: 'Guzzlemaw Valley', x: 33645, y: 32390 },
  { name: 'Feyrist', x: 33540, y: 32208 },
  { name: 'Candia', x: 33370, y: 32155 },
  // Ankrahmun desert & the Ancient Tombs. Each of the seven tombs is labelled at
  // its surface entrance (client marker coords); the bosses spawn on the floors
  // below. Names match the tomb, with the boss it houses in parentheses.
  { name: 'Mountain Tomb (Dipthrah)', x: 33133, y: 32568 },
  { name: 'Oasis Tomb (Rahemos)', x: 33133, y: 32640 },
  { name: 'Ancient Ruins Tomb (Vashresamun)', x: 33208, y: 32591 },
  { name: 'Tarpit Tomb (Morguthis)', x: 33233, y: 32704 },
  { name: 'Stone Tomb (Thalas)', x: 33282, y: 32743 },
  { name: 'Shadow Tomb (Mahrdis)', x: 33255, y: 32833 },
  { name: 'Library Tomb (Ashmunrah)', x: 33142, y: 32838 },
  { name: 'Horestis Tomb', x: 33026, y: 32710 },
  { name: 'Peninsula Tomb', x: 33027, y: 32869 },
  { name: 'Cobra Bastion', x: 33398, y: 32655 },
  // Tiquanda east coast
  { name: 'Asura Palace', x: 32948, y: 32689 },
  // The Hive & the north-eastern seas
  { name: 'The Hive', x: 33560, y: 31255 },
  { name: 'Hive Outpost', x: 33467, y: 31322 },
  { name: 'Gray Island', x: 33191, y: 31985 },
  { name: 'Orcsoberfest', x: 33779, y: 31054 },
  // Kilmaresh south
  { name: 'Ruins of Nuur', x: 33848, y: 31685 },
  // Starter isles & the dream courts
  { name: 'Island of Destiny', x: 32094, y: 32004 },
  { name: 'Targuna', x: 33514, y: 32720 },
  { name: 'Winter Court', x: 33697, y: 32127 },
  { name: 'Summer Court', x: 33691, y: 32213 },
  // Forbidden Islands (wiki Mapper Coords)
  { name: 'Talahu', x: 31953, y: 32660 },
  { name: 'Kharos', x: 32121, y: 32686 },
  { name: 'Malada', x: 32016, y: 32713 },
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

// A published community route from GET /api/routes (ranked by load count).
type CommunityRoute = {
  id: number
  name: string
  description: string | null
  waypoints: [number, number, number][]
  connect: 'auto' | 'straight'
  author: string | null
  views: number
  created_at: string
}

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

// The per-spawn orange dots are only drawn from this zoom in. Zoomed further out
// they just speckle the whole map, so there we show only the grouped ×N sprites.
const DOT_MIN_ZOOM = 2

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

// Draw a route's legs onto a layer group for the floor in view: walk polylines
// (ink on parchment), boat hops (dashed) and stair/rope/shovel/levitate
// floor-change badges. Shared by the "how to get there" directions and the
// manual route builder so both render identically. `floorWord` is the localized
// "Floor" label; `onFloorJump` switches the map to a leg's destination floor.
function drawRouteLegs(
  grp: L.LayerGroup,
  legs: RouteLeg[],
  floor: number,
  floorWord: string,
  floorLabel: (f: number) => string,
  onFloorJump: (f: number) => void,
) {
  for (const leg of legs) {
    if (leg.kind === 'walk') {
      if (leg.floor !== floor || leg.path.length < 2) continue
      const latlngs = leg.path.map((p) => toLatLng(p.x, p.y))
      grp.addLayer(
        L.polyline(latlngs, { color: '#f4e7c6', weight: 7, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }),
      )
      grp.addLayer(
        L.polyline(latlngs, { color: '#3b2313', weight: 3.5, opacity: 1, lineJoin: 'round', lineCap: 'round' }),
      )
    } else if (leg.kind === 'boat') {
      if (floor !== leg.fromFloor && floor !== leg.toFloor) continue
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
      const glyph =
        leg.tool === 'rope' ? iconMarkup('rope') : leg.tool === 'shovel' ? iconMarkup('pickaxe') : leg.tool === 'levitate' ? iconMarkup('sparkles') : leg.dir === 'down' ? '▼' : leg.dir === 'up' ? '▲' : '⇄'
      const cls = leg.dir === 'down' ? 'is-down' : leg.dir === 'up' ? 'is-up' : 'is-tp'
      grp.addLayer(
        L.marker(toLatLng(leg.from.x, leg.from.y), {
          icon: L.divIcon({
            className: '',
            html: `<div class="tm-route-stair ${cls}">${glyph} ${escapeHtml(floorWord)} ${floorLabel(leg.toFloor)}</div>`,
            iconSize: [0, 0],
          }),
        }).on('click', () => onFloorJump(leg.toFloor)),
      )
    }
  }
}

// --- overlay performance helpers ----------------------------------------------

// The "all creatures" dots painted onto one canvas in a single pass. As
// individual L.circleMarkers a floor carries ~10k layer objects that must be
// rebuilt on every floor/filter change and repainted one by one — a single
// canvas draws the same picture in a couple of milliseconds.
type DotsLayer = L.Layer & { setPoints(pts: [number, number, number][]): void }
const DotCanvas = L.Layer.extend({
  setPoints(pts: [number, number, number][]) {
    ;(this as { _pts?: unknown })._pts = pts
    if ((this as { _map?: L.Map })._map) (this as { _redraw(): void })._redraw()
  },
  onAdd(map: L.Map) {
    // `leaflet-layer` gives the canvas `position:absolute; left:0; top:0`.
    // `leaflet-zoom-hide` makes Leaflet hide the canvas for the duration of the
    // zoom animation (visibility:hidden while the map pane carries
    // `leaflet-zoom-anim`) — exactly what it does to the DOM marker panes that
    // hold the creature sprites and POIs. So the dots and their sprites hide
    // together mid-zoom and are redrawn together on zoomend/moveend, staying
    // locked to each other. (Keeping the canvas visible and transforming it
    // per-frame instead left the dots drifting out of their orange circle while
    // the map scaled, since the sprites they sit under are hidden meanwhile.)
    const canvas = L.DomUtil.create('canvas', 'leaflet-layer leaflet-zoom-hide')
    canvas.style.pointerEvents = 'none'
    ;(this as { _canvas?: HTMLCanvasElement })._canvas = canvas
    map.getPanes().overlayPane.appendChild(canvas)
    map.on('moveend resize zoomend', (this as { _reset(): void })._reset, this)
    ;(this as { _reset(): void })._reset()
    return this
  },
  onRemove(map: L.Map) {
    map.off('moveend resize zoomend', (this as { _reset(): void })._reset, this)
    ;(this as { _canvas: HTMLCanvasElement })._canvas.remove()
    return this
  },
  _reset() {
    const map = (this as { _map: L.Map })._map
    L.DomUtil.setPosition(
      (this as { _canvas: HTMLCanvasElement })._canvas,
      map.containerPointToLayerPoint([0, 0]),
    )
    ;(this as { _redraw(): void })._redraw()
  },
  _redraw() {
    const map = (this as { _map: L.Map })._map
    const canvas = (this as { _canvas: HTMLCanvasElement })._canvas
    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== size.x * dpr || canvas.height !== size.y * dpr) {
      canvas.width = size.x * dpr
      canvas.height = size.y * dpr
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.x, size.y)
    const pts = ((this as { _pts?: [number, number, number][] })._pts ?? [])
    if (!pts.length) return
    // Same look as the old circle markers: radius 7, dark ring, orange fill.
    const R = 7
    ctx.beginPath()
    for (const p of pts) {
      const pt = map.latLngToContainerPoint([-p[1], p[0]])
      if (pt.x < -R || pt.y < -R || pt.x > size.x + R || pt.y > size.y + R) continue
      ctx.moveTo(pt.x + R, pt.y)
      ctx.arc(pt.x, pt.y, R, 0, Math.PI * 2)
    }
    ctx.globalAlpha = 0.9
    ctx.fillStyle = '#ff7a33'
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.strokeStyle = '#2a0d00'
    ctx.stroke()
  },
})

// Incrementally sync a layer group with the wanted marker set: keys that
// survive keep their existing marker (no DOM churn while panning), the rest
// are added/removed. `epoch` names the inputs the cache was built from — when
// it changes (zoom, floor, filter set…) the whole group is rebuilt.
type MarkerCache = { epoch: string; markers: Map<string, L.Marker> }
function syncMarkers(
  grp: L.LayerGroup,
  cache: MarkerCache,
  epoch: string,
  wanted: Map<string, () => L.Marker>,
) {
  if (cache.epoch !== epoch) {
    grp.clearLayers()
    cache.markers.clear()
    cache.epoch = epoch
  }
  for (const [key, mk] of cache.markers) {
    if (wanted.has(key)) continue
    if (mk.isPopupOpen()) continue // keep an open popup anchored while panning
    grp.removeLayer(mk)
    cache.markers.delete(key)
  }
  for (const [key, make] of wanted) {
    if (!cache.markers.has(key)) {
      const mk = make()
      mk.addTo(grp)
      cache.markers.set(key, mk)
    }
  }
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

// A manually built route restored from the hash: ordered waypoints, how they
// connect, and an optional name.
type HashBuild = {
  points: { x: number; y: number; floor: number }[]
  connect: 'auto' | 'straight'
  name: string
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
  build: HashBuild | null
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
  // Built route: bp = points (x,y,f ; …), bc = connect mode, bn = name.
  let build: HashBuild | null = null
  if (parts.bp) {
    const points: { x: number; y: number; floor: number }[] = []
    for (const chunk of parts.bp.split(';')) {
      if (!chunk) continue
      const [px, py, pf] = chunk.split(',')
      if (px && py && pf) points.push({ x: Number(px), y: Number(py), floor: Number(pf) })
    }
    if (points.length)
      build = {
        points,
        connect: parts.bc === 'auto' ? 'auto' : 'straight',
        name: decodeURIComponent(parts.bn ?? ''),
      }
  }
  return { x: num('x'), y: num('y'), z: num('z'), floor: num('f'), markers, creatures, routeStart, routeEnd, build }
}

// --- immersive map "hotbar" styling -------------------------------------------
// A compact row of square icon slots: the search field stays the hero, and every
// secondary action collapses into a tooltip-labelled icon. PILL is the slotted
// bar that groups them; SLOT/SLOT_ON/SLOT_OFF style each slot.
const PILL =
  'pointer-events-auto inline-flex flex-wrap items-center gap-1 rounded-2xl border border-line-2 bg-bg/85 p-1.5 shadow-lg backdrop-blur-md'
const SLOT = 'grid h-11 w-11 place-items-center rounded-lg border transition'
const SLOT_OFF =
  'border-line/40 bg-bg-2/40 text-fg-dim hover:border-line-2 hover:bg-surface hover:text-fg'
const SLOT_ON = 'border-accent bg-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'

// Quick-launch "mini windows" floated on the map: shortcuts to the site's games
// and stats. Titles/taglines reuse the existing nav + section-kicker i18n keys.
const QUICK_LINKS: { to: string; title: string; kicker: string; icon: string }[] = [
  // wordle grid
  { to: '/wordle', title: 'nav.wordle', kicker: 'wordle.kicker', icon: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18' },
  // sparkles (daily silhouette game)
  {
    to: '/altar',
    title: 'nav.altar',
    kicker: 'altar.kicker',
    icon: 'M12 3l-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z',
  },
  // bar chart
  { to: '/killstats', title: 'nav.killstats', kicker: 'ks.kicker', icon: 'M3 3v18h18M8 17V9M13 17v-5M18 17V6' },
]

export function MapPage() {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  // The immersive canvas root + the top-left control column, so the boss-watch
  // sidebar can start right below the column (avoids overlapping the search /
  // route / creature panels when they grow).
  const rootRef = useRef<HTMLDivElement>(null)
  const topColRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.GridLayer | null>(null)
  const markersGroupRef = useRef<L.LayerGroup | null>(null)
  const cityGroupRef = useRef<L.LayerGroup | null>(null)
  const spawnGroupRef = useRef<L.LayerGroup | null>(null)
  const dotsLayerRef = useRef<DotsLayer | null>(null)
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
  // Diff caches for the marker layers (see syncMarkers) so pans/zooms reuse
  // existing DOM markers instead of rebuilding every one.
  const spriteCacheRef = useRef<MarkerCache>({ epoch: '', markers: new Map() })
  const poiCacheRef = useRef<MarkerCache>({ epoch: '', markers: new Map() })
  const creatureCacheRef = useRef<MarkerCache>({ epoch: '', markers: new Map() })
  // Bumped whenever the filtered point set changes, invalidating sprite reps.
  const overlayGenRef = useRef(0)

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
  // What the search box looks up: a creature (plot its spawns) or an item (plot
  // every creature that drops it). "Dónde farmeo este objeto".
  const [searchKind, setSearchKind] = useState<'creature' | 'item'>('creature')
  // The item whose droppers are currently plotted, for the context banner.
  const [activeItem, setActiveItem] = useState<{
    slug: string
    name: string
    image: string | null
    plotted: string[] // dropper slugs plotted as creatures
    total: number // droppers with a slug (may exceed plotted if capped)
  } | null>(null)
  const [itemBusy, setItemBusy] = useState(false)
  const [showAll, setShowAll] = useState(true)
  const [catFilter, setCatFilter] = useState('') // '' = all classifications
  const [zoneFilter, setZoneFilter] = useState('') // '' = whole map
  const [levelFilter, setLevelFilter] = useState('') // '' = any difficulty
  const [bossOnly, setBossOnly] = useState(false) // show only bosses
  const [showPoi, setShowPoi] = useState(false) // imported minimap markers layer
  const [showFilters, setShowFilters] = useState(false) // collapsible refine panel
  const [bossRailOpen, setBossRailOpen] = useState(true) // world-boss watch sidebar
  const [bossTop, setBossTop] = useState(112) // sidebar top = bottom of the control column
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

  // Manual route builder ("crear ruta"): place ordered waypoints by clicking,
  // connected either by the A* auto-router (planRoute between consecutive points)
  // or by straight lines. The result is named and shareable via the URL, exactly
  // like the directions plan.
  const [buildMode, setBuildMode] = useState(!!initial.build)
  const [buildPoints, setBuildPoints] = useState<RoutePoint[]>(initial.build?.points ?? [])
  const [buildConnect, setBuildConnect] = useState<'auto' | 'straight'>(initial.build?.connect ?? 'straight')
  const [buildName, setBuildName] = useState(initial.build?.name ?? '')
  const [buildPlan, setBuildPlan] = useState<RoutePlan | null>(null)
  const [buildBusy, setBuildBusy] = useState(false)
  const [publishState, setPublishState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  // Community route gallery: published routes others submitted, ranked by loads.
  const [routesOpen, setRoutesOpen] = useState(false)
  const buildGroupRef = useRef<L.LayerGroup | null>(null)
  const buildModeRef = useRef(buildMode)
  const buildPointsRef = useRef(buildPoints)
  const buildConnectRef = useRef(buildConnect)
  const buildNameRef = useRef(buildName)
  const appendBuildPointRef = useRef<(p: RoutePoint) => void>(() => {})
  buildModeRef.current = buildMode
  buildPointsRef.current = buildPoints
  buildConnectRef.current = buildConnect
  buildNameRef.current = buildName
  appendBuildPointRef.current = (p) => setBuildPoints((prev) => [...prev, p])

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
  const renderCreaturesRef = useRef<() => void>(() => {})
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
      // Best-effort route: warn that the trail goes cold before the target and
      // say where/how far, instead of a bare "no route".
      if (plan.partial)
        setRouteMsg(
          t('map.routePartial', {
            tiles: plan.partial.remaining,
            floor: plan.partial.floor === SURFACE ? '0' : plan.partial.floor < SURFACE ? `+${SURFACE - plan.partial.floor}` : `${SURFACE - plan.partial.floor}`,
          }),
        )
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

  // --- manual route builder actions ---
  function toggleBuildMode() {
    const next = !buildMode
    setBuildMode(next)
    // Modes are mutually exclusive: leaving directions / marker placement on
    // would fight the builder for map clicks.
    if (next) {
      setRouteMode(false)
      setPlacing(false)
    }
  }

  function undoBuildPoint() {
    setBuildPoints((prev) => prev.slice(0, -1))
  }

  function clearBuild() {
    setBuildPoints([])
    setBuildName('')
    setBuildPlan(null)
    setPublishState('idle')
  }

  // Submit the built route for review. No accounts: it's stored anonymously
  // (optional name + the server-recorded IP) as `pending` until a reviewer
  // publishes it.
  async function publishRoute() {
    if (buildPoints.length < 2 || !buildName.trim() || publishState === 'sending') return
    setPublishState('sending')
    try {
      await api.post('/routes', {
        name: buildName.trim(),
        connect: buildConnect,
        waypoints: buildPoints.map((p) => [Math.round(p.x), Math.round(p.y), p.floor]),
      })
      setPublishState('done')
    } catch {
      setPublishState('error')
    }
  }

  // A route endpoint's <select> value: the city name, a sentinel for a clicked
  // point, or '' when unset.
  // A picked landmark shows its own name in the dropdown; anything else (a raw
  // map click, or a spawn plotted via a creature's "how to get there" button)
  // falls back to the synthetic "__pt__" option so the select never renders blank.
  const isLandmark = (p: RoutePoint | null) => !!p?.label && LANDMARKS.some((l) => l.name === p.label)
  const endpointValue = (p: RoutePoint | null) => (p ? (isLandmark(p) ? p.label! : '__pt__') : '')

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
    overlayGenRef.current++ // sprite representatives may change wholesale
    setShownCount(showAllRef.current ? f.length : 0)
    renderSpritesRef.current() // paints both the ×N sprites and the (gated) dots
  }

  // Render the "all creatures" sprites for the spawns in view, de-duplicated by
  // a grid so photos show at any zoom without piling up (dense areas thin out;
  // the orange dots underneath still show every spawn). The grid is anchored in
  // projected (world-pixel) space rather than container pixels, so each cell's
  // representative stays put while panning and the syncMarkers diff reuses the
  // existing DOM nodes instead of rebuilding every sprite on each moveend.
  renderSpritesRef.current = () => {
    const grp = allSpriteGroupRef.current
    const map = mapRef.current
    if (!grp || !map) return
    const points = filteredRef.current
    const { names, images, slugs } = allPointsRef.current

    if (!showAllRef.current || !points.length) {
      syncMarkers(grp, spriteCacheRef.current, 'off', new Map())
      dotsLayerRef.current?.setPoints([])
      return
    }

    const zoom = map.getZoom()
    // Orange per-spawn dots only from DOT_MIN_ZOOM in; zoomed further out the
    // grouped sprites carry the picture and the dots would just be noise.
    dotsLayerRef.current?.setPoints(zoom >= DOT_MIN_ZOOM ? points : [])
    // Scale the sprite badge with zoom so it doesn't look tiny when zoomed in,
    // and keep the de-dup grid a bit larger than the badge to avoid overlap.
    const size = Math.max(28, Math.min(64, Math.round(22 + zoom * 9)))
    const imgPx = Math.round(size * 0.85)
    // Grouping grid: a multiple of the badge footprint that grows as you zoom
    // out (where the badge itself is clamped small but each screen cell covers
    // far more world), so an overview collapses spawns into a few hundred
    // sprites while a close-up separates them into individuals. `7 - zoom`,
    // clamped, sweeps the factor from ~8 when fully zoomed out to ~2.5 zoomed in.
    const groupFactor = Math.max(2.5, Math.min(8, 7 - zoom))
    const cell = Math.round((size + 6) * groupFactor)
    const view = map.getPixelBounds()
    const minX = view.min!.x - cell
    const maxX = view.max!.x + cell
    const minY = view.min!.y - cell
    const maxY = view.max!.y + cell
    // How many distinct species a cell may show, by zoom: an overview keeps only
    // the dominant creature(s) so it reads at a glance, and zooming in reveals
    // the full species mix. Spawns beyond the cap stay visible as orange dots.
    const perCell = zoom <= 0 ? 2 : zoom <= 2 ? 4 : zoom <= 4 ? 8 : Infinity
    // Aggregate spawns per grid cell, then per species within each cell, so
    // repeats of one species collapse into an ×N count. Each cell then emits its
    // top `perCell` species (ranked by spawn count) as sprites.
    type CellAgg = { p: [number, number, number]; n: number }
    const cells = new Map<string, Map<number, CellAgg>>()
    for (const p of points) {
      const pt = map.project(toLatLng(p[0], p[1]), zoom)
      if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) continue
      const ck = Math.floor(pt.x / cell) + '_' + Math.floor(pt.y / cell)
      let byName = cells.get(ck)
      if (!byName) cells.set(ck, (byName = new Map()))
      const hit = byName.get(p[2])
      if (hit) hit.n++
      else byName.set(p[2], { p, n: 1 })
    }
    const wanted = new Map<string, () => L.Marker>()
    for (const [ck, byName] of cells) {
      if (wanted.size >= SPRITE_CAP) break
      const top =
        perCell === Infinity
          ? [...byName.values()]
          : [...byName.values()].sort((a, b) => b.n - a.n).slice(0, perCell)
      for (const agg of top) {
      const { p, n } = agg
      // Fold cell + species + count into the marker key so a cell whose N
      // changes while panning (points entering/leaving the edge) rebuilds it.
      wanted.set(ck + '_' + p[2] + '_' + n, () => {
        const ci = p[2]
        const img = images[ci]
          ? `<img src="${escapeHtml(images[ci]!)}" alt="" loading="lazy" style="width:${imgPx}px;height:${imgPx}px" />`
          : ''
        const badge =
          n > 1
            ? `<span class="tm-spawn-count" style="left:${Math.round(size * 0.34)}px;top:-${Math.round(size * 0.4)}px">&times;${n}</span>`
            : ''
        const icon = L.divIcon({
          className: '',
          html: `<div class="tm-spawn-marker"><div class="tm-spawn tm-spawn-all" style="--ring:#ff7a33;width:${size}px;height:${size}px">${img}</div>${badge}</div>`,
          iconSize: [0, 0],
        })
        const title = n > 1 ? escapeHtml(names[ci]) + ' (&times;' + n + ')' : escapeHtml(names[ci])
        return L.marker(toLatLng(p[0], p[1]), { icon }).bindPopup(
          `<div><div style="font-weight:700">${title}</div>` +
            `<div style="opacity:.55;font-size:11px;margin:2px 0">${p[0]}, ${p[1]}, z${floorRef.current}</div>` +
            `<a href="/entry/${escapeHtml(slugs[ci] ?? '')}" style="color:var(--color-accent);font-size:11px;font-weight:700">${escapeHtml(t('map.viewEntry'))}</a></div>`,
        )
      })
        if (wanted.size >= SPRITE_CAP) break
      }
    }
    syncMarkers(grp, spriteCacheRef.current, `${zoom}|${overlayGenRef.current}`, wanted)
  }

  // Draw the imported minimap POI markers for the current floor. De-duplicated
  // by a screen-pixel grid (like the creature sprites) so dense clusters thin
  // out instead of piling up; each shows its label on hover and coords on click.
  renderPoiRef.current = () => {
    const grp = poiGroupRef.current
    const map = mapRef.current
    if (!grp || !map) return
    if (!showPoiRef.current) {
      syncMarkers(grp, poiCacheRef.current, 'off', new Map())
      return
    }
    const f = floorRef.current
    const zoom = map.getZoom()
    const cell = 34
    const view = map.getPixelBounds()
    const minX = view.min!.x - cell
    const maxX = view.max!.x + cell
    const minY = view.min!.y - cell
    const maxY = view.max!.y + cell
    const wanted = new Map<string, () => L.Marker>()
    for (const m of poiRef.current) {
      if (m.z !== f) continue
      const pt = map.project(toLatLng(m.x, m.y), zoom)
      if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) continue
      const key = Math.floor(pt.x / cell) + '_' + Math.floor(pt.y / cell)
      if (wanted.has(key)) continue
      wanted.set(key, () => {
        const icon = L.divIcon({
          className: '',
          html: `<div class="tm-poi" style="--poi:${m.color}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg></div>`,
          iconSize: [0, 0],
        })
        return L.marker(toLatLng(m.x, m.y), { icon })
          .bindTooltip(escapeHtml(m.desc), { direction: 'top', offset: [0, -9] })
          .bindPopup(
            `<div><div style="font-weight:700">${escapeHtml(m.desc)}</div>` +
              `<div style="opacity:.55;font-size:11px;margin-top:2px">${m.x}, ${m.y}, z${m.z}</div></div>`,
          )
      })
    }
    syncMarkers(grp, poiCacheRef.current, `${f}|${zoom}`, wanted)
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
    if (buildPointsRef.current.length) {
      hash += `&bp=${buildPointsRef.current.map((p) => [Math.round(p.x), Math.round(p.y), p.floor].join(',')).join(';')}`
      hash += `&bc=${buildConnectRef.current}`
      if (buildNameRef.current.trim()) hash += `&bn=${encodeURIComponent(buildNameRef.current.trim())}`
    }
    window.history.replaceState(null, '', '#' + hash)
  }

  // Keep the boss-watch sidebar pinned just below the top-left control column, so
  // it never overlaps the search / route / creature panels as they grow or shrink.
  useEffect(() => {
    const col = topColRef.current
    const root = rootRef.current
    if (!col || !root) return
    const measure = () => {
      const top = col.getBoundingClientRect().bottom - root.getBoundingClientRect().top + 8
      setBossTop(Math.max(64, Math.round(top)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(col)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // --- map init (once) ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      preferCanvas: true, // vector layers (route polylines) render to canvas
      minZoom: 1, // hard floor: never zoom out past z=1 (see resize clamp)
      maxZoom: 5,
      zoomControl: true,
      attributionControl: false,
      maxBounds: [
        [-Y_MAX - TILE, X_MIN - TILE],
        [-Y_MIN + TILE, X_MAX + TILE],
      ],
      maxBoundsViscosity: 1.0,
    })

    // The +/- zoom buttons default to the top-left corner, where they sit under
    // the search pill; move them to the top-right, clear of the floating chrome.
    map.zoomControl.setPosition('topright')

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

    // The "all creatures" dots (potentially ~10k) paint onto a single canvas
    // overlay in one pass — one layer object instead of one per dot.
    const dots = new (DotCanvas as unknown as new () => DotsLayer)()
    dots.addTo(map)
    const allSpriteGroup = L.layerGroup().addTo(map)
    const poiGroup = L.layerGroup().addTo(map)
    const spawnGroup = L.layerGroup().addTo(map)
    const cityGroup = L.layerGroup().addTo(map)
    const markersGroup = L.layerGroup().addTo(map)
    const routeGroup = L.layerGroup().addTo(map)
    const buildGroup = L.layerGroup().addTo(map)

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
    dotsLayerRef.current = dots
    allSpriteGroupRef.current = allSpriteGroup
    poiGroupRef.current = poiGroup
    routeGroupRef.current = routeGroup
    buildGroupRef.current = buildGroup
    // Fresh map, fresh layer groups: the diff caches hold markers bound to the
    // previous map (StrictMode remount), so they must start empty.
    spriteCacheRef.current = { epoch: '', markers: new Map() }
    poiCacheRef.current = { epoch: '', markers: new Map() }
    creatureCacheRef.current = { epoch: '', markers: new Map() }
    setMapReady((v) => v + 1)

    map.on('click', (e: L.LeafletMouseEvent) => {
      const x = Math.round(e.latlng.lng)
      const y = Math.round(-e.latlng.lat)

      // "Crear ruta" builder mode: each click appends an ordered waypoint on the
      // current floor.
      if (buildModeRef.current) {
        appendBuildPointRef.current({ x, y, floor: floorRef.current })
        return
      }

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
      renderCreaturesRef.current()
    })
    syncCenter()

    // The container may have zero size at mount (e.g. inside transitions);
    // recompute once layout settles and whenever it resizes. The immersive map
    // fills the viewport, so the whole world would fit at a very low zoom — but
    // zooming out that far reads as a tiny map floating in black. Keep z=1 as the
    // hard floor; only tighten it further if a small container needs a higher
    // zoom just to fit the bounds.
    const resize = () => {
      map.invalidateSize()
      const fitZoom = map.getBoundsZoom(worldBounds, false)
      const minZ = Math.max(1, Number.isFinite(fitZoom) ? fitZoom : 1)
      map.setMinZoom(minZ)
      if (map.getZoom() < minZ) map.setZoom(minZ)
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
      dotsLayerRef.current = null
      allSpriteGroupRef.current = null
      poiGroupRef.current = null
      routeGroupRef.current = null
      buildGroupRef.current = null
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

  // Draw the selected creatures' spawn icons. Seven creatures can carry ~700
  // spawn points and Leaflet repositions every DOM marker on each zoom, so only
  // spawns in (or near) the viewport get a DOM node; keys are world coordinates
  // and pans/zooms reuse the existing markers (syncMarkers), adding/removing
  // just the ones that cross the padded view edge.
  renderCreaturesRef.current = () => {
    const grp = spawnGroupRef.current
    const map = mapRef.current
    if (!grp || !map) return
    const f = floorRef.current
    const zoom = map.getZoom()
    const pad = 160 // px beyond the view so edge markers don't pop in late
    const view = map.getPixelBounds()
    const minX = view.min!.x - pad
    const maxX = view.max!.x + pad
    const minY = view.min!.y - pad
    const maxY = view.max!.y + pad
    const wanted = new Map<string, () => L.Marker>()
    for (const cr of creaturesRef.current) {
      const img = cr.image
        ? `<img src="${escapeHtml(cr.image)}" alt="" loading="lazy" />`
        : ''
      for (const sp of cr.spawns) {
        if (sp.z !== f) continue
        const pt = map.project(toLatLng(sp.x, sp.y), zoom)
        if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) continue
        wanted.set(`${cr.slug}_${sp.x}_${sp.y}`, () => {
          const icon = L.divIcon({
            className: '',
            html: `<div class="tm-spawn" style="--ring:${cr.color}">${img}</div>`,
            iconSize: [0, 0],
          })
          return L.marker(toLatLng(sp.x, sp.y), { icon }).bindPopup(
            `<div><div style="font-weight:700">${escapeHtml(cr.name)}</div>` +
              `<div style="opacity:.55;font-size:11px;margin:2px 0">${sp.x}, ${sp.y}, z${sp.z}</div>` +
              `<a href="/entry/${escapeHtml(cr.slug)}" style="color:var(--color-accent);font-size:11px;font-weight:700">${escapeHtml(t('map.viewEntry'))}</a></div>`,
          )
        })
      }
    }
    syncMarkers(
      grp,
      creatureCacheRef.current,
      `${f}|${creaturesRef.current.map((c) => c.slug + c.color).join(',')}`,
      wanted,
    )
  }

  // Re-draw creature spawn icons on creature/floor change.
  useEffect(() => {
    creaturesRef.current = creatures
    renderCreaturesRef.current()
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
      drawRouteLegs(grp, routePlan.legs, floor, t('map.floor'), floorLabel, setFloor)
      // Partial route: mark where the trail goes cold on its own floor.
      if (routePlan.partial && routePlan.partial.floor === floor) {
        grp.addLayer(
          L.marker(toLatLng(routePlan.partial.x, routePlan.partial.y), {
            icon: L.divIcon({
              className: '',
              html: `<div class="tm-route-stair is-lost">✕ ${escapeHtml(t('map.routeLostHere'))}</div>`,
              iconSize: [0, 0],
            }),
            interactive: false,
          }),
        )
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

  // Compute the built route's connecting legs whenever its points or connection
  // mode change. 'straight' synthesizes simple walk/floor-change legs instantly;
  // 'auto' routes each consecutive pair with the A* planner (falling back to a
  // straight hop for any pair the router can't connect).
  useEffect(() => {
    const pts = buildPoints
    if (pts.length < 2) {
      setBuildPlan(null)
      setBuildBusy(false)
      return
    }
    const straightHop = (a: RoutePoint, b: RoutePoint): Extract<RouteLeg, { kind: 'walk' }> => ({
      kind: 'walk',
      floor: a.floor,
      path: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
      tiles: Math.round(Math.hypot(b.x - a.x, b.y - a.y)),
    })
    if (buildConnect === 'straight') {
      const legs: RouteLeg[] = []
      let total = 0
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        if (a.floor === b.floor) {
          const leg = straightHop(a, b)
          legs.push(leg)
          total += leg.tiles
        } else {
          // A floor change between two waypoints: a badge on the origin floor.
          legs.push({ kind: 'stairs', from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y }, floor: a.floor, toFloor: b.floor, dir: b.floor < a.floor ? 'up' : 'down' })
        }
      }
      setBuildPlan({ legs, totalTiles: total })
      setBuildBusy(false)
      return
    }
    let cancelled = false
    setBuildBusy(true)
    ;(async () => {
      const legs: RouteLeg[] = []
      let total = 0
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        try {
          const plan = await planRoute({ x: a.x, y: a.y, floor: a.floor }, { x: b.x, y: b.y, floor: b.floor })
          if (plan) {
            legs.push(...plan.legs)
            total += plan.totalTiles
          } else {
            legs.push(straightHop(a, b))
          }
        } catch {
          legs.push(straightHop(a, b))
        }
      }
      if (!cancelled) {
        setBuildPlan({ legs, totalTiles: total })
        setBuildBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [buildPoints, buildConnect])

  // Draw the built route: its legs (shared renderer) plus numbered waypoint pins
  // on the floor in view.
  useEffect(() => {
    const grp = buildGroupRef.current
    if (!grp) return
    grp.clearLayers()
    if (buildPlan) drawRouteLegs(grp, buildPlan.legs, floor, t('map.floor'), floorLabel, setFloor)
    buildPoints.forEach((p, i) => {
      if (p.floor !== floor) return
      grp.addLayer(
        L.marker(toLatLng(p.x, p.y), {
          icon: L.divIcon({
            className: '',
            html: `<div class="tm-route-pin" style="--rp:#8a5a2b">${i + 1}</div>`,
            iconSize: [0, 0],
          }),
          interactive: false,
        }),
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildPoints, buildPlan, floor, mapReady])

  // Keep the shared link in sync with the built route.
  useEffect(() => {
    writeHash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildPoints, buildConnect, buildName])

  // Keep the placing cursor + ref in sync (route + builder modes also use it).
  useEffect(() => {
    placingRef.current = placing
    const c = mapRef.current?.getContainer()
    if (c) c.classList.toggle('tm-placing', placing || routeMode || buildMode)
  }, [placing, routeMode, buildMode])

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

  // --- item search (via the catalogue; items include drafts, so it hits the API
  // rather than the published-only glossary) ---
  const { data: itemResults } = useQuery({
    queryKey: ['map-item-search', debouncedQuery.trim().toLowerCase()],
    enabled: searchKind === 'item' && debouncedQuery.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<{ data: EntryListItem[] }>('/items', {
        params: { q: debouncedQuery.trim(), per_page: 8 },
      })
      return data.data
    },
  })

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

  // "¿Dónde farmeo este objeto?" — plot every creature that drops the item.
  // Its droppers come pre-resolved to slug/name/image; each is plotted through
  // addCreature so it gets the full toolkit (best-spawn jump, respawn switcher,
  // "how to get there"). Capped at PALETTE.length so the map doesn't flood.
  async function addItem(slug: string) {
    setQuery('')
    setSearchOpen(false)
    setItemBusy(true)
    try {
      const { data } = await api.get<{ data: ItemDetail }>(`/items/${slug}`)
      const it = data.data
      const droppers = it.dropped_by.filter((d): d is Dropper & { slug: string } => !!d.slug)
      const plotted = droppers.slice(0, PALETTE.length)
      setActiveItem({
        slug: it.slug,
        name: it.name ?? slug,
        image: it.image,
        plotted: plotted.map((d) => d.slug),
        total: droppers.length,
      })
      // Jump to the first dropper's densest spawn, then plot the rest quietly.
      if (plotted.length) {
        await addCreature(plotted[0].slug, true)
        await Promise.all(plotted.slice(1).map((d) => addCreature(d.slug, false)))
      }
    } catch {
      // leave the map as-is on failure
    } finally {
      setItemBusy(false)
    }
  }

  // Drop the item context and remove the creatures it plotted.
  function clearItem() {
    if (activeItem) for (const s of activeItem.plotted) removeCreature(s)
    setActiveItem(null)
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

  // A plotted creature's active spawn cluster as a route endpoint (its current
  // respawn if cycled, else the recommended best one).
  function routeEndForCreature(cr: ActiveCreature): RoutePoint | null {
    if (cr.clusters.length === 0) return null
    const cl = cr.clusters[cr.jumpIdx] ?? cr.clusters[0]
    return { x: cl.x, y: cl.y, floor: cl.z, label: cr.name }
  }

  // Set the route destination, compute the route if an origin is already
  // picked, and fly the map to it.
  function applyRouteEnd(pt: RoutePoint) {
    setRouteEnd(pt)
    setRoutePlan(null)
    setRouteMsg(null)
    const s = routeStartRef.current
    if (s) computeRouteRef.current(s, pt)
    floorRef.current = pt.floor
    setFloor(pt.floor)
    const map = mapRef.current
    if (map) map.setView(toLatLng(pt.x, pt.y), Math.max(map.getZoom(), 3))
  }

  // "Cómo llegar" from a plotted creature's active spawn cluster.
  function routeToSpawn(slug: string) {
    const cr = creaturesRef.current.find((c) => c.slug === slug)
    const pt = cr && routeEndForCreature(cr)
    if (!pt) return
    setRouteMode(true)
    applyRouteEnd(pt)
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

  const activeSlugs = useMemo(() => new Set(creatures.map((c) => c.slug)), [creatures])

  // "Boss Watch": the raid/world bosses ranked by spawn heat (likelihood of
  // being up right now / about to spawn). Powers both the ☠-mode strip and the
  // always-on right-edge boss rail, so it's fetched on every map view.
  // Plottable bosses (slug + sprite) sorted hottest first.
  const { data: bossWatch, isLoading: bossLoading } = useBosses('raid', 24)
  const bosses = useMemo(
    () =>
      (bossWatch ?? [])
        .filter((b): b is BossRow & { slug: string; image: string } => !!b.slug && !!b.image)
        .sort((a, b) => b.heat - a.heat || b.due - a.due),
    [bossWatch],
  )

  // Published community routes, most-loaded first. Only fetched once the gallery
  // is opened.
  const { data: communityRoutes, isLoading: routesLoading } = useQuery({
    queryKey: ['community-routes'],
    enabled: routesOpen,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<{ data: CommunityRoute[] }>('/routes')
      return data.data
    },
  })

  // Load a community route onto the map: drop it into the builder (so it renders
  // with pins + legs and can be tweaked/re-published), fly to its start, and bump
  // its load counter (the popularity signal).
  function loadCommunityRoute(r: CommunityRoute) {
    setRouteMode(false)
    setPlacing(false)
    setBuildMode(true)
    setBuildName(r.name)
    setBuildConnect(r.connect)
    setBuildPoints(r.waypoints.map(([x, y, floor]) => ({ x, y, floor })))
    setPublishState('idle')
    setRoutesOpen(false)
    const first = r.waypoints[0]
    if (first) {
      floorRef.current = first[2]
      setFloor(first[2])
      const map = mapRef.current
      if (map) map.setView(toLatLng(first[0], first[1]), Math.max(map.getZoom(), 3))
    }
    api.post(`/routes/${r.id}/view`).catch(() => {})
  }

  return (
    <div ref={rootRef} className="fixed inset-x-0 bottom-0 top-[var(--header-h,57px)] z-20 overflow-hidden bg-[#336699]">
      <Seo title={t('map.title')} description={t('map.intro')} path="/map" />
      <h1 className="sr-only">{t('map.title')}</h1>

      {/* The atlas fills the entire immersive canvas; every control floats over it. */}
      <div className="absolute inset-0 overflow-hidden">
        <div ref={containerRef} className="h-full w-full" style={{ background: '#336699' }} />
      </div>

      {/* Coordinate readout — bottom-left corner. */}
      <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] rounded border border-line bg-bg/85 px-2 py-1 font-mono text-[11px] tabular-nums text-fg-dim backdrop-blur-md">
        {center.x}, {center.y}, z{floor}
      </div>

      {/* Quick-launch mini windows — shortcuts to the games + stats, tucked into
          the bottom-right corner (above the attribution line). */}
      <div className="pointer-events-auto absolute bottom-9 right-2 z-[1000] flex flex-col items-end gap-1.5">
        {QUICK_LINKS.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            title={t(q.kicker)}
            className="group flex items-center gap-2 rounded-lg border border-line-2 bg-bg-2/90 px-2.5 py-1.5 shadow-lg backdrop-blur-md transition hover:-translate-x-0.5 hover:border-accent"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent transition group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={q.icon} />
            </svg>
            <span className="text-xs font-bold leading-none text-fg">{t(q.title)}</span>
          </Link>
        ))}
      </div>

      {/* Floor selector — pinned to the right edge, vertically centred. */}
      <div className="absolute right-2 top-1/2 z-[1000] flex max-h-[82vh] -translate-y-1/2 flex-col gap-1 overflow-y-auto rounded-md border border-line bg-bg/90 p-2 backdrop-blur-md">
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

      {/* World-boss watch — a vertical list down the left edge (the normal-mob
          rail is gone). Each boss shows its spawn "time"/status (heat bucket:
          likely up / maybe / just killed, plus %) and the worlds it applies to.
          Hottest first; always shown (skeletons while loading). Tapping plots the
          boss's location on the map. */}
      {(bossLoading || bosses.length > 0) && (
        <aside
          className="absolute bottom-10 left-2 z-[1000] flex w-[calc(100vw-1rem)] flex-col gap-0.5 overflow-y-auto overflow-x-hidden rounded-2xl border-2 border-line bg-bg-2/95 p-2 shadow-lg backdrop-blur-md transition-[max-width] duration-300 ease-in-out sm:left-3 sm:w-[calc(100vw-1.5rem)]"
          style={{ top: bossTop, maxWidth: bossRailOpen ? '28rem' : '5rem' }}
          aria-busy={bossLoading}
        >
          <div className={`flex items-center gap-1.5 px-1 pb-1 text-theory ${bossRailOpen ? '' : 'justify-center'}`}>
            {bossRailOpen && (
              <span className="flex min-w-0 items-center gap-1.5">
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12h.01M15 12h.01M8 20v2h8v-2M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20" />
                </svg>
                <span className="truncate text-[10px] font-bold uppercase tracking-widest">{t('map.bossWatch')}</span>
              </span>
            )}
            <button
              onClick={() => setBossRailOpen((v) => !v)}
              title={bossRailOpen ? t('map.modeHide') : t('map.bossWatch')}
              aria-label={bossRailOpen ? t('map.modeHide') : t('map.bossWatch')}
              aria-expanded={bossRailOpen}
              className={`grid h-6 w-6 shrink-0 place-items-center rounded text-fg-mute transition hover:bg-line/40 hover:text-fg ${bossRailOpen ? 'ml-auto' : ''}`}
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 transition-transform duration-300 ${bossRailOpen ? '' : 'rotate-180'}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          </div>
          {bosses.length > 0
            ? bosses.slice(0, 16).map((b) => {
                const hs = HEAT_STYLE[heatBucket(b.heat)]
                const on = activeSlugs.has(b.slug)
                const worlds = b.worlds.slice(0, 3).join(', ')
                const moreWorlds = b.worlds.length > 3 ? ` +${b.worlds.length - 3}` : ''
                return (
                  <button
                    key={b.slug}
                    onClick={() => (on ? removeCreature(b.slug) : addCreature(b.slug))}
                    title={`${b.race} · ${t(hs.label)} ${b.heat}%${b.worlds.length ? ` · ${b.worlds.join(', ')}` : ''}`}
                    className={`group flex w-full items-center gap-2 rounded-lg border px-1.5 py-1 text-left transition ${
                      on ? 'border-accent bg-accent/10' : 'border-transparent hover:border-line-2 hover:bg-bg-2/60'
                    } ${bossRailOpen ? '' : 'justify-center'}`}
                  >
                    <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded bg-line/15">
                      <img
                        src={b.image}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.visibility = 'hidden'
                        }}
                        className="sprite h-9 w-9 object-contain transition group-hover:scale-110"
                      />
                      <span
                        className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${
                          b.heat >= 66 ? 'bg-accent' : b.heat >= 33 ? 'bg-gold' : 'bg-interp'
                        }`}
                      />
                    </span>
                    {bossRailOpen && (
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-fg">{b.race}</span>
                        <span className={`flex items-center gap-1 text-[15px] font-bold ${hs.cls}`}>
                          <span aria-hidden>{hs.glyph}</span>
                          <span className="truncate">{t(hs.label)}</span>
                          <span className="tabular-nums opacity-70">{b.heat}%</span>
                        </span>
                        {b.worlds.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-fg-mute">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="9" />
                              <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
                            </svg>
                            <span className="truncate">
                              {worlds}
                              {moreWorlds}
                            </span>
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                )
              })
            : Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full shrink-0 rounded-lg" />
              ))}
        </aside>
      )}

      {/* Floating control layer — pinned to the top, translucent so the map reads
          through it. The outer wrapper ignores pointer events so the map stays
          draggable in the side gutters; the inner column re-enables them. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex flex-col p-2 pt-5 sm:p-3 sm:pt-7">
        <div ref={topColRef} className="pointer-events-none flex w-full max-w-md flex-col gap-2">

      {/* Search — the hero, pinned top-left. The action/layer hotbar lives at the
          bottom of the screen (see below). */}
      <div className="pointer-events-none flex flex-col gap-2">
        {/* Search pill — creature/item mode toggle + the search field */}
        <div className="pointer-events-auto flex w-full items-center gap-1.5 rounded-2xl border-2 border-line bg-bg-2/95 p-1 shadow-lg backdrop-blur-md transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          {/* Mode: creature spawns, or item droppers ("where does it drop?") */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-xl bg-bg/50 p-0.5">
            {(
              [
                { key: 'creature', type: 'creature', label: t('map.searchModeCreature') },
                { key: 'item', type: 'item', label: t('map.searchModeItem') },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setSearchKind(m.key)
                  setQuery('')
                  setSearchOpen(false)
                }}
                title={m.label}
                aria-label={m.label}
                aria-pressed={searchKind === m.key}
                className={`grid h-9 w-9 place-items-center rounded-lg transition ${
                  searchKind === m.key ? 'bg-accent text-white shadow-sm' : 'text-fg-mute hover:text-fg'
                }`}
              >
                <TypeIcon type={m.type} className="h-5 w-5" />
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
          <div className="relative">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-mute"
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
              placeholder={t(searchKind === 'item' ? 'map.searchItem' : 'map.searchCreature')}
              className="h-10 w-full rounded-xl bg-transparent pl-10 pr-3 text-base font-semibold text-fg outline-none placeholder:font-medium placeholder:text-fg-mute"
            />
          </div>
          {searchOpen && debouncedQuery.trim().length >= 2 && searchKind === 'creature' && searchResults && searchResults.length > 0 && (
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
          {searchOpen && debouncedQuery.trim().length >= 2 && searchKind === 'item' && itemResults && itemResults.length > 0 && (
            <ul className="absolute z-[1100] mt-2 max-h-80 w-full overflow-auto rounded-xl border-2 border-line bg-bg-2 py-1.5 shadow-2xl">
              {itemResults.map((r) => (
                <li key={r.slug}>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addItem(r.slug)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2"
                  >
                    {r.primary_image ? (
                      <img
                        src={r.primary_image}
                        alt=""
                        className="h-6 w-6 shrink-0 object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <TypeIcon type="item" className="h-4 w-4 shrink-0 text-fg-mute" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {r.name}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-mute">
                      {t('map.searchModeItem')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        </div>

        {/* Hotbar — grouped icon slots, pinned to the bottom-centre of the screen
            like a game action bar (fixed, so it escapes the top control column and
            anchors to the viewport). Tooltips name each action. */}
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1000] flex flex-wrap items-end justify-center gap-2 p-2 sm:p-3">
          {/* Navigate & plan routes */}
          <div className={PILL}>
            {/* Jump to a city (native select behind a slot icon) */}
            <div className={`relative ${SLOT} ${SLOT_OFF}`} title={t('map.goTo')}>
              <TypeIcon type="city" className="h-5 w-5" />
              <select
                value=""
                onChange={(e) => {
                  const l = LANDMARKS.find((x) => x.name === e.target.value)
                  if (l) goTo(l)
                }}
                aria-label={t('map.goTo')}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                <option value="">{t('map.goTo')}</option>
                {LANDMARKS.map((l) => (
                  <option key={l.name} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            <span className="mx-0.5 h-6 w-px bg-line/50" />

            {/* Directions */}
            <button
              onClick={() => {
                const next = !routeMode
                setRouteMode(next)
                resetRoute()
                if (next) {
                  setPlacing(false)
                  setBuildMode(false)
                  const cr = creaturesRef.current[0]
                  const pt = cr && routeEndForCreature(cr)
                  if (pt) applyRouteEnd(pt)
                }
              }}
              title={routeMode ? t('map.routeActive') : t('map.route')}
              aria-label={t('map.route')}
              aria-pressed={routeMode}
              className={`${SLOT} ${routeMode ? SLOT_ON : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11" />
              </svg>
            </button>

            {/* Community routes gallery */}
            <button
              onClick={() => setRoutesOpen((v) => !v)}
              title={t('map.routesGallery')}
              aria-label={t('map.routesGallery')}
              aria-pressed={routesOpen}
              className={`${SLOT} ${routesOpen ? SLOT_ON : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </button>

            {/* Build a route */}
            <button
              onClick={toggleBuildMode}
              title={t('map.buildRoute')}
              aria-label={t('map.buildRoute')}
              aria-pressed={buildMode}
              className={`${SLOT} ${buildMode ? SLOT_ON : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="19" r="2" />
                <circle cx="18" cy="5" r="2" />
                <path d="M8 17.5 16 6.5" strokeDasharray="2 3" />
              </svg>
            </button>

            <span className="mx-0.5 h-6 w-px bg-line/50" />

            {/* Add a marker */}
            <button
              onClick={() => {
                setPlacing((p) => !p)
                setRouteMode(false)
                setBuildMode(false)
              }}
              title={t('map.addMarker')}
              aria-label={t('map.addMarker')}
              aria-pressed={placing}
              className={`${SLOT} ${placing ? SLOT_ON : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
                <path d="M12 8v4M10 10h4" />
              </svg>
            </button>

            {/* Clear markers (with count) */}
            {markers.length > 0 && (
              <button
                onClick={() => setMarkers([])}
                title={`${t('map.clear')} (${markers.length})`}
                aria-label={`${t('map.clear')} (${markers.length})`}
                className={`relative ${SLOT} ${SLOT_OFF}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                </svg>
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {markers.length}
                </span>
              </button>
            )}

            {/* Share this view */}
            <button
              onClick={share}
              title={t('map.share')}
              aria-label={t('map.share')}
              className={`${SLOT} ${copied ? 'border-canon bg-canon/15 text-canon' : SLOT_OFF}`}
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

          {/* Layers — what's drawn on the atlas */}
          <div className={PILL}>
            {/* All creatures / hide */}
            <button
              onClick={() => {
                if (showAll && !bossOnly) setShowAll(false)
                else {
                  setShowAll(true)
                  setBossOnly(false)
                }
              }}
              title={t('map.modeAll')}
              aria-label={t('map.modeAll')}
              aria-pressed={showAll && !bossOnly}
              className={`${SLOT} ${showAll && !bossOnly ? SLOT_ON : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>

            {/* Bosses only */}
            <button
              onClick={() => {
                if (showAll && bossOnly) setBossOnly(false)
                else {
                  setShowAll(true)
                  setBossOnly(true)
                }
              }}
              title={t('map.bosses')}
              aria-label={t('map.bosses')}
              aria-pressed={showAll && bossOnly}
              className={`${SLOT} ${showAll && bossOnly ? 'border-theory bg-theory text-white' : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12h.01M15 12h.01M8 20v2h8v-2M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20" />
              </svg>
            </button>

            <span className="mx-0.5 h-6 w-px bg-line/50" />

            {/* Imported client markers (points of interest) */}
            <button
              onClick={() => setShowPoi((v) => !v)}
              title={t('map.markersLayer')}
              aria-label={t('map.markersLayer')}
              aria-pressed={showPoi}
              className={`${SLOT} ${showPoi ? 'border-interp bg-interp/15 text-interp' : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <path d="M4 22v-7" />
              </svg>
            </button>

            {/* Refine filters */}
            <button
              onClick={() => setShowFilters((v) => !v)}
              title={t('map.filters')}
              aria-label={t('map.filters')}
              aria-pressed={showFilters}
              className={`relative ${SLOT} ${showFilters || activeFilterCount ? SLOT_ON : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              {activeFilterCount > 0 && (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {showAll && (
              <span
                className="px-1.5 text-sm font-bold tabular-nums text-fg-dim"
                title={t('map.spawnsShown')}
              >
                {shownCount.toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Community routes gallery — published routes others submitted, most
          popular (most-loaded) first; clicking one loads it onto the map. */}
      {routesOpen && (
        <div className="pointer-events-auto rounded-xl border border-line bg-bg-2/95 px-3 py-2.5 shadow-lg backdrop-blur-md">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-accent">
              {t('map.routesGallery')}
            </span>
            <span className="text-xs text-fg-mute">{t('map.routesGalleryHint')}</span>
          </div>
          {routesLoading ? (
            <p className="py-2 text-sm text-fg-mute">{t('map.routesLoading')}</p>
          ) : communityRoutes && communityRoutes.length > 0 ? (
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {communityRoutes.map((r) => (
                <button
                  key={r.id}
                  onClick={() => loadCommunityRoute(r)}
                  className="flex items-center gap-3 rounded-lg border border-line bg-bg-2 px-3 py-2 text-left transition hover:border-accent hover:bg-accent/5"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="19" r="2" />
                    <circle cx="18" cy="5" r="2" />
                    <path d="M8 17.5 16 6.5" strokeDasharray="2 3" />
                  </svg>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-fg">{r.name}</span>
                    <span className="block truncate text-xs text-fg-mute">
                      {t('map.buildPoints', { count: r.waypoints.length })}
                      {' · '}
                      {r.connect === 'auto' ? t('map.buildAuto') : t('map.buildStraight')}
                      {r.author ? ` · ${r.author}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-bold tabular-nums text-fg-dim">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    {r.views}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="py-2 text-sm text-fg-mute">{t('map.routesEmpty')}</p>
          )}
        </div>
      )}

      {/* Item context banner — explains why a batch of creatures got plotted
          ("where does this item drop?") and clears them all in one click. */}
      {(activeItem || itemBusy) && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2.5 rounded-xl border border-interp/40 bg-bg-2/95 px-3 py-2 text-sm shadow-lg backdrop-blur-md">
          {itemBusy && !activeItem ? (
            <span className="font-semibold text-fg-dim">{t('map.itemLoading')}</span>
          ) : activeItem ? (
            <>
              {activeItem.image && (
                <img src={activeItem.image} alt="" loading="lazy" className="sprite h-8 w-8 object-contain" />
              )}
              <span className="font-bold text-fg">{activeItem.name}</span>
              <span className="text-fg-dim">
                {activeItem.total === 0
                  ? t('map.itemNoDroppers')
                  : t('map.itemDropsFrom', { count: activeItem.plotted.length })}
              </span>
              {activeItem.total > activeItem.plotted.length && (
                <span className="rounded-[2px] border border-line bg-bg-2 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-fg-mute">
                  +{activeItem.total - activeItem.plotted.length} {t('map.itemMore')}
                </span>
              )}
              <button
                onClick={clearItem}
                className="ml-auto text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-accent"
              >
                ✕ {t('map.itemClear')}
              </button>
            </>
          ) : null}
        </div>
      )}

      {/* Active creature bar — right under the search so the respawn switcher
          (◀ 1/4 ▶) is immediately visible after plotting a creature. */}
      {creatures.length > 0 && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {creatures.map((cr) => (
            <div
              key={cr.slug}
              className="flex items-center gap-2.5 rounded-xl border-2 bg-bg-2 py-1.5 pl-2 pr-2 shadow-sm"
              style={{ borderColor: cr.color }}
            >
              {cr.image && (
                <img src={cr.image} alt="" loading="lazy" className="sprite h-8 w-8 object-contain" />
              )}
              <span className="text-sm font-bold text-fg sm:text-base">{cr.name}</span>
              <span className="text-xs font-semibold tabular-nums text-fg-mute">
                {spawnsOnFloor(cr)}/{cr.spawns.length}
              </span>
              {cr.clusters.length > 0 && (
                <button
                  onClick={() => jumpToBest(cr.slug)}
                  className="flex items-center gap-1 rounded-lg bg-accent/15 px-2 py-1.5 text-xs font-bold text-accent transition hover:bg-accent/25"
                  title={t('map.bestSpawn')}
                >
                  <span aria-hidden>⭐</span>
                  <span className="tabular-nums">{cr.clusters[0].count}×</span>
                  <span className="text-accent/70">z{cr.clusters[0].z}</span>
                </button>
              )}
              {cr.clusters.length > 0 && (
                <div className="flex items-center gap-0.5 rounded-lg border border-line bg-bg p-0.5">
                  <button
                    onClick={() => cycleSpawn(cr.slug, -1)}
                    disabled={cr.clusters.length < 2}
                    className="grid h-8 w-8 place-items-center rounded-md text-sm text-fg-dim transition hover:bg-line/50 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
                    title={t('map.prevSpawn')}
                    aria-label={t('map.prevSpawn')}
                  >
                    ◀
                  </button>
                  <span className="px-1 text-center leading-tight" title={t('map.spawnAreas')}>
                    <span className="block text-[9px] font-bold uppercase tracking-widest text-fg-mute">
                      {t('map.respawn')}
                    </span>
                    <span className="block text-xs font-bold tabular-nums text-fg">
                      {cr.jumpIdx + 1}/{cr.clusters.length}
                    </span>
                  </span>
                  <button
                    onClick={() => cycleSpawn(cr.slug, 1)}
                    disabled={cr.clusters.length < 2}
                    className="grid h-8 w-8 place-items-center rounded-md text-sm text-fg-dim transition hover:bg-line/50 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
                    title={t('map.nextSpawn')}
                    aria-label={t('map.nextSpawn')}
                  >
                    ▶
                  </button>
                </div>
              )}
              {cr.clusters.length > 0 && (
                <button
                  onClick={() => routeToSpawn(cr.slug)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-sm text-fg-mute transition hover:bg-accent/10 hover:text-accent"
                  title={t('map.routeToSpawn')}
                  aria-label={t('map.routeToSpawn')}
                >
                  🧭
                </button>
              )}
              <button
                onClick={() => removeCreature(cr.slug)}
                className="grid h-8 w-8 place-items-center rounded-lg text-sm text-fg-mute transition hover:bg-accent/10 hover:text-accent"
                title={t('map.delete')}
                aria-label={t('map.delete')}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Directions bar — origin/destination pickers (city dropdown or map click).
          Quiet paper inset like the layer panel below, so it blends with the page
          instead of reading as a brighter plate. */}
      {routeMode && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-bg-2/95 px-3 py-2.5 shadow-lg backdrop-blur-md text-sm">
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
              {routeStart && !isLandmark(routeStart) && (
                <option value="__pt__">{routeStart.label ?? t('map.routePoint')}</option>
              )}
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
              {routeEnd && !isLandmark(routeEnd) && (
                <option value="__pt__">{routeEnd.label ?? t('map.routePoint')}</option>
              )}
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
                  ...(tools.has('levitate') ? [t('map.routeNeedLevitate')] : []),
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
                        {leg.tool === 'rope' ? <Icon name="rope" /> : leg.tool === 'shovel' ? <Icon name="pickaxe" /> : leg.tool === 'levitate' ? <Icon name="sparkles" /> : leg.dir === 'down' ? '▼' : leg.dir === 'up' ? '▲' : '⇄'}
                      </span>
                      {leg.tool === 'rope'
                        ? t('map.routeRope', { floor: floorLabel(leg.toFloor) })
                        : leg.tool === 'shovel'
                          ? t('map.routeShovel', { floor: floorLabel(leg.toFloor) })
                          : leg.tool === 'levitate'
                            ? t('map.routeLevitate', { floor: floorLabel(leg.toFloor) })
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

      {/* Route builder bar — name, connection style, and the point count / actions.
          Clicking the map appends ordered waypoints. */}
      {buildMode && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-bg-2/95 px-3 py-2.5 shadow-lg backdrop-blur-md text-sm">
          <input
            value={buildName}
            onChange={(e) => setBuildName(e.target.value)}
            placeholder={t('map.buildNamePlaceholder')}
            className="h-9 min-w-[160px] flex-1 rounded-lg border border-line bg-bg-2 px-3 text-sm font-semibold text-fg outline-none transition placeholder:font-medium placeholder:text-fg-mute hover:border-line-2 focus:border-accent"
          />

          {/* Connection style: auto-route between points, or straight lines */}
          <div className="inline-flex shrink-0 rounded-lg border border-line bg-bg p-1">
            {(
              [
                { key: 'auto', label: t('map.buildAuto') },
                { key: 'straight', label: t('map.buildStraight') },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                onClick={() => setBuildConnect(m.key)}
                className={`rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wider transition ${
                  buildConnect === m.key ? 'bg-accent text-white' : 'text-fg-mute hover:text-fg'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <span className="flex items-center gap-2 text-fg-dim">
            {buildBusy ? t('map.buildBusy') : t('map.buildPoints', { count: buildPoints.length })}
            {buildPlan && buildPlan.totalTiles > 0 && !buildBusy && (
              <span className="rounded-[2px] border border-line bg-bg-2 px-2 py-0.5 font-bold tabular-nums text-fg">
                {buildPlan.totalTiles.toLocaleString()} {t('map.routeDist')}
              </span>
            )}
          </span>

          {buildPoints.length > 0 ? (
            <>
              <button
                onClick={publishRoute}
                disabled={!buildName.trim() || publishState === 'sending' || publishState === 'done'}
                title={!buildName.trim() ? t('map.buildPublishNeedName') : t('map.buildPublish')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  publishState === 'done'
                    ? 'bg-canon/15 text-canon'
                    : publishState === 'error'
                      ? 'bg-accent/15 text-accent'
                      : 'bg-accent text-white hover:bg-accent-2'
                }`}
              >
                {publishState === 'sending'
                  ? t('map.buildPublishing')
                  : publishState === 'done'
                    ? `✓ ${t('map.buildPublished')}`
                    : publishState === 'error'
                      ? t('map.buildPublishError')
                      : t('map.buildPublish')}
              </button>
              <button
                onClick={undoBuildPoint}
                className="text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-fg"
              >
                ↶ {t('map.buildUndo')}
              </button>
              <button
                onClick={share}
                className="text-xs font-bold uppercase tracking-wider text-accent transition hover:text-accent-2"
              >
                {copied ? t('map.copied') : t('map.share')}
              </button>
              <button
                onClick={clearBuild}
                className="ml-auto text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-accent"
              >
                ✕ {t('map.buildClear')}
              </button>
            </>
          ) : (
            <span className="ml-auto text-fg-mute">{t('map.buildHint')}</span>
          )}
        </div>
      )}

      {/* Collapsible refine panel — hidden until "Filtros" is opened, so it
          doesn't take a permanent row above the map. */}
      {showFilters && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg-2/95 px-3 py-2.5 shadow-lg backdrop-blur-md">
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

        </div>
      </div>

      {/* Imported-marker category legend — floats along the bottom when the layer is on */}
      {showPoi && (
        <div className="pointer-events-auto absolute bottom-20 left-1/2 z-[1000] flex max-w-[94vw] -translate-x-1/2 flex-wrap items-center justify-center gap-x-4 gap-y-2 overflow-x-auto rounded-xl border border-line bg-bg/85 px-3 py-2 text-xs font-semibold text-fg-dim backdrop-blur-md">
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

      <p className="pointer-events-none absolute bottom-2 right-2 z-[1000] max-w-[42vw] text-right text-[10px] leading-tight text-fg-mute/70">
        {t('map.disclaimer')}
      </p>

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
