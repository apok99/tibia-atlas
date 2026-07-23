// Emit `frontend/public/blessings.json` — the optimised blessing pilgrimage.
//
//   node tools/gen-blessings.mjs
//
// Two tours: the classic FIVE (regular blessings) and all SEVEN (the five plus
// Heart and Blood of the Mountain). For each starting city the shrines are put in
// the order that walks the fewest tiles, solved exactly — seven stops is only
// 5040 orderings, so there is no need to approximate.
//
// Distances are real: a breadth-first search over the same baked walkability
// grids, floor links and boat lines the site's router uses (frontend/public/walk,
// floor-links.json), so an island shrine like Eremo's costs what the boat trip
// actually costs rather than a straight line across water.
//
// Data note: the shrine NPCs are read from the OT, but the blessing id alone is
// NOT trustworthy — several temple NPCs carry `bless = 6` while their text and
// price are plainly Twist of Fate (|PVPBLESSCOST|), a copy-paste slip in the
// distro. A grant only counts when its cost token is the regular |BLESSCOST|.
import fs from 'fs'
import zlib from 'zlib'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ot = path.join(root, 'ot', 'data-otservbr-global')
const outFile = path.join(root, 'frontend', 'public', 'blessings.json')

// --- the baked world (same constants as tools/otbm/verify-routes.mjs) ---------
const X0 = 31744, X1 = 34304, Y0 = 30976, Y1 = 33024
const W = X1 - X0, H = Y1 - Y0
const idx = (x, y) => (y - Y0) * W + (x - X0)
const inB = (x, y) => x >= X0 && x < X1 && y >= Y0 && y < Y1

const walk = {}
for (let z = 0; z < 16; z++) {
  const f = path.join(root, 'frontend/public/walk', `f${z}.bin`)
  walk[z] = fs.existsSync(f)
    ? new Uint8Array(zlib.gunzipSync(fs.readFileSync(f)).buffer)
    : new Uint8Array(W * H)
}
const links = JSON.parse(fs.readFileSync(path.join(root, 'frontend/public/floor-links.json'), 'utf8'))

// Harbours reachable from one another by ship, mirroring routing.ts's main line.
const PORTS = [
  ['Ab\'Dendriel', 32665, 31652], ['Ankrahmun', 33146, 32816], ['Carlin', 32343, 31792],
  ['Cormaya', 33307, 31999], ['Darashia', 33213, 32453], ['Edron', 33211, 31830],
  ['Farmine', 33030, 31500], ['Krailos', 33580, 31584], ['Liberty Bay', 32309, 32794],
  ['Oramond', 33607, 31955], ['Port Hope', 32629, 32769], ['Roshamuul', 33524, 32477],
  ['Svargrond', 32278, 31146], ['Thais', 32365, 32224], ['Venore', 32963, 32087],
  ['Yalahar', 32805, 31234],
]

function snap(z, x, y, R = 25) {
  if (z < 0 || z > 15 || !walk[z] || !inB(x, y)) return null
  if (walk[z][idx(x, y)]) return [x, y]
  for (let r = 1; r <= R; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
        const nx = x + dx, ny = y + dy
        if (inB(nx, ny) && walk[z][idx(nx, ny)]) return [nx, ny]
      }
    }
  }
  return null
}

// Floor links, forward and (for stairs/ladders) backward.
const BI = new Set([1]) // 1 = stairs/ladder, two-way; holes and teleports are one-way
const eFrom = new Map()
const push = (m, k, v) => {
  const a = m.get(k)
  if (a) a.push(v)
  else m.set(k, [v])
}
// Edges carry a cost: a stair is one step, a boat crossing is not. Mixing them at
// cost 1 made island shrines look almost free and reordered the whole tour.
for (const [x, y, z, dx, dy, dz, t] of links) {
  push(eFrom, `${z}:${x}:${y}`, [dx, dy, dz, 1])
  if (BI.has(t)) {
    const s = snap(dz, dx, dy, 6)
    if (s) push(eFrom, `${dz}:${s[0]}:${s[1]}`, [x, y, z, 1])
  }
}
const portCells = new Set()
for (const [, px, py] of PORTS) {
  const s = snap(7, px, py, 40)
  if (s) portCells.add(`7:${s[0]}:${s[1]}`)
}

/**
 * Two shrines sit in walkable pockets the baked graph cannot enter, so without
 * these edges no tour can ever complete. Both are documented, not invented:
 *
 *  - Eremo's island (a 121-tile islet) is served by the NPC Pemaret on Cormaya,
 *    who sails there for free — `addTravelKeyword("eremo", …, 0, Position(33314,
 *    31883, 7))` in the OT's own npc/pemaret.lua.
 *  - Nomad's ledge (144 tiles) has no boat at all; the client's own minimap
 *    marker at 31940,31307 reads "Levitate spot (to NPC Nomad)". It is modelled
 *    as an edge that carries a requirement, so the tour can say so out loud.
 */
const EXTRA = [
  { from: [33286, 31955, 6], to: [33314, 31883, 7], cost: 30, need: 'boat', note: 'Pemaret sails you free of charge' },
  { from: [33314, 31883, 7], to: [33286, 31955, 6], cost: 30, need: 'boat', note: 'Pemaret sails you free of charge' },
  { from: [31940, 31307, 7], to: [31940, 31306, 6], cost: 5, need: 'levitate', note: 'Levitate spot' },
  { from: [31940, 31306, 6], to: [31940, 31307, 7], cost: 5, need: 'levitate', note: 'Levitate spot' },
]
for (const e of EXTRA) {
  const s = snap(e.from[2], e.from[0], e.from[1], 12)
  if (!s) {
    console.log(`  EXTRA edge start not walkable: ${e.from}`)
    continue
  }
  push(eFrom, `${e.from[2]}:${s[0]}:${s[1]}`, [e.to[0], e.to[1], e.to[2], e.cost])
}

/**
 * Steps from one tile to every reachable tile, walking + stairs/holes/teleports +
 * ships. Returns a `dist(z,x,y)` reader; Infinity when unreachable.
 */
function stepsFrom(sz, sx, sy) {
  const dist = {}
  for (let z = 0; z < 16; z++) dist[z] = new Uint16Array(W * H) // 0 = unvisited
  const start = snap(sz, sx, sy, 30)
  if (!start) return null

  // Costs are small integers (1 walking step, 30 for a crossing), so Dial's
  // algorithm — one bucket per distance — gives exact shortest paths without a
  // heap. A plain FIFO queue would be wrong the moment edges stopped costing 1.
  const MAXC = 31
  const buckets = Array.from({ length: MAXC + 1 }, () => [])
  // Distances are stored +1 so that 0 can mean "unvisited" in a Uint16Array.
  dist[sz][idx(start[0], start[1])] = 1
  buckets[0].push([sz, start[0], start[1]])

  let done = 0
  for (let d0 = 0; done < 1 || d0 < 70000; d0++) {
    const b = buckets[d0 % (MAXC + 1)]
    if (!b.length) {
      // Nothing at this distance; stop once every bucket has drained.
      if (buckets.every((x) => !x.length)) break
      continue
    }
    const cur = b.splice(0, b.length)
    for (const [z, x, y] of cur) {
      const d = dist[z][idx(x, y)] - 1
      if (d !== d0) continue // stale entry, already improved
      done = 1
      const a = walk[z]
      const relax = (nz, nx, ny, w) => {
        const i = idx(nx, ny)
        const nd = d + w
        if (nd > 65000) return
        if (!dist[nz][i] || dist[nz][i] - 1 > nd) {
          dist[nz][i] = nd + 1
          buckets[(nd) % (MAXC + 1)].push([nz, nx, ny])
        }
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx, ny = y + dy
          if (inB(nx, ny) && a[idx(nx, ny)]) relax(z, nx, ny, 1)
        }
      }
      for (const [ex, ey, ez, w] of eFrom.get(`${z}:${x}:${y}`) ?? []) {
        const sn = snap(ez, ex, ey, 10)
        if (sn) relax(ez, sn[0], sn[1], w)
      }
      // Boarding a ship: every harbour reaches every other. A flat 30 so the tour
      // prefers a short walk over sailing, but still sails when it truly helps.
      if (z === 7 && portCells.has(`7:${x}:${y}`)) {
        for (const [, px, py] of PORTS) {
          const sn = snap(7, px, py, 40)
          if (sn) relax(7, sn[0], sn[1], 30)
        }
      }
    }
  }

  return (gz, gx, gy) => {
    const g = snap(gz, gx, gy, 20)
    if (!g) return Infinity
    const v = dist[gz][idx(g[0], g[1])]
    return v ? v - 1 : Infinity
  }
}

// --- the shrines --------------------------------------------------------------
const BLESS_NAMES = {
  2: 'The Wisdom of Solitude',
  3: 'The Spark of the Phoenix',
  4: 'The Fire of the Suns',
  5: 'The Spiritual Shielding',
  6: 'The Embrace of Tibia',
  7: 'Heart of the Mountain',
  8: 'Blood of the Mountain',
}

const xml = fs.readFileSync(path.join(ot, 'world', 'otservbr-npc.xml'), 'utf8')
const placements = new Map()
for (const block of xml.matchAll(/<npc\b([^>]*)>([\s\S]*?)<\/npc>/g)) {
  const cx = +(block[1].match(/centerx="(\d+)"/)?.[1] ?? NaN)
  const cy = +(block[1].match(/centery="(\d+)"/)?.[1] ?? NaN)
  const cz = +(block[1].match(/centerz="(\d+)"/)?.[1] ?? NaN)
  if (!Number.isFinite(cx)) continue
  for (const one of block[2].matchAll(/<npc\b[^>]*\/>/g)) {
    const name = one[0].match(/name="([^"]+)"/)?.[1]
    if (!name) continue
    placements.set(name.toLowerCase(), {
      x: cx + +(one[0].match(/\sx="(-?\d+)"/)?.[1] ?? 0),
      y: cy + +(one[0].match(/\sy="(-?\d+)"/)?.[1] ?? 0),
      z: +(one[0].match(/\sz="(-?\d+)"/)?.[1] ?? cz),
    })
  }
}

const shrines = []
for (const f of fs.readdirSync(path.join(ot, 'npc'))) {
  if (!f.endsWith('.lua')) continue
  const src = fs.readFileSync(path.join(ot, 'npc', f), 'utf8')
  if (!src.includes('StdModule.bless')) continue
  const npc = src.match(/local internalNpcName\s*=\s*"([^"]+)"/)?.[1]
  if (!npc) continue
  for (const m of src.matchAll(/StdModule\.bless\s*,\s*\{([^}]*)\}/g)) {
    const body = m[1]
    const id = +(body.match(/bless\s*=\s*(\d+)/)?.[1] ?? 0)
    // PvP-priced grants are Twist of Fate whatever id they claim.
    if (/PVPBLESSCOST/.test(body)) continue
    if (!BLESS_NAMES[id]) continue
    const at = placements.get(npc.toLowerCase())
    if (!at) continue
    if (shrines.some((s) => s.id === id)) continue
    shrines.push({ id, name: BLESS_NAMES[id], npc, ...at })
  }
}
shrines.sort((a, b) => a.id - b.id)

// Where a pilgrimage realistically starts: the big city temples.
const STARTS = [
  ['Thais', 32369, 32241, 7], ['Carlin', 32360, 31782, 7], ['Ab\'Dendriel', 32732, 31634, 7],
  ['Venore', 32957, 32076, 7], ['Kazordoon', 32649, 31925, 11], ['Edron', 33217, 31814, 8],
  ['Ankrahmun', 33194, 32853, 7], ['Darashia', 33213, 32454, 1], ['Liberty Bay', 32285, 32892, 7],
  ['Port Hope', 32596, 32744, 7], ['Svargrond', 32212, 31132, 7], ['Yalahar', 32787, 31276, 7],
]

// --- distances ----------------------------------------------------------------
const nodes = [
  ...STARTS.map(([name, x, y, z]) => ({ key: `start:${name}`, x, y, z })),
  ...shrines.map((s) => ({ key: `bless:${s.id}`, x: s.x, y: s.y, z: s.z })),
]

console.log(`Flooding from ${nodes.length} points…`)
const dist = new Map()
for (const from of nodes) {
  const reader = stepsFrom(from.z, from.x, from.y)
  if (!reader) {
    console.log(`  ${from.key}: NOT ON WALKABLE GROUND`)
    continue
  }
  for (const to of nodes) {
    if (to.key === from.key) continue
    dist.set(`${from.key}|${to.key}`, reader(to.z, to.x, to.y))
  }
  process.stdout.write('.')
}
console.log()

const D = (a, b) => dist.get(`${a}|${b}`) ?? Infinity

// Which shrines can actually be reached from a normal starting temple? A tour is
// only as good as its worst link, so an unreachable shrine has to be visible.
for (const s of shrines) {
  const from = STARTS.map(([n]) => `${D(`start:${n}`, `bless:${s.id}`)}`).join(' ')
  console.log(`  reach #${s.id} ${s.npc.padEnd(10)} from starts: ${from}`)
}

/** Exact open-tour TSP: visit every shrine once, starting at `start`. */
function bestOrder(start, ids) {
  let best = null
  const permute = (rest, acc, cost) => {
    if (best && cost >= best.cost) return
    if (!rest.length) {
      if (!best || cost < best.cost) best = { order: acc.slice(), cost }
      return
    }
    for (let i = 0; i < rest.length; i++) {
      const next = rest[i]
      const step = D(acc.length ? `bless:${acc[acc.length - 1]}` : start, `bless:${next}`)
      if (!Number.isFinite(step)) continue
      acc.push(next)
      permute(rest.filter((_, k) => k !== i), acc, cost + step)
      acc.pop()
    }
  }
  permute(ids, [], 0)
  return best
}

const FIVE = [2, 3, 4, 5, 6]
const SEVEN = [2, 3, 4, 5, 6, 7, 8]

const tours = []
for (const [name, x, y, z] of STARTS) {
  const key = `start:${name}`
  for (const [label, ids] of [['five', FIVE], ['seven', SEVEN]]) {
    const best = bestOrder(key, ids)
    if (!best) {
      console.log(`  ${name}/${label}: no complete tour (a shrine is unreachable)`)
      continue
    }
    const legs = []
    let prev = key
    for (const id of best.order) {
      legs.push({ to: id, steps: D(prev, `bless:${id}`) })
      prev = `bless:${id}`
    }
    tours.push({ start: { name, x, y, z }, set: label, order: best.order, legs, steps: best.cost })
  }
}

fs.writeFileSync(
  outFile,
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), shrines, tours }) + '\n'
)

console.log(`blessings.json: ${shrines.length} shrines, ${tours.length} tours`)
for (const s of shrines) console.log(`  #${s.id} ${s.name} — ${s.npc} @ ${s.x},${s.y},${s.z}`)
for (const t of tours.filter((t) => t.start.name === 'Thais')) {
  console.log(`  Thais/${t.set}: ${t.steps} steps — ${t.order.map((i) => BLESS_NAMES[i]).join(' → ')}`)
}
