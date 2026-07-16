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
      // Venore anchors on the open plaza east of the depot — (32947,32081) is a
      // sealed 27-tile courtyard pocket that strands the snap.
      { name: 'Venore', x: 32963, y: 32087 },
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
  // (removed) Zao ↔ north island raft: both docks sit inside the sealed
  // Great-Gate compound (an 821-tile pocket unreachable from the mainland),
  // so the line could never be boarded — dead weight in the search.
  { name: 'Barca', icon: 'sailboat', stops: [{ name: 'Liberty Bay', x: 32347, y: 32858 }, { name: 'Meriana', x: 32132, y: 32912 }] },
  // The Forbidden Islands (Talahu / Malada / Nargor — the far-west "Ferumbras"
  // isles: Crypt Shamblers, serpent spawns, Lich Hell). In-game they're reached
  // only through the scripted Shattered Isles portal chain from the main isles —
  // a pure-lua ritual/turtle hop with NO map data, so this whole island cluster
  // (51k connected tiles) sits disconnected from everything in the bake. Meriana
  // is already boat-served (the Waverider 'Barca' from Liberty Bay); this curated
  // hop bridges Meriana to the Forbidden Islands surface, whose interior then walks
  // to the spawns. Route report #3 (Ankrahmun->Crypt Shambler) dead-ended without it.
  { name: 'Portal de quest', icon: 'sparkles', stops: [
    { name: 'Meriana', x: 32132, y: 32912, floor: 7 },
    { name: 'Islas Prohibidas (Talahu)', x: 31961, y: 32636, floor: 8 },
  ] },
  // Marapur (Moonfall): its "To Port Hope" dock marker pairs with Port Hope's harbour.
  { name: 'Barca', icon: 'sailboat', stops: [{ name: 'Port Hope', x: 32629, y: 32769 }, { name: 'Marapur', x: 33842, y: 32852 }] },
  // Gray Island (the gateway to Quirefang/The Hive): sailed from the eastern
  // harbours — modelled from Cormaya, the nearest one.
  { name: 'Barca', icon: 'sailboat', stops: [{ name: 'Cormaya', x: 33307, y: 31999 }, { name: 'Gray Island', x: 33191, y: 31985 }] },
  // Kazordoon steamboat: Cormaya harbour ↔ the underground mountain lake docks.
  // The Primal Ordeal update added a Gnomprona stop (the excavation under
  // Marapur) — the map has its dock marker at f14.
  {
    name: 'Vapor',
    icon: 'ship',
    stops: [
      { name: 'Cormaya', x: 33309, y: 31996 },
      { name: 'Kazordoon minas', x: 32526, y: 32037, floor: 14 },
      { name: 'Kazordoon', x: 32555, y: 32068, floor: 10 },
      { name: 'Gnomprona', x: 33517, y: 32857, floor: 14 },
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
  // Demon Forge access pair east of Edron (f6 shrine ↔ f9 halls).
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Santuario (este de Edron)', x: 33602, y: 31888, floor: 6 },
      { name: 'Demon Forge', x: 33532, y: 31820, floor: 9 },
      { name: 'Demon Forge (salas)', x: 33507, y: 31842, floor: 8 },
    ],
  },
  // Deep Otherworld: the beach connects to the lower halls via scripted portals
  // (no t2 rows exist in the OTBM), so the hop is curated Grey Beach ↔ f11; the
  // f11→f15 descent teleports are intra-plane and stitch the rest.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Grey Beach', x: 32160, y: 31296 },
      { name: 'Otherworld (profundo)', x: 32105, y: 31347, floor: 11 },
    ],
  },
  // Zarganash (Soul War): its five sub-zones are joined by scripted soul portals —
  // modelled as one portal network from the entry hall.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Zarganash (entrada)', x: 33456, y: 31499, floor: 13 },
      { name: 'Zarganash (salas este)', x: 33569, y: 31386, floor: 8 },
      { name: 'Zarganash (salas centrales)', x: 33493, y: 31450, floor: 8 },
      { name: 'Zarganash (profundo)', x: 33646, y: 31465, floor: 10 },
      { name: 'Zarganash (anexo oeste)', x: 31955, y: 32329, floor: 8 },
    ],
  },
  // Vengoth tower top (scripted lift) and Pits of Inferno entrance.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Vengoth (castillo)', x: 32916, y: 31516 },
      { name: 'Torre de Vengoth', x: 32943, y: 31463, floor: 3 },
      { name: 'Torre de Vengoth (cima)', x: 32951, y: 31441, floor: 1 },
      { name: 'Torres del este (Vengoth)', x: 32976, y: 31426, floor: 4 },
    ],
  },
  // Vengoth portal chamber (In Service of Yalahar): the yielothax room under
  // the castle is a sealed pocket entered via the quest's machine teleporter.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Vengoth (castillo)', x: 32916, y: 31516 },
      { name: 'Vengoth (sala del portal)', x: 32943, y: 31565, floor: 9 },
    ],
  },
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Plains of Havoc', x: 32835, y: 32280 },
      { name: 'Pits of Inferno', x: 32884, y: 32311, floor: 12 },
    ],
  },
  // Feyrist (dream peninsula NW of Roshamuul): entered through the Holy Shrine
  // archways in the cities' temples (scripted, no t2 rows in the OTBM) —
  // modelled from the Thais temple, the boat hub. Three of the four shrines
  // exit in the village (f7); the energy shrine exits on the f4 plateau.
  {
    name: 'Santuario de Feyrist',
    icon: 'sparkles',
    stops: [
      { name: 'Thais (templo)', x: 32369, y: 32241 },
      { name: 'Feyrist (aldea)', x: 33540, y: 32208 },
      { name: 'Feyrist (meseta)', x: 33528, y: 32300, floor: 4 },
    ],
  },
  // Candia (the candy realm, west half of the peninsula): its only ways in/out
  // are the giant donut gates on either side — scripted, like the shrines.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Feyrist (puerta dónut)', x: 33574, y: 32222 },
      { name: 'Candia', x: 33339, y: 32125 },
    ],
  },
  // Gnomprona (Primal Ordeal): the steamboat reaches the gnome hub; from there
  // scripted teleporters (no t2 rows) fan out to the three hunting grounds.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Gnomprona (hub)', x: 33546, y: 32911, floor: 15 },
      { name: 'Sparkling Pools', x: 33579, y: 32788, floor: 14 },
      { name: 'Monster Graveyard', x: 33582, y: 32864, floor: 14 },
      { name: 'Crystal Enigma', x: 33764, y: 32828, floor: 14 },
    ],
  },
  // Warzones 1-2-3 (Bigfoot's Burden, under the Kazordoon mines): Gnomebase
  // Alpha and the warzone interiors only have RETURN teleports in the OTBM —
  // the entries are scripted, so the whole network is curated. Kazordoon is
  // the walkable mainland anchor (the real gnome lift chamber is sealed).
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Kazordoon', x: 32555, y: 32068, floor: 10 },
      { name: 'Gnomebase Alpha', x: 33001, y: 31900, floor: 9 },
      { name: 'Warzone 1', x: 33076, y: 31901, floor: 10 },
      { name: 'Warzone 2', x: 33060, y: 31931, floor: 11 },
      { name: 'Warzone 3', x: 33060, y: 31898, floor: 12 },
    ],
  },
  // Warzones 4-5-6: the map's own teleport pair joins Gnomegate (f11, walkable
  // from the Kazordoon mines) with the f14 gnome camp east of Oramond; the
  // three instance entrances there are scripted (only exit rows exist), so
  // each warzone gets a stop anchored on its exit-teleport tile.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Gnomegate', x: 32624, y: 31869, floor: 11 },
      { name: 'Warzones 4-5-6 (campamento)', x: 33745, y: 32191, floor: 14 },
      { name: 'Warzone 4', x: 33534, y: 32182, floor: 15 },
      { name: 'Warzone 5', x: 33206, y: 32119, floor: 15 },
      { name: 'Warzone 6', x: 33367, y: 32309, floor: 15 },
    ],
  },
  // Warzones 8 and 9 (Grotto of the Lost / Dwelling of the Forgotten): real
  // two-way teleport pairs from the Gnomegate f10 chamber into the Otherworld
  // deep — cross-map, so they can't ride a quest plane. Warzone 7 (Antrum of
  // the Fallen) needs no line: its teleport is local and the Gnomegate quest
  // plane keeps it.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Gnomegate (subsuelo)', x: 32651, y: 31823, floor: 10 },
      { name: 'Grotto of the Lost (WZ 8)', x: 32143, y: 31448, floor: 14 },
    ],
  },
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Gnomegate (subsuelo)', x: 32663, y: 31819, floor: 10 },
      { name: 'Dwelling of the Forgotten (WZ 9)', x: 32089, y: 31453, floor: 11 },
    ],
  },
  // Deeper Banuta's lowest level (medusae / serpent spawns): reached ONLY via
  // Banuta's sealed teleporter (The Ape City quest) — scripted, no t2 rows.
  // The map's own 'Shortcut to Deeper Banuta' marker is the mainland anchor.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Banuta (teletransportador)', x: 32853, y: 32669 },
      { name: 'Deeper Banuta', x: 32754, y: 32506, floor: 11 },
    ],
  },
  // The Spike (SW, under the Gnomegate tunnels). A pure teleporter-hub dungeon:
  // eighteen scripted step-in teleporters (Canary aids 4226-4243, a lua MoveEvent —
  // NO OTBM teleport item, so zero t2 rows and the bake sees every floor as a
  // sealed cave). You enter at the lobby in the gnome tunnels (32624,31853,z11 →
  // Spike z8), then descend z8→z15; each floor's hunting area is a separate
  // teleport landing. Modelled as a curated line: lobby + one stop per floor at the
  // level's real teleport-destination tile (from movements_spike_teleport.lua).
  // Route report #2 (Liberty Bay→Mutated Rat, Middle Spike z12) dead-ended because
  // the z12 cave had no modelled entrance. All stop tiles verified walkable; the z12
  // stop sits inside the 18k-tile Mutated Rat cave component.
  {
    name: 'The Spike',
    icon: 'sparkles',
    stops: [
      { name: 'Entrada del Spike', x: 32624, y: 31853, floor: 11 },
      { name: 'Lower Spike', x: 32228, y: 32596, floor: 8 },
      { name: 'Lower Spike (medio)', x: 32243, y: 32619, floor: 9 },
      { name: 'Lower Spike (fondo)', x: 32240, y: 32620, floor: 10 },
      { name: 'Middle Spike', x: 32227, y: 32598, floor: 11 },
      { name: 'Middle Spike (medio)', x: 32238, y: 32622, floor: 12 },
      { name: 'Middle Spike (fondo)', x: 32244, y: 32619, floor: 13 },
      { name: 'Upper Spike', x: 32244, y: 32588, floor: 14 },
      { name: 'Upper Spike (fondo)', x: 32224, y: 32606, floor: 15 },
    ],
  },
  // Ankrahmun's Ancient Tombs. Owner-verified in-game: each tomb is entered ON
  // FOOT through its own doorway in the desert — NOT by a portal from the city
  // (the old single city-anchored line prescribed "boat to Ankrahmun, teleport
  // to the pharaoh", departing from the dock; users rightly called it fake).
  // The OTBM simply lacks the descent links under the doorways (links-only
  // flood: every surface entrance walks, every wing below is sealed), so each
  // tomb gets its OWN line anchored at its real entrance: routes now walk the
  // desert to the tomb, then hop inside. The teleporter mazes within (kept by
  // the tombs quest plane) stitch the rest. Wing coords come from the client
  // markers ("<Pharaoh> (exact spawn tile)"); all 9 pharaoh tiles verified
  // reachable through this grouping.
  {
    name: 'Entrada de tumba',
    icon: 'door',
    stops: [
      { name: 'Mountain Tomb', x: 33133, y: 32568 },
      { name: 'Tumba de Dipthrah', x: 33086, y: 32565, floor: 14 },
      { name: 'Tumba de Dipthrah (fondo)', x: 33093, y: 32587, floor: 15 },
      { name: 'Tumbas profundas (oeste)', x: 33049, y: 32503, floor: 13 },
    ],
  },
  {
    name: 'Entrada de tumba',
    icon: 'door',
    stops: [
      { name: 'Oasis Tomb', x: 33133, y: 32640 },
      { name: 'Tumba de Rahemos', x: 33127, y: 32819, floor: 13 },
    ],
  },
  {
    name: 'Entrada de tumba',
    icon: 'door',
    stops: [
      { name: 'Ancient Ruins Tomb', x: 33208, y: 32591 },
      { name: 'Tumba de Vashresamun', x: 33082, y: 32678, floor: 13 },
      { name: 'Tumba de los escarabajos', x: 33245, y: 32516, floor: 11 },
      { name: 'Tumbas profundas (este)', x: 33256, y: 32509, floor: 14 },
    ],
  },
  {
    name: 'Entrada de tumba',
    icon: 'door',
    stops: [
      { name: 'Tarpit Tomb', x: 33233, y: 32704 },
      { name: 'Tumba de Morguthis', x: 33186, y: 32662, floor: 13 },
      { name: 'Tumba de Morguthis (fondo)', x: 33172, y: 32694, floor: 14 },
      { name: 'Tumbas profundas (centro)', x: 33319, y: 32635, floor: 13 },
    ],
  },
  {
    name: 'Entrada de tumba',
    icon: 'door',
    stops: [
      { name: 'Stone Tomb', x: 33282, y: 32743 },
      { name: 'Tumba de Thalas', x: 33362, y: 32750, floor: 13 },
      { name: 'Tumba de Thalas (fondo)', x: 33396, y: 32839, floor: 14 },
    ],
  },
  {
    name: 'Entrada de tumba',
    icon: 'door',
    stops: [
      { name: 'Shadow Tomb', x: 33255, y: 32833 },
      { name: 'Tumba de Mahrdis', x: 33119, y: 32969, floor: 13 },
      { name: 'Tumbas del sur', x: 33219, y: 32878, floor: 13 },
      { name: 'Tumbas del sur (nivel inferior)', x: 33218, y: 32865, floor: 14 },
    ],
  },
  // Library Tomb: the pyramid inside the city (Ashmunrah) — also serves the
  // under-city crypts (plaguethrowers) right below it.
  {
    name: 'Entrada de tumba',
    icon: 'door',
    stops: [
      { name: 'Library Tomb', x: 33142, y: 32838 },
      { name: 'Criptas de Ankrahmun', x: 33141, y: 32833, floor: 10 },
      { name: 'Tumba de Ashmunrah', x: 33179, y: 32884, floor: 11 },
      { name: 'Tumbas profundas (interior)', x: 33123, y: 32753, floor: 13 },
    ],
  },
  {
    name: 'Entrada de tumba',
    icon: 'door',
    stops: [
      { name: 'Peninsula Tomb', x: 33027, y: 32869 },
      { name: 'Tumba de Omruc', x: 33202, y: 32998, floor: 14 },
      { name: 'Cueva de los shapers', x: 32967, y: 32849, floor: 13 },
    ],
  },
  {
    name: 'Entrada de tumba',
    icon: 'door',
    stops: [
      { name: 'Horestis Tomb', x: 33060, y: 32734 },
      { name: 'Horestis Tomb (medio)', x: 33025, y: 32704, floor: 9 },
      { name: 'Horestis Tomb (profundo)', x: 33028, y: 32736, floor: 13 },
    ],
  },
  // Drefia's southern wings (grim reapers f10/f11) and the werehyaena pocket
  // under Darashia's mountains — sealed sub-dungeons, anchored at Darashia.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Darashia', x: 33213, y: 32453 },
      { name: 'Cueva werehyaena (bolsillo)', x: 33213, y: 32488, floor: 10 },
      // Darashia's sealed hunting grounds (lua-entered). The wyrm-hill nests
      // need no stops: they're LEVITATE ledges (t=5 edges cover them).
      { name: "Lion's Rock (santuario)", x: 33118, y: 32245, floor: 9 },
      { name: 'Guarida de werelions', x: 33113, y: 32378, floor: 10 },
      { name: 'Guarida werehyaena (norte)', x: 33160, y: 32334, floor: 9 },
      { name: 'Catacumbas del este', x: 33382, y: 32322, floor: 13 },
      { name: 'Catacumbas del este (fondo)', x: 33427, y: 32381, floor: 15 },
      { name: 'Catacumbas del este (fondo sur)', x: 33438, y: 32431, floor: 15 },
      // NOTE: Drefia gets NO curated stops. Its ruins, crypts and the wyrm
      // lair are genuinely WALKABLE from the desert (rope up the scorpion
      // mountain at 33049,32428 → f6 crossing → ledge → down; wiki-confirmed
      // route). Earlier curated hops here faked teleports that don't exist
      // in-game and hijacked the real path — the deep pockets that remain
      // sealed in the data (grim reaper lever dungeons, flooded deathling
      // caves, tower tops) now get honest PARTIAL routes instead.
    ],
  },
  // Quirefang / The Hive: Gray Island's hive borer (scripted, no t2 rows)
  // drills to the outpost isle and the Hive island itself. The hive interior
  // is a honeycomb of scripted pores — one anchor per chamber cluster; the
  // deepling sea floor and the Quirefang depths ride the same network.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Gray Island', x: 33191, y: 31985 },
      { name: 'Hive Outpost', x: 33467, y: 31322 },
      { name: 'The Hive', x: 33527, y: 31261 },
      { name: 'The Hive (cúpula este)', x: 33595, y: 31213, floor: 4 },
      { name: 'The Hive (cúpula este, alto)', x: 33608, y: 31226, floor: 1 },
      { name: 'The Hive (cúpula este, cámaras)', x: 33561, y: 31221, floor: 2 },
      { name: 'The Hive (cúpula oeste)', x: 33484, y: 31199, floor: 2 },
      { name: 'The Hive (cúpula oeste, alto)', x: 33511, y: 31172, floor: 6 },
      { name: 'The Hive (túneles, norte)', x: 33522, y: 31202, floor: 8 },
      { name: 'The Hive (túneles, sur)', x: 33505, y: 31264, floor: 8 },
      { name: 'The Hive (túneles, este)', x: 33549, y: 31204, floor: 8 },
      { name: 'The Hive (nido)', x: 33567, y: 31228, floor: 9 },
      { name: 'Fondo marino (deeplings)', x: 33459, y: 31342, floor: 11 },
      { name: 'Fondo marino (noroeste)', x: 33418, y: 31150, floor: 8 },
      { name: 'Fondo marino (grutas)', x: 33407, y: 31163, floor: 10 },
      { name: 'Profundidades de Quirefang', x: 33543, y: 31367, floor: 15 },
      { name: 'Profundidades de Quirefang (este)', x: 33566, y: 31399, floor: 14 },
    ],
  },
  // Kilmaresh beyond Issavi's walls: the countryside gates, the Rascacoon
  // ways, the Iks cave systems, Iksupan's undercity and spore caverns, and
  // the Soul War tower (Goshnar's Cruelty) are all scripted-entry pockets —
  // one curated network anchored at Issavi (the magic carpet stop).
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Issavi', x: 33946, y: 31516 },
      { name: 'Kilmaresh (noroeste)', x: 33788, y: 31335 },
      { name: 'Camino a Rascacoon', x: 33829, y: 31376, floor: 8 },
      { name: 'Cuevas iks (este)', x: 33993, y: 31770, floor: 8 },
      { name: 'Cuevas iks (sureste)', x: 34051, y: 31813, floor: 8 },
      { name: 'Cuevas iks (sur)', x: 33979, y: 31841, floor: 8 },
      { name: 'Cuevas iks (galerías)', x: 34071, y: 31754, floor: 9 },
      { name: 'Iksupan Undercity', x: 33887, y: 31662, floor: 14 },
      { name: 'Iksupan Undercity (este)', x: 34009, y: 31664, floor: 14 },
      { name: 'Iksupan Undercity (oeste)', x: 33812, y: 31675, floor: 14 },
      { name: 'Undercity (frontera este)', x: 34115, y: 31901, floor: 14 },
      { name: 'Cavernas de esporas', x: 34002, y: 31817, floor: 15 },
      { name: "Goshnar's Cruelty (torre)", x: 33843, y: 31833, floor: 3 },
      { name: "Goshnar's Cruelty (torre, medio)", x: 33854, y: 31839, floor: 4 },
      { name: "Goshnar's Cruelty (torre, alto)", x: 33849, y: 31848, floor: 5 },
      { name: 'Taints (túneles)', x: 33806, y: 31790, floor: 8 },
      { name: 'Taints (profundo)', x: 33889, y: 31829, floor: 14 },
      { name: 'Kilmaresh (suroeste, f14)', x: 33720, y: 31946, floor: 14 },
      { name: 'Kilmaresh (suroeste, fondo)', x: 33734, y: 31938, floor: 15 },
    ],
  },
  // Ferumbras' citadel seal dungeons (spectres/grimeleeches/vexclaws): the
  // citadel f14 halls walk in from the desert; the seal wings are sealed.
  // The Kha'zeel east caves (choking fears / retching horrors) and Cobra
  // Bastion's interior live on the same massif — the desert surface east of
  // x≈33336 isn't walkable in the data, so they anchor here (the citadel
  // walk-in IS the real under-mountain approach), not on a city portal.
  {
    name: 'Portal de quest',
    icon: 'sparkles',
    stops: [
      { name: 'Ciudadela de Ferumbras', x: 33420, y: 32678, floor: 14 },
      { name: 'Sellos de la Ciudadela (f14)', x: 33397, y: 32836, floor: 14 },
      { name: 'Sellos de la Ciudadela (f12)', x: 33453, y: 32782, floor: 12 },
      { name: 'Cuevas del este (Ankrahmun)', x: 33415, y: 32567, floor: 8 },
      { name: 'Cuevas del este (profundo)', x: 33443, y: 32576, floor: 9 },
      { name: 'Cuevas del este (sur)', x: 33446, y: 32631, floor: 9 },
      { name: 'Cuevas del este (sur, fondo)', x: 33458, y: 32617, floor: 10 },
      { name: 'Cuevas del este (f11)', x: 33447, y: 32606, floor: 11 },
      { name: 'Cobra Bastion', x: 33398, y: 32650, floor: 2 },
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
      tool?: 'rope' | 'shovel' | 'levitate'
    }
export type RoutePlan = {
  legs: RouteLeg[]
  totalTiles: number
  // Present when the goal was unreachable: the route guides as far as the
  // network gets, and this reports where the trail goes cold + how far (in
  // straight-line tiles) the target still is from that point.
  partial?: { x: number; y: number; floor: number; remaining: number }
}

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
//   t=4 stone pile (down, needs a shovel), t=5 levitate ledge (two-way,
//   needs the Levitate spell; generated from cliff faces whose BOTH sides
//   are client-walked — real players hop them with exani hur).
type TEdge = {
  sx: number
  sy: number
  toFloor: number
  tx: number
  ty: number
  dir: 'up' | 'down' | 'teleport'
  tool?: 'rope' | 'shovel' | 'levitate'
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
      [33270, 33660, 32300, 32860, 8, 15], // Roshamuul Prison: antechamber (f9-f14 under Roshamuul) + all wings
      [33440, 33660, 31600, 31940, 6, 15], // Demon Forge halls east of Edron
      [33330, 33740, 32040, 32310, 0, 15], // Feyrist + Candia (dream peninsula; Prison keeps its overlap rows via shared-plane test)
      [32560, 32760, 31700, 31900, 9, 13], // Gnomegate (keeps the local WZ7/f10-chamber teleports)
      [32700, 32880, 32420, 32700, 8, 11], // Deeper Banuta (two local f11 pairs join the medusa/serpent-spawn wings)
      [32960, 32970, 32588, 32600, 7, 7], // Banuta east barrier (two-way 3-tile forcefield hop → hydra caves NE)
      [32670, 32730, 31585, 31650, 10, 12], // Hellgate deep teleport (NE of Ab'Dendriel → the undead complex up to the tower isle)
      // Ankrahmun: the Ancient Tombs' interiors are stitched by their own
      // teleporter mazes (t2 rows f8-f15); the two REAL map portals are
      // two-way pyramid pairs — desert (33205,32531 f7↔f8) and a city
      // pyramid top (33195,32851 f4↔f8) — kept via the micro-planes below.
      // y down to 33020: Omruc's wing (y~32950-33015) has 4 of its own rows,
      // including the exit teleport at (33187,33015,f14).
      [32950, 33470, 32450, 33020, 8, 15], // Ankrahmun tombs underground (incl. the Mahrdis + Omruc wings)
      [33020, 33055, 32415, 32445, 9, 12], // Drefia crypts: its three REAL teleport rows (local lever hops)
      [33380, 33700, 31140, 31410, 8, 15], // Quirefang / The Hive (deepling f11 pairs + the f12↔f15 hop)
      [33700, 34304, 31250, 31950, 0, 15], // Kilmaresh (its quest-shortcut teleport network, 32 rows)
      [33550, 33790, 31440, 31540, 10, 14], // Zarganash halls → Goshnar taint approach (Soul War passage)
      [33200, 33210, 32526, 32536, 7, 8], // pyramid portal (desert, into the tomb network)
      [33188, 33200, 32842, 32856, 4, 8], // pyramid portal (city top f4, into the under-city crypts)
      [33390, 33400, 32655, 32668, 6, 6], // Cobra Bastion gate (5-tile f6 hop; its stairs are all real links)
      [31880, 32160, 32440, 32820, 0, 15], // Forbidden Islands (Talahu/Malada/Nargor): the "Shattered Isles portals" web that stitches the sub-islands (Lich Hell / serpent spawns / Crypt Shamblers). Entry = curated Meriana->Talahu hop above.
    ]
    // A teleport is kept iff ONE plane contains BOTH of its ends ("shared
    // plane"), not "first matching plane of each end is the same" — planes may
    // overlap (micro entrance planes sit inside zone planes, Prison overlaps
    // the Ankrahmun tombs), and first-match semantics silently dropped rows
    // whose ends resolved to different overlapping boxes.
    const inPlane = (p: [number, number, number, number, number, number], x: number, y: number, z: number) =>
      x >= p[0] && x <= p[1] && y >= p[2] && y <= p[3] && z >= p[4] && z <= p[5]
    const sharedPlane = (x: number, y: number, z: number, dx: number, dy: number, dz: number) =>
      QUEST_PLANES.some((p) => inPlane(p, x, y, z) && inPlane(p, dx, dy, dz))
    // Owner-verified in-game correction: the Drefia wyrm sanctum (f10, behind
    // the Medusa Shield Quest doors) is NOT reachable by dropping from the
    // northern rotworm caves — if it were, the quest doors would be pointless.
    // The OT map keeps a dozen such f9→f10 drops open across the northern
    // sector; the real approach is through Drefia's pentagon only (its f9
    // drops sit south of the rect, at y≥32410).
    const excludedLink = (x: number, y: number, z: number, dz: number) =>
      z === 9 && dz === 10 && x >= 32980 && x <= 33080 && y >= 32300 && y <= 32400
    for (const [x, y, z, dx, dy, dz, t] of raw) {
      if (excludedLink(x, y, z, dz)) continue
      // Teleports (t=2) are EXCLUDED from routing: in this map they're almost all
      // quest/event mechanics (Demon Helmet chain, boss rooms, warzone gates) —
      // technically real, but "take a boat to Darashia, climb the mountain and use
      // the quest teleport" is never the answer a map should give. Quest-locked
      // areas honestly report "no route" instead. Exception: intra-plane teleports
      // (see QUEST_PLANES above).
      if (t === 2) {
        if (!sharedPlane(x, y, z, dx, dy, dz)) continue
        add(z, { sx: x, sy: y, toFloor: dz, tx: dx, ty: dy, dir: 'teleport' })
        continue
      }
      const dir = t === 0 || t === 4 ? 'down' : 'up'
      const tool = t === 3 ? 'rope' : t === 4 ? 'shovel' : t === 5 ? 'levitate' : undefined
      add(z, { sx: x, sy: y, toFloor: dz, tx: dx, ty: dy, dir, tool })
      // Reverse edge for two-way stairs/ladders: from the upper floor (dz) back
      // down to z (dz = z - 1 for an up link, so the reverse is a "down").
      // Rope spots (t=3) and shovel piles (t=4) stay ONE-WAY: you can't drop
      // through a ceiling hole nor climb back up a dug pit. Levitate ledges
      // (t=5) are two-way — exani hur works up and down.
      if (t === 1) add(dz, { sx: dx, sy: dy, toFloor: z, tx: x, ty: y, dir: 'down' })
      if (t === 5) add(dz, { sx: dx, sy: dy, toFloor: z, tx: x, ty: y, dir: 'down', tool: 'levitate' })
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
  // A cell can host stops of SEVERAL lines (shared hubs like Vengoth castle or
  // Kazordoon are one tile serving multiple curated lines), so this maps to a list.
  portAt: Map<number, FerryStop[]> | null
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
    let portAt: Map<number, FerryStop[]> | null = null
    if (stops && stops.length) {
      portAt = new Map()
      for (const stop of stops) {
        const key = (stop.y - Y_MIN) * fg.W + (stop.x - X_MIN)
        const arr = portAt.get(key)
        if (arr) arr.push(stop)
        else portAt.set(key, [stop])
      }
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
// A rope spot or a stone pile is NOT as cheap as a staircase: you carry the
// tool, stand on the one exact tile, use it — and the hop is one-way (you
// can't climb back down a ceiling hole or undo a dig). Players only take them
// when they save serious walking. At the same price as stairs the planner
// prescribed shovel+rope gymnastics (dig two floors, rope straight back up)
// to shave ~30 tiles off the real staircase crossing into Drefia.
const TOOL_HOP = 3 * HOP // rope / shovel / levitate transfer
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

  // Best-effort fallback: remember the visited tile that gets CLOSEST to the
  // goal, so an unreachable target still yields a partial route plus a "the
  // trail goes cold here" report instead of a bare failure.
  const closeness = (f: number, x: number, y: number) =>
    Math.max(Math.abs(x - goal.x), Math.abs(y - goal.y)) + Math.abs(f - goal.floor) * FLOOR_PENALTY
  let best = { d: closeness(start.floor, start.x, start.y), key: startKey, x: start.x, y: start.y, floor: start.floor }

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
      const hop = transport.kind === 'link' && transport.e.tool ? TOOL_HOP : HOP
      const ng = cur.g + walked + hop
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
        const fromStops = nav.portAt.get(c0)
        if (fromStops) {
          for (const fromStop of fromStops) {
            for (const toStop of ferryStopsByLine![fromStop.line]) {
              if (toStop === fromStop) continue
              relax(toStop.floor, toStop.x, toStop.y, d, { kind: 'boat', fromStop, toStop })
            }
          }
        }
      }
      const cx = c0 % W
      const cy = (c0 - cx) / W
      const bd = closeness(cur.floor, cx + X_MIN, cy + Y_MIN)
      if (bd < best.d) best = { d: bd, key: cur.key, x: cx + X_MIN, y: cy + Y_MIN, floor: cur.floor }
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

  // Goal unreachable → best-effort partial route: guide the player to the
  // closest point the network reaches and mark where the trail goes cold.
  const partial = !goalKey
  if (partial && !info.has(best.key)) return null
  const endKey = goalKey ?? best.key
  const dest: Pt = partial ? { x: best.x, y: best.y } : { x: goal.x, y: goal.y }

  // Rebuild the node chain start → goal (or → the trail-lost point).
  const chain: { floor: number; x: number; y: number; transport: Transport | null }[] = []
  let ck: string | null = endKey
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
      ? dest
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

  const plan: RoutePlan = { legs, totalTiles }
  if (partial)
    plan.partial = {
      x: best.x,
      y: best.y,
      floor: best.floor,
      remaining: Math.max(Math.abs(best.x - goal.x), Math.abs(best.y - goal.y)),
    }
  return plan
}

// Public entry point. One hard-walls pass: a clean route that never crosses water
// or a wall. When the goal is unreachable it returns the best PARTIAL route
// (marked via plan.partial) so the player still gets guided as far as the data
// goes; null only when not even a partial leg could be materialised.
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
