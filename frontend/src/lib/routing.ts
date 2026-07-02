// Real "how to get there" routing over the Tibia map — moves like the client's
// map-click auto-walk.
//
// Walkability is the GAME'S rule, baked offline from the real map + the client's
// own item flags (see tools/otbm/bake-walk.mjs), NOT the minimap colour. Each
// floor ships a gzipped 1-byte-per-tile bitmap at public/walk/f<z>.bin (1 = you
// can stand there, 0 = you cannot). Water and walls are hard 0s, so a route can
// NEVER cross them — the search either finds a clean path or reports none. Floors
// are linked only by real stairs / holes / ladders / teleports (public/
// floor-links.json), and separate landmasses by NPC boats. No soft walls, no
// colour guessing, no "approximate" fallback.

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

// A tile is walkable when its bitmap byte is 1. Everything else (water, wall,
// void, unexplored) is blocked — hard, no exceptions.
const passable = (v: number) => v === 1

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
      const res = await fetch(`/walk/f${floor}.bin`)
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
  constructor(private f: Float64Array) {}
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

// A* on the floor's walkability grid. 8-directional, uniform terrain (every step
// costs its geometric length: 1 orthogonally, √2 diagonally). `start`/`goal` are
// world coords; returns world-coord waypoints (collinear points removed) or null
// if unreachable within this floor.
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
  // Octile distance, mildly weighted so the search stays directed (fast) without
  // meaningfully hurting path quality on a uniform grid.
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
        const step = dx !== 0 && dy !== 0 ? SQRT2 : 1
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

type Port = { name: string; x: number; y: number }

// One harbour per boat-served landmass (surface floor). Coordinates match the
// map's landmarks; Darashia/Rathleton share a landmass with a listed port so
// they're reached on foot from it.
const BOAT_PORTS: Port[] = [
  { name: 'Thais', x: 32365, y: 32224 },
  { name: 'Carlin', x: 32343, y: 31792 },
  { name: 'Venore', x: 32947, y: 32081 },
  { name: 'Edron', x: 33211, y: 31830 },
  { name: 'Port Hope', x: 32629, y: 32769 },
  { name: 'Ankrahmun', x: 33146, y: 32816 },
  { name: 'Liberty Bay', x: 32309, y: 32794 },
  { name: 'Svargrond', x: 32278, y: 31146 },
  { name: 'Yalahar', x: 32805, y: 31234 },
  { name: 'Oramond', x: 33607, y: 31955 },
]

export type RouteLeg =
  | { kind: 'walk'; floor: number; path: Pt[]; tiles: number }
  | { kind: 'boat'; from: Pt; to: Pt; fromName: string; toName: string }
  | {
      kind: 'stairs'
      from: Pt
      to: Pt
      floor: number
      toFloor: number
      dir: 'up' | 'down' | 'teleport'
    }
export type RoutePlan = { legs: RouteLeg[]; totalTiles: number }

// --- Floor-change links (stairs / holes / ladders / teleports) ---------------
// Baked offline into public/floor-links.json as compact rows
//   [x, y, z, dx, dy, dz, t]   t: 0 = down hole, 1 = up stairs/ladder, 2 = teleport
// Each row becomes a directed transport edge. Stairs and ladders are physically
// two-way, so a t=1 row also yields the reverse (down) edge — this is what lets
// the search descend a staircase you'd otherwise only know how to climb, and is
// what finally connects deep multi-floor targets (e.g. the grim reaper room).
// Holes (you fall, then rope back up) and teleports stay one-way.
type TEdge = { sx: number; sy: number; toFloor: number; tx: number; ty: number; dir: 'up' | 'down' | 'teleport' }
let edgesByFloor: Map<number, TEdge[]> | null = null
let linksPromise: Promise<void> | null = null
function loadLinks(): Promise<void> {
  if (edgesByFloor) return Promise.resolve()
  if (linksPromise) return linksPromise
  linksPromise = (async () => {
    const res = await fetch('/floor-links.json')
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
    for (const [x, y, z, dx, dy, dz, t] of raw) {
      const dir = t === 0 ? 'down' : t === 2 ? 'teleport' : 'up'
      add(z, { sx: x, sy: y, toFloor: dz, tx: dx, ty: dy, dir })
      // Reverse edge for two-way stairs/ladders: from the upper floor (dz) back
      // down to z (dz = z - 1 for an up link, so the reverse is a "down").
      if (t === 1) add(dz, { sx: dx, sy: dy, toFloor: z, tx: x, ty: y, dir: 'down' })
    }
    edgesByFloor = m
  })()
  return linksPromise
}

// Per-floor navigation data: walkability grid, this floor's transport edges keyed
// by their (snapped) origin cell, and — on the surface — boat harbours by cell.
// Immutable and cached (reused across route computations).
type FloorNav = {
  fg: FloorGrid
  linkAt: Map<number, TEdge[]>
  portAt: Map<number, Port> | null
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
      const s = snapToWalkable(fg, e.sx - X_MIN, e.sy - Y_MIN, 6)
      if (!s) continue
      const idx = s.gy * fg.W + s.gx
      let arr = linkAt.get(idx)
      if (!arr) {
        arr = []
        linkAt.set(idx, arr)
      }
      arr.push(e)
    }
    let portAt: Map<number, Port> | null = null
    if (floor === 7) {
      portAt = new Map()
      for (const port of BOAT_PORTS) {
        const s = snapToWalkable(fg, port.x - X_MIN, port.y - Y_MIN, 60)
        if (s) portAt.set(s.gy * fg.W + s.gx, port)
      }
    }
    return { fg, linkAt, portAt }
  })()
  navCache.set(floor, p)
  return p
}

type Transport =
  | { kind: 'link'; e: TEdge }
  | { kind: 'boat'; fromPort: Port; toPort: Port }
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
  const gnav = await floorNav(goal.floor)
  const gs = snapToWalkable(gnav.fg, goal.x - X_MIN, goal.y - Y_MIN, 60)
  if (!gs) return null
  const goalIdx = gs.gy * gnav.fg.W + gs.gx

  const snav = await floorNav(start.floor)
  if (!snapToWalkable(snav.fg, start.x - X_MIN, start.y - Y_MIN, 60)) return null

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
  const info = new Map<string, { floor: number; x: number; y: number; transport: Transport | null; prevKey: string | null }>()
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
    // this cap — it's only a backstop against a pathological heap, set high enough
    // that long, winding mountain/desert routes (e.g. Ankrahmun→Darashia) resolve.
    if (regions++ > 15000) break

    const nav = await floorNav(cur.floor)
    const { fg } = nav
    const { grid, W, H } = fg
    const s = snapToWalkable(fg, cur.x - X_MIN, cur.y - Y_MIN, 60)
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
        const fromPort = nav.portAt.get(c0)
        if (fromPort) for (const toPort of BOAT_PORTS) if (toPort !== fromPort) relax(7, toPort.x, toPort.y, d, { kind: 'boat', fromPort, toPort })
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
    const n = info.get(ck)!
    chain.push({ floor: n.floor, x: n.x, y: n.y, transport: n.transport })
    ck = n.prevKey
  }
  chain.reverse()

  // Materialise legs: within each node's floor, walk from where we arrived to the
  // next transition's origin (or the goal on the last node), then the hop itself.
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
        : { x: nextTr!.fromPort.x, y: nextTr!.fromPort.y }

    const nav = await floorNav(node.floor)
    const path = findPath(nav.fg, entry, exit)
    if (path && path.length > 1) {
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
        })
      } else {
        const { fromPort, toPort } = nextTr!
        legs.push({
          kind: 'boat',
          from: { x: fromPort.x, y: fromPort.y },
          to: { x: toPort.x, y: toPort.y },
          fromName: fromPort.name,
          toName: toPort.name,
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
