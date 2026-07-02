// Bake the map-routing data straight from the game's own files, so "how to get
// there" moves exactly like the Tibia client's auto-walk: it respects water and
// walls and changes floors only through real stairs / holes / ladders / teleports.
//
//   node tools/otbm/bake-walk.mjs
//
// Inputs (local only, gitignored — never committed):
//   otservbr.otbm                 the world map (Canary v3.6.1 / client 15.11)
//   tools/otbm/appearances.dat    client item flags (protobuf) — source of `unpass`
//   tools/otbm/items.xml          item defs — doors / ladders / floorchange
//
// Outputs (committed, served to the browser):
//   frontend/public/walk/f<z>.bin per-floor walkability, 1 byte/tile (1=walk,
//                                 0=blocked), gzip-compressed (named .bin so no
//                                 server double-decompresses it; inflated at
//                                 runtime via DecompressionStream).
//   frontend/public/floor-links.json  every floor change as [x,y,z,dx,dy,dz,t]
//                                 (t: 0=down hole, 1=up stairs/ladder, 2=teleport),
//                                 destinations resolved the way the client resolves
//                                 them (stairs shift, down double-resolve).
//
// Walkability is the GAME'S rule, never the minimap colour: a tile is walkable iff
// it has a ground and carries no `unpass` item — except doors (auto-walk opens
// them) and floor-change tiles (you must be able to step onto a stair/hole). That
// is what makes water and walls hard barriers instead of the soft, colour-derived
// guesswork the previous version crossed.
import fs from 'fs'
import zlib from 'zlib'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OTBM = path.join(root, 'otservbr.otbm')
const APPEAR = path.join(root, 'tools', 'otbm', 'appearances.dat')
const ITEMS = path.join(root, 'tools', 'otbm', 'items.xml')
const WALK_DIR = path.join(root, 'frontend', 'public', 'walk')
const LINKS_OUT = path.join(root, 'frontend', 'public', 'floor-links.json')

// Covered region in Tibia world coordinates (mirrors the exported minimap tiles).
const X0 = 31744, X1 = 34304, Y0 = 30976, Y1 = 33024
const W = X1 - X0, H = Y1 - Y0

// --- 1. appearances.dat → the set of item ids that block walking (`unpass`) ------
// Protobuf: top-level field 1 = repeated Appearance { id=field1; flags=field3 };
// AppearanceFlags field 13 = unpass (present & truthy ⇒ blocks).
function loadUnpass() {
  const buf = fs.readFileSync(APPEAR)
  const rv = (pos) => { let s = 0, r = 0, b; do { b = buf[pos++]; r += (b & 0x7f) * 2 ** s; s += 7 } while (b & 0x80); return [r, pos] }
  const unpass = new Set()
  let pos = 0
  const end = buf.length
  while (pos < end) {
    let tag; [tag, pos] = rv(pos)
    const field = tag >>> 3, wire = tag & 7
    if (field === 1 && wire === 2) {
      let len; [len, pos] = rv(pos)
      const oEnd = pos + len
      let id = null, q = pos
      while (q < oEnd) {
        let t; [t, q] = rv(q)
        const f = t >>> 3, w = t & 7
        if (f === 1 && w === 0) { let v; [v, q] = rv(q); id = v }
        else if (f === 3 && w === 2) { // flags submessage
          let fl; [fl, q] = rv(q)
          const fEnd = q + fl
          let up = false, r = q
          while (r < fEnd) {
            let t2; [t2, r] = rv(r)
            const f2 = t2 >>> 3, w2 = t2 & 7
            if (f2 === 13 && w2 === 0) { let v; [v, r] = rv(r); if (v) up = true }
            else if (w2 === 0) { let v; [v, r] = rv(r) }
            else if (w2 === 2) { let l; [l, r] = rv(r); r += l }
            else if (w2 === 5) r += 4
            else if (w2 === 1) r += 8
            else break
          }
          q = fEnd
          if (id != null && up) unpass.add(id)
        } else {
          if (w === 0) { let v; [v, q] = rv(q) }
          else if (w === 2) { let l; [l, q] = rv(q); q += l }
          else if (w === 5) q += 4
          else if (w === 1) q += 8
          else break
        }
      }
      pos = oEnd
    } else {
      if (wire === 0) { let v; [v, pos] = rv(pos) }
      else if (wire === 2) { let l; [l, pos] = rv(pos); pos += l }
      else if (wire === 5) pos += 4
      else if (wire === 1) pos += 8
      else break
    }
  }
  return unpass
}

// --- 2. items.xml → doors, ladders, floorchange direction by item id ------------
function loadItems() {
  const xml = fs.readFileSync(ITEMS, 'utf8')
  const rows = []
  { const re = /<item\s+([^>]*?)>([\s\S]*?)<\/item>/g; let m; while ((m = re.exec(xml))) rows.push([m[1], m[2]]) }
  const expand = (attrs, fn) => {
    const id = attrs.match(/\bid="(\d+)"/), f = attrs.match(/\bfromid="(\d+)"/), t = attrs.match(/\btoid="(\d+)"/)
    if (id) fn(+id[1])
    else if (f && t) for (let i = +f[1]; i <= +t[1]; i++) fn(i)
  }
  const doors = new Set(), ladders = new Set(), fchange = new Map()
  for (const [a, b] of rows) {
    if (/key="type"\s+value="door"/.test(b)) expand(a, (i) => doors.add(i))
    if (/key="type"\s+value="ladder"/.test(b)) expand(a, (i) => ladders.add(i))
    const fc = b.match(/key="floorchange"\s+value="([^"]+)"/)
    if (fc) expand(a, (i) => fchange.set(i, fc[1]))
  }
  return { doors, ladders, fchange }
}

// --- 3. parse the OTBM → per-floor walkability + raw floor-change records --------
const NODE_START = 0xFE, NODE_END = 0xFF, ESCAPE = 0xFD
const T_TILE_AREA = 4, T_TILE = 5, T_ITEM = 6, T_HOUSETILE = 12
const A_TELE_DEST = 8, A_ITEM = 9, A_TILE_FLAGS = 3
// attribute byte → payload size, for scanning past item attributes we don't need.
const ATTR_1B = new Set([15, 22, 14]) // count / rune charges / house-door id
const ATTR_2B = new Set([4, 5, 10, 23]) // action id / unique id / depot id / charges
const ATTR_STR = new Set([1, 6, 7]) // description / text / written-text (u16 len + bytes)

function parseOtbm({ unpass, doors, ladders, fchange }) {
  const buf = fs.readFileSync(OTBM)
  let p = 0
  p += 4 // header: version u32

  const walk = Array.from({ length: 16 }, () => new Uint8Array(W * H))
  const raw = [] // { x, y, z, dir }  dir ∈ down/north/south/east/west/southalt/eastalt/ladder
  const teleports = [] // { x, y, z, dx, dy, dz }
  const dirAt = new Map() // "z:x:y" → dir, for the down double-resolve
  const kk = (x, y, z) => z + ':' + x + ':' + y

  let area = { x: 0, y: 0, z: 0 }
  let tile = null, blk = false, inb = false, fcDir = null, tele = null, hasGround = false, portal = false

  const readProps = () => {
    const out = []
    while (p < buf.length) {
      const b = buf[p]
      if (b === NODE_START || b === NODE_END) break
      p++
      out.push(b === ESCAPE ? buf[p++] : b)
    }
    return Buffer.from(out)
  }

  const commit = () => {
    if (!inb || !tile) return
    const i = (tile.y - Y0) * W + (tile.x - X0)
    const { x, y, z } = tile
    if (tele && !(tele.x === 0 && tele.y === 0)) { teleports.push({ x, y, z, dx: tele.x, dy: tele.y, dz: tele.z }); portal = true }
    if (fcDir) { raw.push({ x, y, z, dir: fcDir }); dirAt.set(kk(x, y, z), fcDir); portal = true }
    // Walkable = standable ground with nothing blocking, OR a floor-change/teleport
    // tile (you must be able to step onto a stair/hole/portal to use it).
    if ((!blk && hasGround) || portal) walk[z][i] = 1
  }

  const parseItem = (pr) => {
    if (pr.length < 2) return
    const id = pr.readUInt16LE(0)
    hasGround = true
    if (unpass.has(id) && !doors.has(id)) blk = true
    if (fchange.has(id)) fcDir = fchange.get(id)
    if (ladders.has(id)) fcDir = 'ladder'
    let q = 2
    while (q < pr.length) {
      const at = pr[q++]
      if (at === A_TELE_DEST) { if (q + 5 <= pr.length) tele = { x: pr.readUInt16LE(q), y: pr.readUInt16LE(q + 2), z: pr[q + 4] }; q += 5 }
      else if (ATTR_1B.has(at)) q += 1
      else if (ATTR_2B.has(at)) q += 2
      else if (ATTR_STR.has(at)) { if (q + 2 > pr.length) break; q += 2 + pr.readUInt16LE(q) }
      else break
    }
  }

  const node = () => {
    p++ // NODE_START
    const type = buf[p++]
    const pr = readProps()
    if (type === T_TILE_AREA) {
      area = { x: pr.readUInt16LE(0), y: pr.readUInt16LE(2), z: pr[4] }
    } else if (type === T_TILE || type === T_HOUSETILE) {
      commit()
      const x = area.x + pr[0], y = area.y + pr[1], z = area.z
      tile = { x, y, z }
      inb = z >= 0 && z < 16 && x >= X0 && x < X1 && y >= Y0 && y < Y1
      blk = false; fcDir = null; tele = null; hasGround = false; portal = false
      // Tile attributes: a ground item (A_ITEM) and/or tile flags precede children.
      let q = type === T_HOUSETILE ? 6 : 2 // HOUSETILE prefixes a u32 house id
      while (q < pr.length) {
        const at = pr[q++]
        if (at === A_ITEM) {
          if (q + 2 <= pr.length) {
            const gid = pr.readUInt16LE(q)
            hasGround = true
            if (unpass.has(gid) && !doors.has(gid)) blk = true
            if (fchange.has(gid)) fcDir = fchange.get(gid)
            if (ladders.has(gid)) fcDir = 'ladder'
          }
          q += 2
        } else if (at === A_TILE_FLAGS) q += 4
        else break
      }
    } else if (type === T_ITEM) {
      if (inb) parseItem(pr)
    }
    while (buf[p] === NODE_START) node()
    p++ // NODE_END
  }
  node()
  commit()

  return { walk, raw, teleports, dirAt, kk }
}

// --- 4. resolve floor changes into destination links ----------------------------
// Stepping onto a floor-change tile moves the player to another floor, shifted the
// way the client shifts them. Up stairs (north/south/east/west, + the 2-tile "alt"
// ramps) go up one floor toward the named side; a down hole goes down one floor and
// then, if it lands on a staircase, resolves one more step (the "double-resolve"
// that seats you at the foot of the stairs). Destinations are snapped to the nearest
// walkable tile at runtime, so a ±1 rounding never breaks a link.
const UP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], southalt: [0, 2], eastalt: [2, 0] }
const DN = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0], southalt: [0, -2], eastalt: [-2, 0] }

function resolveLinks({ raw, teleports, dirAt, kk }) {
  const links = []
  for (const { x, y, z, dir } of raw) {
    if (dir === 'down') {
      let dx = x, dy = y
      const dz = z + 1
      const below = dirAt.get(kk(x, y, dz))
      if (below && UP[below]) { const [ox, oy] = DN[below]; dx += ox; dy += oy }
      links.push([x, y, z, dx, dy, dz, 0])
    } else if (dir === 'ladder') {
      links.push([x, y, z, x, y, z - 1, 1])
    } else if (UP[dir]) {
      const [ox, oy] = UP[dir]
      links.push([x, y, z, x + ox, y + oy, z - 1, 1])
    }
  }
  for (const t of teleports) links.push([t.x, t.y, t.z, t.dx, t.dy, t.dz, 2])
  // Keep links whose origin is inside the covered region (destinations may leave it;
  // routing bounds-checks them).
  return links.filter(([x, y, z]) => z >= 0 && z < 16 && x >= X0 && x < X1 && y >= Y0 && y < Y1)
}

// --- run -------------------------------------------------------------------------
console.log('loading appearances.dat …')
const unpass = loadUnpass()
console.log('  unpass ids:', unpass.size)
const { doors, ladders, fchange } = loadItems()
console.log('  doors:', doors.size, '| ladders:', ladders.size, '| floorchange:', fchange.size)

console.log('parsing otservbr.otbm (184 MB, ~1 min) …')
const t0 = Date.now()
const parsed = parseOtbm({ unpass, doors, ladders, fchange })
console.log('  parsed in', ((Date.now() - t0) / 1000).toFixed(0) + 's')

const links = resolveLinks(parsed)
const byT = { 0: 0, 1: 0, 2: 0 }
for (const l of links) byT[l[6]]++
console.log('floor-links:', links.length, '| down:', byT[0], 'up:', byT[1], 'teleport:', byT[2])

fs.mkdirSync(WALK_DIR, { recursive: true })
for (const f of fs.readdirSync(WALK_DIR)) fs.unlinkSync(path.join(WALK_DIR, f))
let totalBytes = 0
for (let z = 0; z < 16; z++) {
  let n = 0
  for (let i = 0; i < W * H; i++) if (parsed.walk[z][i]) n++
  if (n === 0) continue
  const gz = zlib.gzipSync(Buffer.from(parsed.walk[z].buffer), { level: 9 })
  fs.writeFileSync(path.join(WALK_DIR, `f${z}.bin`), gz)
  totalBytes += gz.length
  process.stdout.write(`f${z}:${n} `)
}
console.log('\nwalk bitmaps:', (totalBytes / 1048576).toFixed(1) + 'MB gzipped')

fs.writeFileSync(LINKS_OUT, JSON.stringify(links))
console.log('wrote', path.relative(root, LINKS_OUT), '(' + links.length + ' links)')
console.log('wrote', path.relative(root, WALK_DIR))
