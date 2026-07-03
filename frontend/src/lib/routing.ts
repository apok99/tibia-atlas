// Real "how to get there" routing over the Tibia map — moves like the client's
// map-click auto-walk.
//
// Walkability is the CLIENT'S own pathfinding data (Minimap_WaypointCost export),
// with the OTBM game-rule bake as fallback for unexplored tiles (see
// tools/otbm/bake-walk.mjs). Each floor ships a gzipped 1-byte-per-tile grid at
// public/walk/f<z>.bin: 0 = you cannot stand there, otherwise the tile's walking
// cost (≈55 fast road … 233 rough ground). Water and walls are hard 0s, so a
// route can NEVER cross them — the search either finds a clean path or reports
// none; the cost weights make it prefer real roads. Floors are linked only by
// real stairs / holes / ladders / teleports (public/floor-links.json), and
// separate landmasses by NPC boats. No soft walls, no colour guessing, no
// "approximate" fallback.

const X_MIN = 31744
const X_MAX = 34304 // exclusive edge
const Y_MIN = 30976
const Y_MAX = 33024 // exclusive edge

export const ROUTE_X_MIN = X_MIN
export const ROUTE_Y_MIN = Y_MIN
export const ROUTE_W = X_MAX - X_MIN // 2560
export const ROUTE_H = Y_MAX - Y_MIN // 2048

export type FloorGrid = { grid: Uint8Array; W: number; H: number }
export type Pt = { x: number; y: number }

// A tile is walkable when its grid byte is non-zero (the byte is the client's
// walking cost). Zero (water, wall, void) is blocked — hard, no exceptions.
const passable = (v: number) => v > 0

const cache = new Map<number, Promise<FloorGrid>>()

// Load a floor's walkability bitmap (gzipped, 1 byte/tile). Missing floors → all
// blocked. The file is gzip-compressed but named .bin so no server auto-inflates
// it (Content-Encoding); we inflate manually for consistent dev/prod.
export function buildFloorGrid(floor: number): Promise<FloorGrid> {
  const hit = cache.get(floor)
  if (hit) return hit
  const p = (async (): Promise<FloorGrid> => {
    const W = ROUTE_W
    const H = ROUTE_H
    try {
      // no-cache = always revalidate with the server (304 when unchanged), so a
      // regenerated bake is picked up on reload instead of a stale heuristic-cached
      // copy — routes computed on old data are exactly the "crosses walls" bug.
      const res = await fetch(`/walk/f${floor}.bin`, { cache: 'no-cache' })
      if (res.ok && res.body) {
        const stream = res.body.pipeThrough(new DecompressionStream('gzip'))
        const buf = await new Response(stream).arrayBuffer()
        const grid = new Uint8Array(buf)
        if (grid.length === W * H) return { grid, W, H }
      }
    } catch {
      /* fall through to all-blocked */
    }
    return { grid: new Uint8Array(W * H), W, H }
  })()
  cache.set(floor, p)
  return p
}

const idxOf = (fg: FloorGrid, gx: number, gy: number) => gy * fg.W + gx

// A click (or a landmark centre) can land on a wall/water/roof pixel; nudge it to
// the closest walkable tile within `maxR` (expanding-ring search) so routing still
// starts/ends somewhere sensible. Returns grid coords, or null if nothing walkable
// is near.
function snapToWalkable(
  fg: FloorGrid,
  gx: number,
  gy: number,
  maxR = 24,
): { gx: number; gy: number } | null {
  if (gx < 0 || gx >= fg.W || gy < 0 || gy >= fg.H) return null
  if (passable(fg.grid[idxOf(fg, gx, gy)])) return { gx, gy }
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const ny = gy + dy
      if (ny < 0 || ny >= fg.H) continue
      const edge = Math.abs(dy) === r
      for (let dx = -r; dx <= r; dx++) {
        if (!edge && Math.abs(dx) !== r) continue // ring perimeter only
        const nx = gx + dx
        if (nx < 0 || nx >= fg.W) continue
        if (passable(fg.grid[idxOf(fg, nx, ny)])) return { gx: nx, gy: ny }
      }
    }
  }
  return null
}

// Minimal binary min-heap keyed by an external fScore array.
class Heap {
  private a: number[] = []
  private f: Float64Array
  constructor(f: Float64Array) {
    this.f = f
  }
  get size() {
    return this.a.length
  }
  push(v: number) {
    const a = this.a
    a.push(v)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.f[a[p]] <= this.f[a[i]]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): number {
    const a = this.a
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      const n = a.length
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < n && this.f[a[l]] < this.f[a[s]]) s = l
        if (r < n && this.f[a[r]] < this.f[a[s]]) s = r
        if (s === i) break
        ;[a[s], a[i]] = [a[i], a[s]]
        i = s
      }
    }
    return top
  }
}

const SQRT2 = Math.SQRT2
// Safety cap so a hopeless search (target walled off) can't hang the tab.
const MAX_POPS = 3_000_000

// A* on the floor's walkability grid. 8-directional, terrain-weighted: every step
// costs its geometric length (1 orthogonal, √2 diagonal) scaled by the target
// tile's client walk-cost (≈0.55 fast road … 2.33 rough ground), so routes follow
// the same roads the game's own auto-walk picks. `start`/`goal` are world coords;
// returns world-coord waypoints (collinear points removed) or null if unreachable
// within this floor.
export function findPath(fg: FloorGrid, start: Pt, goal: Pt): Pt[] | null {
  const sSnap = snapToWalkable(fg, start.x - X_MIN, start.y - Y_MIN)
  const gSnap = snapToWalkable(fg, goal.x - X_MIN, goal.y - Y_MIN)
  if (!sSnap || !gSnap) return null

  const { grid, W, H } = fg
  const N = W * H
  const sIdx = sSnap.gy * W + sSnap.gx
  const gIdx = gSnap.gy * W + gSnap.gx
  if (sIdx === gIdx) return [worldOf(sSnap.gx, sSnap.gy)]

  const gScore = new Float64Array(N).fill(Infinity)
  const fScore = new Float64Array(N).fill(Infinity)
  const came = new Int32Array(N).fill(-1)
  const closed = new Uint8Array(N)

  const ggx = gSnap.gx
  const ggy = gSnap.gy
  // Octile distance, mildly weighted so the search stays directed (fast). With
  // terrain weights in play (typical road ≈ 1.0/step) this stays close enough to
  // admissible that path quality doesn't visibly suffer.
  const HEUR_WEIGHT = 1.3
  const heur = (gx: number, gy: number) => {
    const dx = Math.abs(gx - ggx)
    const dy = Math.abs(gy - ggy)
    return (dx + dy + (SQRT2 - 2) * Math.min(dx, dy)) * HEUR_WEIGHT
  }

  gScore[sIdx] = 0
  fScore[sIdx] = heur(sSnap.gx, sSnap.gy)
  const open = new Heap(fScore)
  open.push(sIdx)

  let pops = 0
  while (open.size) {
    const cur = open.pop()
    if (cur === gIdx) return reconstruct(came, cur, W)
    if (closed[cur]) continue
    closed[cur] = 1
    if (++pops > MAX_POPS) return null

    const cx = cur % W
    const cy = (cur - cx) / W
    const cg = gScore[cur]

    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy
      if (ny < 0 || ny >= H) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = cx + dx
        if (nx < 0 || nx >= W) continue
        const nIdx = ny * W + nx
        if (!passable(grid[nIdx]) || closed[nIdx]) continue
        // NB: no corner-cutting guard. Tibia allows diagonal steps between two
        // blocked tiles, and narrow paths/doorways on the map frequently connect
        // only diagonally — forbidding it severs real routes (e.g. Carlin↔Thais,
        // which link through diagonal chokepoints).
        const step = (dx !== 0 && dy !== 0 ? SQRT2 : 1) * (grid[nIdx] / 100)
        const tentative = cg + step
        if (tentative < gScore[nIdx]) {
          came[nIdx] = cur
          gScore[nIdx] = tentative
          fScore[nIdx] = tentative + heur(nx, ny)
          open.push(nIdx)
        }
      }
    }
  }
  return null
}

const worldOf = (gx: number, gy: number): Pt => ({ x: gx + X_MIN, y: gy + Y_MIN })

// Walk the came-from chain back to the start, then drop interior points that lie
// on the same straight run so the drawn polyline stays light.
function reconstruct(came: Int32Array, end: number, W: number): Pt[] {
  const cells: number[] = []
  let c = end
  while (c !== -1) {
    cells.push(c)
    c = came[c]
  }
  cells.reverse()
  const pts: Pt[] = []
  let pdx = 0
  let pdy = 0
  for (let i = 0; i < cells.length; i++) {
    const gx = cells[i] % W
    const gy = (cells[i] - gx) / W
    if (i > 0 && i < cells.length - 1) {
      const px = cells[i - 1] % W
      const py = (cells[i - 1] - px) / W
      const dx = Math.sign(gx - px)
      const dy = Math.sign(gy - py)
      if (dx === pdx && dy === pdy) {
        pdx = dx
        pdy = dy
        continue // still going the same direction — skip this point
      }
      pdx = dx
      pdy = dy
    }
    pts.push(worldOf(gx, gy))
  }
  return pts
}

const tilesOf = (path: Pt[]): number => {
  let d = 0
  for (let i = 1; i < path.length; i++) {
    d += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  }
  return Math.round(d)
}

// --- Multi-modal routing (walk + stairs + boat) ------------------------------
//
// Foot routing only connects places on the same walkable landmass/floor. Tibia's
// floors are joined by real stairs/holes/ladders/teleports and its separate
// continents/islands by NPC ships, so the planner searches across all of them.

// NPC transport is modelled as LINES, each a clique of named stops (a stop can
// sit on any floor — the Kazordoon steamboat docks underground). The main "Barco"
// line joins every big-city harbour (in the game nearly every harbour reaches
// every other directly or with one cheap transfer); local lines are the real
// point-to-point ferries, ice sleds and magic carpets whose dock coordinates come
// from the imported client map markers. Stops are snapped onto walkable ground at
// load; a stop that fails to snap is silently skipped.
type FerryLineDef = { name: string; icon: string; stops: { name: string; x: number; y: number; floor?: number }[] }
const FERRY_LINES: FerryLineDef[] = [
  {
    name: 'Barco',
    icon: 'sailboat',
    stops: [
      { name: "Ab'Dendriel", x: 32665, y: 31652 },
      { name: 'Ankrahmun', x: 33146, y: 32816 },
      { name: 'Carlin', x: 32343, y: 31792 },
      { name: 'Cormaya', x: 33307, y: 31999 },
      { name: 'Darashia', x: 33213, y: 32453 },
      { name: 'Edron', x: 33211, y: 31830 },
      { name: 'Farmine', x: 33030, y: 31500 },
      { name: 'Krailos', x: 33580, y: 31584 },
      { name: 'Liberty Bay', x: 32309, y: 32794 },
      { name: 'Oramond', x: 33607, y: 31955 },
      { name: 'Port Hope', x: 32629, y: 32769 },
      { name: 'Rookgaard', x: 32097, y: 32219 },
      { name: 'Roshamuul', x: 33524, y: 32477 },
      { name: 'Svargrond', x: 32278, y: 31146 },
      { name: 'Thais', x: 32365, y: 32224 },
      { name: 'Venore', x: 32947, y: 32081 },
      { name: 'Yalahar', x: 32805, y: 31234 },
    ],
  },
  // Buddel's raft between Svargrond's hunting islands (dock coords = his map markers).
  {
    name: 'Buddel',
    icon: 'sailboat',
    stops: [
      { name: 'Svargrond', x: 32333, y: 31227 },
      { name: 'Grimlund', x: 32021, y: 31294 },
      { name: 'Okolnir', x: 32224, y: 31382 },
      { name: 'Hrodmir', x: 32256, y: 31197 },
      { name: 'Tyrsung', x: 32464, y: 31173 },
    ],
  },
  // Ice passages / dog sled between Svargrond's coast, Nibelor and Inukaya.
  {
    name: 'Trineo',
    icon: 'snowflake',
    stops: [
      { name: 'Svargrond', x: 32410, y: 31066 },
      { name: 'Nibelor', x: 32327, y: 31044 },
      { name: 'Nibelor sur', x: 32301, y: 31083 },
      { name: 'Inukaya', x: 32367, y: 31058 },
    ],
  },
  { name: 'Ferry', icon: 'sailboat', stops: [{ name: 'Carlin', x: 32211, y: 31756 }, { name: 'Isle of the Kings', x: 32126, y: 31665 }] },
  {
    name: 'Islas nórdicas',
    icon: 'sailboat',
    stops: [
      { name: 'Costa de Carlin', x: 32235, y: 31674 },
      { name: 'Folda', x: 32045, y: 31579 },
      { name: 'Senja', x: 32020, y: 31692 },
      { name: 'Vega', x: 31974, y: 31901 },
    ],
  },
  { name: 'Barca', icon: 'sailboat', stops: [{ name: 'Yalahar', x: 32837, y: 31365 }, { name: 'Vengoth', x: 32857, y: 31549 }] },
  { name: 'Barca', icon: 'sailboat', stops: [{ name: 'Edron', x: 33304, y: 31720 }, { name: 'Grimvale', x: 33333, y: 31690 }] },
  { name: 'Barca', icon: 'sailboat', stops: [{ name: 'Zao', x: 33345, y: 31349 }, { name: 'Isla norte', x: 33373, y: 31309 }] },
  { name: 'Barca', icon: 'sailboat', stops: [{ name: 'Liberty Bay', x: 32347, y: 32858 }, { name: 'Meriana', x: 32132, y: 32912 }] },
  // Marapur (Moonfall): its "To Port Hope" dock marker pairs with Port Hope's harbour.
  { name: 'Barca', icon: 'sailboat', stops: [{ name: 'Port Hope', x: 32629, y: 32769 }, { name: 'Marapur', x: 33842, y: 32852 }] },
  // Kazordoon steamboat: Cormaya harbour ↔ the underground mountain lake docks.
  {
    name: 'Vapor',
    icon: 'ship',
    stops: [
      { name: 'Cormaya', x: 33309, y: 31996 },
      { name: 'Kazordoon minas', x: 32526, y: 32037, floor: 14 },
      { name: 'Kazordoon', x: 32555, y: 32068, floor: 10 },
    ],
  },
  // Magic carpet network (tower entrances).
  {
    name: 'Alfombra',
    icon: 'sparkles',
    stops: [
      { name: 'Femor Hills', x: 32512, y: 31839 },
      { name: 'Edron', x: 33215, y: 31784 },
      { name: 'Darashia', x: 33265, y: 32441 },
      { name: 'Issavi', x: 33946, y: 31516 },
    ],
  },
  // Quest-gated wall passages, curated one by one. The Zao tunnel (f8, under the
  // steppe divide) is THE canonical way into northern Zao / Razachai — its
  // "zaoan wall" row opens with the Wrath of the Emperor quest, and the id is
  // the ordinary Razachai wall so it can't be whitelisted item-wide. Shown as an
  // explicit door hop so the player knows a quest gate sits there.
  {
    name: 'Puerta de quest',
    icon: 'door',
    stops: [
      { name: 'Túnel de Zao (sur)', x: 33172, y: 31288, floor: 8 },
      { name: 'Túnel de Zao (norte)', x: 33172, y: 31284, floor: 8 },
    ],
  },
  // Razachai's south wall gate (same quest-gated zaoan wall row as the tunnel).
  {
    name: 'Puerta de quest',
    icon: 'door',
    stops: [
      { name: 'Razachai (fuera)', x: 33074, y: 31126 },
      { name: 'Razachai (dentro)', x: 33074, y: 31122 },
    ],
  },
  // Zzaion's inner gate (the Lizard Gate Guardian's post).
  {
    name: 'Puerta de quest',
    icon: 'door',
    stops: [
      { name: 'Zzaion (norte)', x: 33262, y: 31094 },
      { name: 'Zzaion (sur)', x: 33262, y: 31108 },
    ],
  },
  // Quest PORTALS into otherwise unreachable planes, curated from the map's own
  // teleport rows (t=2 is excluded from generic routing, but these specific pairs
  // are the canonical hunted-zone entrances — shown as an explicit portal hop).
  // Soul War: Graveyard of the Damned (under Thais graveyard) → Zarganash.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Graveyard of the Damned', x: 32345, y: 32168, floor: 12 },
      { name: 'Zarganash', x: 33456, y: 31499, floor: 13 },
    ],
  },
  // Otherworld (Grey Beach): entered via Spectulus' lab portal in Edron.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Edron (laboratorio)', x: 33217, y: 31814 },
      { name: 'Grey Beach (Otherworld)', x: 32160, y: 31296 },
    ],
  },
  // Roshamuul Prison: the map's own entry teleport under western Roshamuul.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Roshamuul (bajo el puente)', x: 33297, y: 32403, floor: 14 },
      { name: 'Prisión de Roshamuul', x: 33464, y: 32799, floor: 8 },
    ],
  },
  // Demon Forge access pair east of Edron (f6 shrine ↔ f9 halls).
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Santuario (este de Edron)', x: 33602, y: 31888, floor: 6 },
      { name: 'Demon Forge', x: 33532, y: 31820, floor: 9 },
    ],
  },
  // Deep Otherworld: the map's portal hub (under Elvenbane) → the f11 halls where
  // the breach broods / sparkions / reality reavers roam.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Portal (bajo Elvenbane)', x: 32663, y: 31820, floor: 10 },
      { name: 'Otherworld (profundo)', x: 32089, y: 31453, floor: 11 },
    ],
  },
]
// Line icons are ICON_INNER names from lib/icons.tsx (rendered via <Icon>/iconMarkup).
type FerryStop = { line: number; lineName: string; icon: string; name: string; x: number; y: number; floor: number }

export type RouteLeg =
  | { kind: 'walk'; floor: number; path: Pt[]; tiles: number }
  | {
      kind: 'boat'
      from: Pt
      to: Pt
      fromName: string
      toName: string
      fromFloor: number
      toFloor: number
      lineName: string
      icon: string
    }
  | {
      kind: 'stairs'
      from: Pt
      to: Pt
      floor: number
      toFloor: number
      dir: 'up' | 'down' | 'teleport'
      tool?: 'rope' | 'shovel'
    }
export type RoutePlan = { legs: RouteLeg[]; totalTiles: number }

// --- Floor-change links (stairs / holes / ladders / teleports) ---------------
// Baked offline into public/floor-links.json as compact rows
//   [x, y, z, dx, dy, dz, t]   t: 0 = down hole, 1 = up stairs/ladder, 2 = teleport
// The bake step already validated every row: origins are floor-change tiles
// (walkable by construction) and destinations are guaranteed walkable (nudged ≤2
// tiles at bake time, rows landing in solid rock dropped). So the router trusts
// link coordinates verbatim — no big runtime snapping, which used to leap through
// walls and invent connections.
// Each row becomes a directed transport edge. Stairs and ladders are physically
// two-way, so a t=1 row also yields the reverse (down) edge — this is what lets
// the search descend a staircase you'd otherwise only know how to climb, and is
// what finally connects deep multi-floor targets (e.g. the grim reaper room).
// Holes (you fall, then rope back up) and teleports stay one-way.
// Link kinds baked into floor-links.json:
//   t=0 down (holes, trapdoors, grates), t=1 up (stairs/ladders, two-way),
//   t=2 teleport (EXCLUDED, see below), t=3 rope spot (up, needs a rope),
//   t=4 stone pile (down, needs a shovel).
type TEdge = {
  sx: number
  sy: number
  toFloor: number
  tx: number
  ty: number
  dir: 'up' | 'down' | 'teleport'
  tool?: 'rope' | 'shovel'
}
let edgesByFloor: Map<number, TEdge[]> | null = null
let linksPromise: Promise<void> | null = null
function loadLinks(): Promise<void> {
  if (edgesByFloor) return Promise.resolve()
  if (linksPromise) return linksPromise
  linksPromise = (async () => {
    const res = await fetch('/floor-links.json', { cache: 'no-cache' })
    const raw: number[][] = await res.json()
    const m = new Map<number, TEdge[]>()
    const add = (floor: number, e: TEdge) => {
      let a = m.get(floor)
      if (!a) {
        a = []
        m.set(floor, a)
      }
      a.push(e)
    }
    // Quest PLANES: self-contained hunted zones stitched together internally by
    // scripted teleports (Zarganash has 23 of them). Teleports whose BOTH ends
    // fall inside the same plane are kept, so the inside of the plane routes —
    // the way IN remains the curated 'Portal de quest' line. Everywhere else
    // teleports stay excluded (they'd create absurd quest-chain routes).
    const QUEST_PLANES: [number, number, number, number, number, number][] = [
      // [x0, x1, y0, y1, zMin, zMax]
      [33380, 33810, 31140, 31520, 8, 15], // Zarganash (east, incl. northern halls)
      [31890, 32060, 32240, 32390, 8, 15], // Zarganash (west annex)
      [32020, 32220, 31240, 31500, 4, 15], // Otherworld / Grey Beach + descent chain
      [33280, 33560, 32390, 32860, 8, 15], // Roshamuul Prison + its antechamber
      [33440, 33660, 31600, 31940, 6, 15], // Demon Forge halls east of Edron
    ]
    const planeOf = (x: number, y: number, z: number) =>
      QUEST_PLANES.findIndex(([x0, x1, y0, y1, z0, z1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1)
    for (const [x, y, z, dx, dy, dz, t] of raw) {
      // Teleports (t=2) are EXCLUDED from routing: in this map they're almost all
      // quest/event mechanics (Demon Helmet chain, boss rooms, warzone gates) —
      // technically real, but "take a boat to Darashia, climb the mountain and use
      // the quest teleport" is never the answer a map should give. Quest-locked
      // areas honestly report "no route" instead. Exception: intra-plane teleports
      // (see QUEST_PLANES above).
      if (t === 2) {
        const pa = planeOf(x, y, z)
        if (pa < 0 || pa !== planeOf(dx, dy, dz)) continue
        add(z, { sx: x, sy: y, toFloor: dz, tx: dx, ty: dy, dir: 'teleport' })
        continue
      }
      const dir = t === 0 || t === 4 ? 'down' : 'up'
      const tool = t === 3 ? 'rope' : t === 4 ? 'shovel' : undefined
      add(z, { sx: x, sy: y, toFloor: dz, tx: dx, ty: dy, dir, tool })
      // Reverse edge for two-way stairs/ladders: from the upper floor (dz) back
      // down to z (dz = z - 1 for an up link, so the reverse is a "down").
      // Rope spots (t=3) and shovel piles (t=4) stay ONE-WAY: you can't drop
      // through a ceiling hole nor climb back up a dug pit.
      if (t === 1) add(dz, { sx: dx, sy: dy, toFloor: z, tx: x, ty: y, dir: 'down' })
    }
    edgesByFloor = m
  })()
  return linksPromise
}

// Ferry stops snapped onto their floor's walkable ground, grouped by line and
// indexed by floor. Snapping happens once; stops that fail to snap are skipped.
let ferryStopsByLine: FerryStop[][] | null = null
let ferryStopsByFloor: Map<number, FerryStop[]> | null = null
let ferriesPromise: Promise<void> | null = null
function loadFerries(): Promise<void> {
  if (ferryStopsByLine) return Promise.resolve()
  if (ferriesPromise) return ferriesPromise
  ferriesPromise = (async () => {
    const byLine: FerryStop[][] = []
    const byFloor = new Map<number, FerryStop[]>()
    for (let li = 0; li < FERRY_LINES.length; li++) {
      const def = FERRY_LINES[li]
      const snapped: FerryStop[] = []
      for (const s of def.stops) {
        const floor = s.floor ?? 7
        const fg = await buildFloorGrid(floor)
        const sn = snapToWalkable(fg, s.x - X_MIN, s.y - Y_MIN, 60)
        if (!sn) continue
        const stop: FerryStop = {
          line: li,
          lineName: def.name,
          icon: def.icon,
          name: s.name,
          x: sn.gx + X_MIN,
          y: sn.gy + Y_MIN,
          floor,
        }
        snapped.push(stop)
        let arr = byFloor.get(floor)
        if (!arr) {
          arr = []
          byFloor.set(floor, arr)
        }
        arr.push(stop)
      }
      byLine.push(snapped)
    }
    ferryStopsByLine = byLine
    ferryStopsByFloor = byFloor
  })()
  return ferriesPromise
}

// Per-floor navigation data: walkability grid, this floor's transport edges keyed
// by their (snapped) origin cell, and — on the surface — boat harbours by cell.
// Immutable and cached (reused across route computations).
//
// Edge origins and harbours are stored with their SNAPPED world coordinates, so
// the graph search, the leg materialisation and the drawn map badges all agree on
// one exact walkable tile — the route line stays continuous instead of "jumping"
// between a raw coordinate and wherever a later snap happened to land.
type FloorNav = {
  fg: FloorGrid
  linkAt: Map<number, TEdge[]>
  portAt: Map<number, FerryStop> | null
}
const navCache = new Map<number, Promise<FloorNav>>()
function floorNav(floor: number): Promise<FloorNav> {
  const hit = navCache.get(floor)
  if (hit) return hit
  const p = (async (): Promise<FloorNav> => {
    await loadLinks()
    const fg = await buildFloorGrid(floor)
    const linkAt = new Map<number, TEdge[]>()
    for (const e of edgesByFloor!.get(floor) ?? []) {
      // Origins are floor-change tiles — walkable by construction in the bake.
      // r=2 only guards against a stale grid/links pairing; anything farther is
      // a data mismatch and the edge is safer dropped than teleported.
      const s = snapToWalkable(fg, e.sx - X_MIN, e.sy - Y_MIN, 2)
      if (!s) continue
      const idx = s.gy * fg.W + s.gx
      let arr = linkAt.get(idx)
      if (!arr) {
        arr = []
        linkAt.set(idx, arr)
      }
      arr.push({ ...e, sx: s.gx + X_MIN, sy: s.gy + Y_MIN })
    }
    await loadFerries()
    const stops = ferryStopsByFloor!.get(floor)
    let portAt: Map<number, FerryStop> | null = null
    if (stops && stops.length) {
      portAt = new Map()
      for (const stop of stops) portAt.set((stop.y - Y_MIN) * fg.W + (stop.x - X_MIN), stop)
    }
    return { fg, linkAt, portAt }
  })()
  navCache.set(floor, p)
  return p
}

type Transport =
  | { kind: 'link'; e: TEdge }
  | { kind: 'boat'; fromStop: FerryStop; toStop: FerryStop }
// Search node: arriving on a floor at a world point, via some transport.
type Arrival = {
  prio: number
  g: number
  key: string
  floor: number
  x: number
  y: number
  transport: Transport | null
  prevKey: string | null
}

const HOP = 45 // tile-equivalent cost of one stair/boat transfer
const FLOOR_PENALTY = 30 // heuristic cost per floor still to change

// Plan a route across floors and landmasses. A bounded best-first (A*) search over
// "region arrivals": each popped node builds only its floor's grid, floods its
// walkable region to discover reachable transport edges (stairs/holes/ladders/
// teleports) and boat harbours, and relaxes those toward other floors. Deferring
// the floor build to pop-time keeps the search to the handful of floors the route
// actually touches. The chosen chain is then materialised into legs: walk paths
// (grid A* within a floor) plus stair/teleport/boat transitions.
async function planRouteOnce(
  start: { x: number; y: number; floor: number },
  goal: { x: number; y: number; floor: number },
): Promise<RoutePlan | null> {
  await loadLinks()
  // Snap the two endpoints ONCE (clicks and landmark centres can sit on a roof or
  // in water) and use the snapped tiles everywhere after — search, legs, pins all
  // agree on the same walkable start/goal.
  const gnav = await floorNav(goal.floor)
  const gs = snapToWalkable(gnav.fg, goal.x - X_MIN, goal.y - Y_MIN, 60)
  if (!gs) return null
  const goalIdx = gs.gy * gnav.fg.W + gs.gx
  goal = { x: gs.gx + X_MIN, y: gs.gy + Y_MIN, floor: goal.floor }

  const snav = await floorNav(start.floor)
  const ss = snapToWalkable(snav.fg, start.x - X_MIN, start.y - Y_MIN, 60)
  if (!ss) return null
  start = { x: ss.gx + X_MIN, y: ss.gy + Y_MIN, floor: start.floor }

  // Same floor and same walkable region → a plain walk (fast path).
  if (start.floor === goal.floor) {
    const path = findPath(snav.fg, start, goal)
    if (path) {
      const tiles = tilesOf(path)
      return { legs: [{ kind: 'walk', floor: start.floor, path, tiles }], totalTiles: tiles }
    }
  }

  const heur = (f: number, x: number, y: number) =>
    Math.hypot(x - goal.x, y - goal.y) + Math.abs(f - goal.floor) * FLOOR_PENALTY
  const gScore = new Map<string, number>()
  type NodeInfo = { floor: number; x: number; y: number; transport: Transport | null; prevKey: string | null }
  const info = new Map<string, NodeInfo>()
  const visited = new Map<number, Uint8Array>()
  const getVisited = (floor: number, len: number) => {
    let v = visited.get(floor)
    if (!v) {
      v = new Uint8Array(len)
      visited.set(floor, v)
    }
    return v
  }

  const heap: Arrival[] = []
  const hpush = (a: Arrival) => {
    heap.push(a)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p].prio <= heap[i].prio) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const hpop = (): Arrival => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < heap.length && heap[l].prio < heap[s].prio) s = l
        if (r < heap.length && heap[r].prio < heap[s].prio) s = r
        if (s === i) break
        ;[heap[s], heap[i]] = [heap[i], heap[s]]
        i = s
      }
    }
    return top
  }

  const startKey = `${start.floor}:${start.x}:${start.y}`
  gScore.set(startKey, 0)
  hpush({ prio: heur(start.floor, start.x, start.y), g: 0, key: startKey, floor: start.floor, x: start.x, y: start.y, transport: null, prevKey: null })

  let goalKey: string | null = null
  let regions = 0
  while (heap.length) {
    const cur = hpop()
    if ((gScore.get(cur.key) ?? Infinity) < cur.g) continue
    // Each region on a floor is flooded at most once (the persistent `visited`
    // array), so total work is bounded by the walkable tile count regardless of
    // this cap — it's only a backstop against a pathological heap. It must be
    // GENEROUS: with ~70k transport links the heap legitimately pops tens of
    // thousands of duplicate/stale arrivals before deep multi-floor targets
    // (warzone-depth caves) resolve; 15k cut those searches short and reported
    // "no route" for reachable places. Skipped pops are O(1).
    if (regions++ > 400_000) break

    const nav = await floorNav(cur.floor)
    const { fg } = nav
    const { grid, W, H } = fg
    // Arrival points are always walkable already (pre-snapped start, validated
    // link destinations, snapped harbours) — r=2 is just a stale-data guard.
    const s = snapToWalkable(fg, cur.x - X_MIN, cur.y - Y_MIN, 2)
    if (!s) continue
    const startIdx = s.gy * W + s.gx
    const vis = getVisited(cur.floor, grid.length)
    if (vis[startIdx]) continue // this region was already expanded
    info.set(cur.key, { floor: cur.floor, x: cur.x, y: cur.y, transport: cur.transport, prevKey: cur.prevKey })

    // Flood this walkable region (BFS, carrying tile-distance from the arrival
    // point), collecting reachable exits. Charging each exit the actual walking
    // distance to reach it — not just a flat transfer cost — keeps routes short
    // and direct instead of taking a far-off staircase just because it exists.
    const q = [startIdx]
    const qd = [0]
    vis[startIdx] = 1
    let head = 0
    const goalHere = cur.floor === goal.floor
    let reachedGoal = false
    const relax = (nf: number, nx: number, ny: number, walked: number, transport: Transport) => {
      const nk = `${nf}:${nx}:${ny}`
      const ng = cur.g + walked + HOP
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng)
        hpush({ prio: ng + heur(nf, nx, ny), g: ng, key: nk, floor: nf, x: nx, y: ny, transport, prevKey: cur.key })
      }
    }
    while (head < q.length) {
      const c0 = q[head]
      const d = qd[head]
      head++
      if (goalHere && c0 === goalIdx) reachedGoal = true
      const es = nav.linkAt.get(c0)
      if (es) for (const e of es) relax(e.toFloor, e.tx, e.ty, d, { kind: 'link', e })
      if (nav.portAt) {
        const fromStop = nav.portAt.get(c0)
        if (fromStop) {
          for (const toStop of ferryStopsByLine![fromStop.line]) {
            if (toStop === fromStop) continue
            relax(toStop.floor, toStop.x, toStop.y, d, { kind: 'boat', fromStop, toStop })
          }
        }
      }
      const cx = c0 % W
      const cy = (c0 - cx) / W
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy
        if (ny < 0 || ny >= H) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = cx + dx
          if (nx < 0 || nx >= W) continue
          const ni = ny * W + nx
          if (passable(grid[ni]) && !vis[ni]) {
            vis[ni] = 1
            q.push(ni)
            qd.push(d + 1)
          }
        }
      }
    }
    if (reachedGoal) {
      goalKey = cur.key
      break
    }
  }

  if (!goalKey) return null

  // Rebuild the node chain start → goal.
  const chain: { floor: number; x: number; y: number; transport: Transport | null }[] = []
  let ck: string | null = goalKey
  while (ck) {
    const n: NodeInfo = info.get(ck)!
    chain.push({ floor: n.floor, x: n.x, y: n.y, transport: n.transport })
    ck = n.prevKey
  }
  chain.reverse()

  // Materialise legs: within each node's floor, walk from where we arrived to the
  // next transition's origin (or the goal on the last node), then the hop itself.
  // Every endpoint here is a known-walkable tile the search itself used, so each
  // walk MUST resolve; if one doesn't, the data is inconsistent and we report "no
  // route" rather than draw a line that jumps a wall.
  const legs: RouteLeg[] = []
  let totalTiles = 0
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]
    const isLast = i === chain.length - 1
    const nextTr = isLast ? null : chain[i + 1].transport!
    const entry: Pt = { x: node.x, y: node.y }
    const exit: Pt = isLast
      ? { x: goal.x, y: goal.y }
      : nextTr!.kind === 'link'
        ? { x: nextTr!.e.sx, y: nextTr!.e.sy }
        : { x: nextTr!.fromStop.x, y: nextTr!.fromStop.y }

    const nav = await floorNav(node.floor)
    const path = findPath(nav.fg, entry, exit)
    if (!path) return null
    if (path.length > 1) {
      const tiles = tilesOf(path)
      legs.push({ kind: 'walk', floor: node.floor, path, tiles })
      totalTiles += tiles
    }

    if (!isLast) {
      if (nextTr!.kind === 'link') {
        const e = nextTr!.e
        legs.push({
          kind: 'stairs',
          from: { x: e.sx, y: e.sy },
          to: { x: e.tx, y: e.ty },
          floor: node.floor,
          toFloor: e.toFloor,
          dir: e.dir,
          tool: e.tool,
        })
      } else {
        const { fromStop, toStop } = nextTr!
        legs.push({
          kind: 'boat',
          from: { x: fromStop.x, y: fromStop.y },
          to: { x: toStop.x, y: toStop.y },
          fromName: fromStop.name,
          toName: toStop.name,
          fromFloor: fromStop.floor,
          toFloor: toStop.floor,
          lineName: fromStop.lineName,
          icon: fromStop.icon,
        })
      }
    }
  }

  return { legs, totalTiles }
}

// Public entry point. One hard-walls pass: a clean route that never crosses water
// or a wall, or null when there genuinely isn't one in the data.
export async function planRoute(
  start: { x: number; y: number; floor: number },
  goal: { x: number; y: number; floor: number },
): Promise<RoutePlan | null> {
  return planRouteOnce(start, goal)
}

if (typeof window !== 'undefined') {
  const w = window as unknown as { __planRoute?: typeof planRoute }
  w.__planRoute = planRoute
}
