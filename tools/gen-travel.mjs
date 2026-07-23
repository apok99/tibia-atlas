// Parse the OT server's NPC travel offers and emit `frontend/public/travel.json`
// — the "Red de viajes" map layer: every boat, carpet, sled and steamboat you can
// pay to board, with the real destination tile and the real price in gold.
//
//   node tools/gen-travel.mjs
//
// Two things have to be joined:
//   * data-otservbr-global/npc/*.lua   — who sells passage, to where, for how much
//   * data-otservbr-global/world/otservbr-npc.xml — where that NPC actually stands
//
// Parsing note: `addTravelKeyword` is a LOCAL helper redefined in every NPC file,
// so its signature is not stable — these are all real calls:
//
//   addTravelKeyword("carlin", 110, Position(32387, 31820, 6))
//   addTravelKeyword("ab'dendriel", Position(32734, 31668, 6))          -- free
//   addTravelKeyword("banuta", nil, 30, Position(32826, 32631, 7), true)
//   addTravelKeyword("cormaya", { "<text>", ... }, 200, "postman", Position(...))
//   addTravelKeyword("vega", 20, { x = 32020, y = 31692, z = 7 })
//
// So arguments are never read by POSITION. Each call is scanned for what it
// contains: the first string is the destination keyword, the first coordinate
// triple is the drop-off tile, and the price is the first bare integer left once
// strings, tables and Position(...) are masked out.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const otDir = path.join(root, 'ot', 'data-otservbr-global')
const outFile = path.join(root, 'frontend', 'public', 'travel.json')

// Coordinates outside the real world map are script artefacts (test rooms).
const X_MIN = 30000, X_MAX = 34500, Y_MIN = 30500, Y_MAX = 33500, Z_MAX = 15
const inWorld = (x, y, z) => x >= X_MIN && x <= X_MAX && y >= Y_MIN && y <= Y_MAX && z >= 0 && z <= Z_MAX

const MINOR = new Set(['the', 'of', 'and', 'a'])
const titleCase = (s) =>
  s
    .split(/\s+/)
    .map((w, i) => (i > 0 && MINOR.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    // Tibian place names capitalise after an apostrophe ("ab'dendriel" ->
    // "Ab'Dendriel"); a trailing possessive "'s" must not be touched.
    .replace(/'(\w{2,})/g, (_, rest) => "'" + rest.charAt(0).toUpperCase() + rest.slice(1))

/**
 * Dialogue keywords that are aliases, not place names ("passage", "centre",
 * "help"). They stay usable as a last-resort label, but any real place name
 * offered for the same drop-off tile wins.
 */
const GENERIC = new Set([
  'help', 'trade', 'transportation', 'passage', 'passages', 'center', 'centre',
  'east', 'west', 'north', 'south', 'hills', 'mountain', 'mountain pass',
  'factory', 'nostalgia', 'eclipse', 'camp', 'tibia', 'back', 'city', 'town',
])

/** Text of the balanced (...) group that starts at `open` (index of the "("). */
function balanced(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'") {
      // Skip the whole string literal so brackets inside text never count.
      const quote = c
      i++
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

/** First `Position(x, y, z)` or `{ x = .., y = .., z = .. }` in a chunk of Lua. */
function findCoords(text) {
  const pos = text.match(/Position\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
  if (pos) return { x: +pos[1], y: +pos[2], z: +pos[3] }
  const tbl = text.match(/\{\s*x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\s*,\s*z\s*=\s*(\d+)\s*\}/)
  if (tbl) return { x: +tbl[1], y: +tbl[2], z: +tbl[3] }
  return null
}

/**
 * The price: the first standalone integer once every string literal, table
 * constructor and Position(...) has been blanked out, so coordinates and text can
 * never be mistaken for gold. No integer left means the ride is free.
 */
function findCost(text) {
  const masked = text
    .replace(/Position\([^)]*\)/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
  const m = masked.match(/(?:^|[\s,(])(\d+)(?=[\s,)]|$)/)
  return m ? +m[1] : 0
}

/** First string literal in a chunk of Lua — the destination keyword. */
function findKeyword(text) {
  const m = text.match(/"((?:[^"\\]|\\.)*)"/)
  return m ? m[1] : null
}

// --- where every NPC stands ---------------------------------------------------
// Same centre+offset shape as the monster spawn file. An NPC can be placed more
// than once (guards, ferrymen with two docks); every placement is kept so a
// two-dock sailor gets a pin at each end.
function npcPlacements(file) {
  const xml = fs.readFileSync(file, 'utf8')
  const byName = new Map()
  for (const block of xml.matchAll(/<npc\b([^>]*)>([\s\S]*?)<\/npc>/g)) {
    const head = block[1]
    const cx = +(head.match(/centerx="(\d+)"/)?.[1] ?? NaN)
    const cy = +(head.match(/centery="(\d+)"/)?.[1] ?? NaN)
    const cz = +(head.match(/centerz="(\d+)"/)?.[1] ?? NaN)
    if (!Number.isFinite(cx)) continue
    for (const one of block[2].matchAll(/<npc\b[^>]*\/>/g)) {
      const tag = one[0]
      const name = tag.match(/name="([^"]+)"/)?.[1]
      if (!name) continue
      const x = cx + +(tag.match(/\sx="(-?\d+)"/)?.[1] ?? 0)
      const y = cy + +(tag.match(/\sy="(-?\d+)"/)?.[1] ?? 0)
      const z = +(tag.match(/\sz="(-?\d+)"/)?.[1] ?? cz)
      if (!inWorld(x, y, z)) continue
      const key = name.toLowerCase()
      const list = byName.get(key) ?? []
      if (!list.some((p) => p.x === x && p.y === y && p.z === z)) list.push({ x, y, z })
      byName.set(key, list)
    }
  }
  return byName
}
const PLACEMENTS = npcPlacements(path.join(otDir, 'world', 'otservbr-npc.xml'))

// --- travel offers per NPC ----------------------------------------------------
function luaFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...luaFiles(f))
    else if (f.endsWith('.lua')) out.push(f)
  }
  return out
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Where THIS file's NPC stands. Ferrymen who work several docks are one lua per
 * dock, all declaring the same `internalNpcName`, while the world file tells them
 * apart with a suffix — `buddel_helheim.lua` is the "Buddel (Helheim)" placement.
 * Matching the file's suffix to the placement's keeps each dock's own routes
 * instead of smearing five docks into one pin.
 */
function placementsFor(name, file) {
  const base = slug(name)
  const want = slug(path.basename(file, '.lua')).startsWith(base)
    ? slug(path.basename(file, '.lua')).slice(base.length)
    : ''

  const variants = []
  for (const [key, at] of PLACEMENTS) {
    if (!slug(key).startsWith(base)) continue
    variants.push({ suffix: slug(key).slice(base.length), at })
  }
  if (!variants.length) return []

  const exact = variants.find((v) => v.suffix === want)
  if (exact) return exact.at
  // No suffixed placement matches: a lone lua takes every placement of the name
  // (guards and shopkeepers standing in several towns).
  return want === '' ? variants.flatMap((v) => v.at) : []
}

const npcs = []
const skipped = []

for (const file of luaFiles(path.join(otDir, 'npc'))) {
  const src = fs.readFileSync(file, 'utf8')
  const name =
    src.match(/local internalNpcName\s*=\s*"([^"]+)"/)?.[1] ??
    src.match(/createNpcType\("([^"]+)"\)/)?.[1]
  if (!name) continue

  /** @type {Map<string, {to: string, x: number, y: number, z: number, cost: number}>} */
  const offers = new Map()
  // Keyed by DROP-OFF TILE, not by keyword: one NPC often takes several words for
  // the same ride ("center"/"centre", "kazor"/"kazordoon"), and that is one route,
  // not three. The cheapest price wins (discounted variants are still the price a
  // player can pay) and the most place-like keyword becomes the label.
  const addOffer = (keyword, coords, cost) => {
    if (!coords || !inWorld(coords.x, coords.y, coords.z)) return false
    const word = (keyword ?? '').replace(/[_-]+/g, ' ').trim()
    if (!word) return false
    const to = titleCase(word)
    const generic = GENERIC.has(word.toLowerCase())

    const key = `${coords.x},${coords.y},${coords.z}`
    const prev = offers.get(key)
    if (!prev) {
      offers.set(key, { to, ...coords, cost, generic })
      return true
    }
    if (cost < prev.cost) prev.cost = cost
    if (prev.generic && !generic) {
      prev.to = to
      prev.generic = false
    }
    return true
  }

  // 1) The per-file `addTravelKeyword(...)` helper (the bulk of the data).
  for (const m of src.matchAll(/addTravelKeyword\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const args = balanced(src, open)
    if (args === null) continue
    // The helper's own definition, not a call.
    if (/^\s*keyword\s*,/.test(args)) continue
    const coords = findCoords(args)
    if (!coords) {
      skipped.push(`${name}: "${findKeyword(args) ?? '?'}" has no destination tile`)
      continue
    }
    addOffer(findKeyword(args), coords, findCost(args))
  }

  // 2) NPCs that wire StdModule.travel by hand, with cost + destination in the
  //    same option table.
  for (const m of src.matchAll(/StdModule\.travel\s*,\s*\{/g)) {
    const open = m.index + m[0].length - 1
    // Re-use the balanced scanner on braces by finding the matching "}".
    let depth = 0
    let end = -1
    for (let i = open; i < src.length; i++) {
      const c = src[i]
      if (c === '"') {
        i++
        while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) continue
    const args = src.slice(open, end + 1)
    const coords = findCoords(args)
    if (!coords) continue
    const cost = +(args.match(/\bcost\s*=\s*(\d+)/)?.[1] ?? 0)
    // These tables carry no destination NAME, only a tile. Label them by the
    // town the tile belongs to later; for now use the raw keyword if the
    // surrounding keyword call had one.
    const before = src.slice(Math.max(0, open - 400), open)
    const kw = [...before.matchAll(/addKeyword\(\s*\{\s*"([^"]+)"/g)].pop()?.[1]
    addOffer(kw ?? null, coords, cost)
  }

  if (!offers.size) continue

  const from = placementsFor(name, file)
  if (!from.length) {
    skipped.push(`${name} (${path.basename(file)}): sells ${offers.size} passages but is never placed in the world`)
    continue
  }

  // Kind drives the pin icon: the OT tags real sailors, the rest are carpets,
  // sleds, minecarts and the like.
  const profession = src.match(/profession\s*=\s*"([^"]+)"/)?.[1] ?? null
  const kind = profession === 'sailor' ? 'boat' : 'other'

  npcs.push({
    name,
    kind,
    at: from,
    routes: [...offers.values()]
      .map(({ to, x, y, z, cost }) => ({ to, x, y, z, cost }))
      .sort((p, q) => p.to.localeCompare(q.to)),
  })
}

npcs.sort((a, b) => a.name.localeCompare(b.name))

// --- the fare graph -----------------------------------------------------------
//
// Boarding a second ship means walking from where the first one dropped you to
// the next captain, who is always a few steps away on the same quay. So docks and
// drop-off tiles that sit close together are collapsed into one PLACE, and the
// paid rides become edges between places. That is what makes "Thais -> Yalahar,
// cheapest fare" answerable, transfers included.
//
// The layer never claims the walk is free of obstacles — it is a fare model, not
// a pathfinder; "Cómo llegar" remains the tool that walks you there.
const NEAR = 50 // tiles; a quay is far smaller than the gap between towns
const FLOOR_SLACK = 2 // harbour NPCs stand a floor or two off their drop-off tile

const points = []
const addPoint = (x, y, z, label, generic) => {
  points.push({ x, y, z, label, generic })
  return points.length - 1
}

const npcPoint = new Map() // npc index -> point ids of its docks
for (let i = 0; i < npcs.length; i++) {
  npcPoint.set(
    i,
    npcs[i].at.map((p) => addPoint(p.x, p.y, p.z, npcs[i].name, true))
  )
}
const routePoint = new Map() // "npcIdx:routeIdx" -> point id
for (let i = 0; i < npcs.length; i++) {
  npcs[i].routes.forEach((r, k) => {
    routePoint.set(`${i}:${k}`, addPoint(r.x, r.y, r.z, r.to, GENERIC.has(r.to.toLowerCase())))
  })
}

// Union-find over "close enough to walk between".
const parent = points.map((_, i) => i)
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
const union = (a, b) => {
  const ra = find(a)
  const rb = find(b)
  if (ra !== rb) parent[ra] = rb
}
for (let i = 0; i < points.length; i++) {
  for (let k = i + 1; k < points.length; k++) {
    const a = points[i]
    const b = points[k]
    if (Math.abs(a.z - b.z) > FLOOR_SLACK) continue
    if (Math.abs(a.x - b.x) > NEAR || Math.abs(a.y - b.y) > NEAR) continue
    union(i, k)
  }
}

// A city has several quays too far apart to cluster by distance — Thais alone has
// the main harbour, the Fibula ferry and the guild dock — yet walking between
// them is trivial, and a fare from "Thais" must not depend on which one you
// picked. So tiles that NAME the same place are merged, bounded by a city-sized
// radius so two unrelated "Camp"s can never join. Generic keywords are excluded.
const SAME_PLACE = 250
const byLabel = new Map()
for (let i = 0; i < points.length; i++) {
  if (points[i].generic) continue
  const list = byLabel.get(points[i].label) ?? []
  list.push(i)
  byLabel.set(points[i].label, list)
}
for (const list of byLabel.values()) {
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const p = points[list[a]]
      const q = points[list[b]]
      if (Math.abs(p.x - q.x) <= SAME_PLACE && Math.abs(p.y - q.y) <= SAME_PLACE) {
        union(list[a], list[b])
      }
    }
  }
}

// One place per cluster, named by the most frequent real place label pointing at
// it (an NPC's own name is only a fallback, so a quay is "Thais", not "Captain
// Bluebear"). Its coordinates are the cluster's centre.
const clusters = new Map()
for (let i = 0; i < points.length; i++) {
  const root = find(i)
  const c = clusters.get(root) ?? { members: [] }
  c.members.push(i)
  clusters.set(root, c)
}

const placeOf = new Map() // point id -> place id
const places = []
for (const [, c] of clusters) {
  const votes = new Map()
  for (const i of c.members) {
    const p = points[i]
    // A real destination name outvotes any number of NPC names.
    const weight = p.generic ? 1 : 100
    votes.set(p.label, (votes.get(p.label) ?? 0) + weight)
  }
  const name = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
  const id = places.length
  const xs = c.members.map((i) => points[i].x)
  const ys = c.members.map((i) => points[i].y)
  const zs = c.members.map((i) => points[i].z)
  places.push({
    id,
    name,
    x: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
    y: Math.round(ys.reduce((a, b) => a + b, 0) / ys.length),
    z: zs.sort((a, b) => a - b)[Math.floor(zs.length / 2)],
  })
  for (const i of c.members) placeOf.set(i, id)
}

const edges = []
for (let i = 0; i < npcs.length; i++) {
  const docks = npcPoint.get(i).map((p) => placeOf.get(p))
  npcs[i].routes.forEach((r, k) => {
    const to = placeOf.get(routePoint.get(`${i}:${k}`))
    for (const from of new Set(docks)) {
      if (from === to) continue // the NPC offering a ride back to its own quay
      edges.push({ from, to, npc: npcs[i].name, cost: r.cost })
    }
  })
  // Remember which place each NPC works from, for the layer's panel.
  npcs[i].place = placeOf.get(npcPoint.get(i)[0])
}

const routeCount = npcs.reduce((n, p) => n + p.routes.length, 0)
fs.writeFileSync(
  outFile,
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), npcs, places, edges }) + '\n'
)
console.log(`  ${places.length} places, ${edges.length} fare edges`)

console.log(`travel.json: ${npcs.length} NPCs, ${routeCount} passages`)
console.log(`  free rides: ${npcs.reduce((n, p) => n + p.routes.filter((r) => !r.cost).length, 0)}`)
if (skipped.length) {
  console.log(`  ${skipped.length} skipped:`)
  for (const s of skipped) console.log(`   - ${s}`)
}
