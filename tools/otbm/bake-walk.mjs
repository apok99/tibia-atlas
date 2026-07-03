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
import { PNG } from 'pngjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OTBM = path.join(root, 'otservbr.otbm')
const APPEAR = path.join(root, 'tools', 'otbm', 'appearances.dat')
const ITEMS = path.join(root, 'tools', 'otbm', 'items.xml')
const WPC_DIR = path.join(root, 'minimap') // Minimap_WaypointCost_<x>_<y>_<z>.png (local export)
const TIBIAMAPS_DIR = path.join(root, 'tools', 'otbm', 'tibiamaps') // floor-XX-path.png (community-complete)
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
  // NB: self-closing <item …/> rows MUST be matched as bodyless. A naive
  // `<item …>(body)</item>` regex swallows everything from a self-closing row to
  // the NEXT closing tag, so whole wall/window id-ranges stole the floorchange /
  // type=door attributes of the following item — baking thousands of phantom
  // stairs (routes climbing through wall columns) and ghost doors.
  { const re = /<item\b([^>]*?)\/>|<item\b([^>]*?)>([\s\S]*?)<\/item>/g; let m; while ((m = re.exec(xml))) rows.push(m[1] !== undefined ? [m[1], ''] : [m[2], m[3]]) }
  const expand = (attrs, fn) => {
    const id = attrs.match(/\bid="(\d+)"/), f = attrs.match(/\bfromid="(\d+)"/), t = attrs.match(/\btoid="(\d+)"/)
    if (id) fn(+id[1])
    else if (f && t) for (let i = +f[1]; i <= +t[1]; i++) fn(i)
  }
  const doors = new Set(), ladders = new Set(), fchange = new Map(), useDown = new Set(), ropeUp = new Set(), shovelDown = new Set()
  // type="door" is NOT sufficient: items.xml marks every "operable" wall fixture
  // as a door — windows, wall segments, tables, statues, torches… Whitelisting all
  // of them pierced house walls (routes walked through window tiles). A door is a
  // passage only if its NAME says so.
  const DOOR_NAMES = /^(closed door|open door|door|gate of expertise|entrance|closed gate|open gate|closed fence gate|open fence gate)$/
  for (const [a, b] of rows) {
    if (/key="type"\s+value="door"/.test(b)) {
      const nm = a.match(/\bname="([^"]*)"/)
      if (nm && DOOR_NAMES.test(nm[1].toLowerCase())) expand(a, (i) => doors.add(i))
    }
    if (/key="type"\s+value="ladder"/.test(b)) expand(a, (i) => ladders.add(i))
    const fc = b.match(/key="floorchange"\s+value="([^"]+)"/)
    if (fc) expand(a, (i) => fchange.set(i, fc[1]))
    // USE-driven floor changes carry no floorchange attribute — the server scripts
    // them. items.xml still categorises them: primarytype "dropdowns" = things you
    // use to go DOWN (sewer grates, closed trapdoors, large holes, the grille),
    // and the odd "stairs"-category item without a floorchange (mushroom corkscrew
    // stairs) goes UP like a ladder.
    if (!fc) {
      if (/key="primarytype"\s+value="dropdowns"/.test(b)) expand(a, (i) => useDown.add(i))
      else if (/key="primarytype"\s+value="stairs"/.test(b) && !/key="type"\s+value="ladder"/.test(b)) expand(a, (i) => ladders.add(i))
      else {
        // Shovel spots: a "stone pile" GROUND that digging turns into an open
        // hole (593→594, 606→607…). The map stores only the pile, so without
        // this rule whole cave systems have no entrance (e.g. the Ghostlands
        // entrance cave at 32218,31767 the wiki documents). Decorative piles
        // with no cave below get dropped by link-destination validation.
        const nm = a.match(/\bname="([^"]*)"/)
        if (nm && /^(stone pile|loose stone pile)$/.test(nm[1].toLowerCase())) expand(a, (i) => shovelDown.add(i))
      }
    }
    // Rope spots: grounds described as "There is a hole in the ceiling." (the
    // canonical rope-spot text on all 11 surface variants — dirt, grass, mud,
    // snow, ocean floor…). Using a rope lifts you to (x, y+1, z-1). Without
    // these, cave systems whose only exit/entry pairing is dig-down + rope-up
    // (e.g. the Ghostlands entrance cave) stay severed.
    if (/key="description"\s+value="There is a hole in the ceiling\."/.test(b)) expand(a, (i) => ropeUp.add(i))
  }
  // City gates (Yalahar quarters, Edron, Vengoth, outer walls…) are named "gate"
  // but carry no type="door" in items.xml, so the door rule above misses them and
  // whole city quarters bake as sealed. Worse, this map stacks the gate item ON
  // TOP of an unpass wall item on the same tile (the wall is the archway), so
  // whitelisting the gate id alone isn't enough — the tile needs a full override.
  // Kept as a separate set from doors: doors only exempt their own id (a "window"
  // can be type=door and must NOT unblock its wall tile), gates unblock the tile.
  // This pass also catches self-closing <item …/> rows the paired regex misses.
  const gates = new Set()
  { const re = /<item\s+([^>]*?)\/?>/g; let m; while ((m = re.exec(xml))) if (/\bname="gate"/i.test(m[1])) expand(m[1], (i) => gates.add(i)) }
  return { doors, ladders, fchange, gates, useDown, ropeUp, shovelDown }
}

// --- 3. parse the OTBM → per-floor walkability + raw floor-change records --------
const NODE_START = 0xFE, NODE_END = 0xFF, ESCAPE = 0xFD
const T_TILE_AREA = 4, T_TILE = 5, T_ITEM = 6, T_HOUSETILE = 12
const A_TELE_DEST = 8, A_ITEM = 9, A_TILE_FLAGS = 3
// attribute byte → payload size, for scanning past item attributes we don't need.
const ATTR_1B = new Set([15, 22, 14]) // count / rune charges / house-door id
const ATTR_2B = new Set([4, 5, 10, 23]) // action id / unique id / depot id / charges
const ATTR_STR = new Set([1, 6, 7]) // description / text / written-text (u16 len + bytes)

function parseOtbm({ unpass, doors, ladders, fchange, gates, useDown, ropeUp, shovelDown }) {
  const buf = fs.readFileSync(OTBM)
  let p = 0
  p += 4 // header: version u32

  const walk = Array.from({ length: 16 }, () => new Uint8Array(W * H))
  const raw = [] // { x, y, z, dir }  dir ∈ down/north/south/east/west/southalt/eastalt/ladder
  const teleports = [] // { x, y, z, dx, dy, dz }
  const doorTiles = [] // { x, y, z } — tiles carrying a door/gate (auto-walk opens them)
  const dirAt = new Map() // "z:x:y" → dir, for the down double-resolve
  const kk = (x, y, z) => z + ':' + x + ':' + y

  let area = { x: 0, y: 0, z: 0 }
  // Blocking is tracked separately for the ground and for stacked items: a cave
  // hole is standable although its GROUND is unpass mountain (you step onto the
  // hole), but a floor-change tile carrying an unpass ITEM (wall, statue) is NOT
  // — treating those as portals let routes walk through wall columns.
  let tile = null, blkGround = false, blkItem = false, inb = false, fcDir = null, tele = null, hasGround = false, portal = false, hasGate = false, hasDoor = false

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
    // Floor-change/teleport records are only emitted for tiles you could actually
    // stand on — a "portal" buried under an unpass item is decoration/noise.
    if (!blkItem) {
      if (tele && !(tele.x === 0 && tele.y === 0)) { teleports.push({ x, y, z, dx: tele.x, dy: tele.y, dz: tele.z }); portal = true }
      if (fcDir) { raw.push({ x, y, z, dir: fcDir }); dirAt.set(kk(x, y, z), fcDir); portal = true }
    }
    if ((hasDoor || hasGate) && hasGround && !blkGround) doorTiles.push({ x, y, z })
    // Walkable = standable ground with nothing blocking, OR a floor-change/teleport
    // tile with no blocking item (you step onto a stair/hole even on unpass cave
    // ground), OR a city-gate tile — gates stack on an unpass wall item (the
    // archway), so a gate ignores stacked items (auto-walk opens it like a door)
    // but still needs standable ground.
    if ((!blkGround && !blkItem && hasGround) || portal || (hasGate && hasGround && !blkGround)) walk[z][i] = 1
  }

  const parseItem = (pr) => {
    if (pr.length < 2) return
    const id = pr.readUInt16LE(0)
    hasGround = true
    if (unpass.has(id) && !doors.has(id) && !gates.has(id) && !useDown.has(id) && !shovelDown.has(id)) blkItem = true
    if (gates.has(id)) hasGate = true
    if (doors.has(id) && unpass.has(id)) hasDoor = true
    if (fchange.has(id)) fcDir = fchange.get(id)
    if (ladders.has(id)) fcDir = 'ladder'
    if (useDown.has(id)) fcDir = 'down'
    if (shovelDown.has(id)) fcDir = 'shoveldown'
    if (ropeUp.has(id)) fcDir = 'ropeup'
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
      blkGround = false; blkItem = false; fcDir = null; tele = null; hasGround = false; portal = false; hasGate = false; hasDoor = false
      // Tile attributes: a ground item (A_ITEM) and/or tile flags precede children.
      let q = type === T_HOUSETILE ? 6 : 2 // HOUSETILE prefixes a u32 house id
      while (q < pr.length) {
        const at = pr[q++]
        if (at === A_ITEM) {
          if (q + 2 <= pr.length) {
            const gid = pr.readUInt16LE(q)
            hasGround = true
            if (unpass.has(gid) && !doors.has(gid) && !gates.has(gid) && !useDown.has(gid) && !shovelDown.has(gid)) blkGround = true
            if (gates.has(gid)) hasGate = true
            if (fchange.has(gid)) fcDir = fchange.get(gid)
            if (ladders.has(gid)) fcDir = 'ladder'
            if (useDown.has(gid)) fcDir = 'down'
            if (shovelDown.has(gid)) fcDir = 'shoveldown'
            if (ropeUp.has(gid)) fcDir = 'ropeup'
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

  return { walk, raw, teleports, doorTiles, dirAt, kk }
}

// --- 4. resolve floor changes into destination links ----------------------------
// Stepping onto a floor-change tile moves the player to another floor, shifted the
// way the client shifts them. Up stairs (north/south/east/west, + the 2-tile "alt"
// ramps) go up one floor toward the named side; a down hole goes down one floor and
// then, if it lands on a staircase, resolves one more step (the "double-resolve"
// that seats you at the foot of the stairs). Destinations are validated against the
// baked walkability afterwards (see validateLinks) — never trusted raw.
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
    } else if (dir === 'ropeup') {
      // rope lifts you one floor up, one tile south of the spot — t=3 so the UI
      // can tell the player a rope is needed
      links.push([x, y, z, x, y + 1, z - 1, 3])
    } else if (dir === 'shoveldown') {
      // stone pile: dig with a shovel, fall one floor — t=4 (shovel needed)
      let dx = x, dy = y
      const dz = z + 1
      const below = dirAt.get(kk(x, y, dz))
      if (below && UP[below]) { const [ox, oy] = DN[below]; dx += ox; dy += oy }
      links.push([x, y, z, dx, dy, dz, 4])
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

// --- 4b. merge in the client's own pathfinding data (Minimap_WaypointCost) --------
// The game client exports, per explored tile, the exact walking cost its OWN
// pathfinder uses: 55–233 = walkable (lower = faster ground), 250 = seen and NOT
// walkable, 255 = never explored. This is the canonical answer for every tile a
// player has actually seen — it already accounts for stacked walkway overlays
// (Venore's plank streets over unpass swamp), openable gates, wall tops, all the
// mapping tricks the OTBM-flag heuristic keeps tripping over.
//
// Two waypoint sources are unioned (a local player export in minimap/ and the
// community-complete tibiamaps.io per-floor path images): a tile explored in
// EITHER keeps the (min) client cost. Then per tile:
//                        wpc < 250 → walkable, keep the client cost;
//                        wpc = 250 → hard-blocked (explored, can't stand there);
//                        wpc = 255 → fall back to the OTBM-derived rule
//                                    (covers unexplored dungeons) at default cost.
// Floor-change origins are forced walkable afterwards so no link dangles.
// The fallback cost is deliberately EXPENSIVE (≈2× a road): OTBM-only tiles are
// paths no player demonstrably walks and the colour render often paints them
// black/grey, so a route should only cross them when they're the sole way in
// (dig-and-rope cave entrances) — never as a shortcut past rendered roads.
const DEFAULT_COST = 200
// Minimap colours that mean "you visibly cannot stand here" on the SURFACE:
// deep water and void. Only applied to OTBM-FALLBACK tiles on floor 7 — client
// tiles are ground truth, and UNDERGROUND the colour render paints legitimate
// unexplored passages grey/black (the veto once severed the real Ghostlands
// entrance tunnel, a cave the community minimap never rendered). Rock/wall/tree
// false-walkables were actually caused by the items.xml parser bug (fixed), so
// the broad veto is no longer needed.
const VETO_COLOURS = new Set([0x336699, 0x0066ff, 0x3399ff])
const VETO_FLOOR_ONLY = 7
function mergeWaypointCost(walk) {
  const wpcByFloor = Array.from({ length: 16 }, () => new Uint8Array(W * H).fill(255))
  // blend: keep the best (lowest <250) cost; an explicit 250 only sticks if no
  // source knows the tile as walkable.
  const blend = (arr, i, v) => {
    const cur = arr[i]
    if (v < 250) { if (cur >= 250 || v < cur) arr[i] = v }
    else if (v === 250 && cur === 255) arr[i] = 250
  }
  for (const f of fs.readdirSync(WPC_DIR)) {
    const m = f.match(/^Minimap_WaypointCost_(\d+)_(\d+)_(\d+)\.png$/)
    if (!m) continue
    const gx = +m[1], gy = +m[2], z = +m[3]
    if (z < 0 || z > 15 || gx + 256 <= X0 || gx >= X1 || gy + 256 <= Y0 || gy >= Y1) continue
    const png = PNG.sync.read(fs.readFileSync(path.join(WPC_DIR, f)))
    for (let py = 0; py < png.height; py++) {
      const y = gy + py
      if (y < Y0 || y >= Y1) continue
      for (let px = 0; px < png.width; px++) {
        const x = gx + px
        if (x < X0 || x >= X1) continue
        blend(wpcByFloor[z], (y - Y0) * W + (x - X0), png.data[(py * png.width + px) * 4])
      }
    }
  }
  for (let z = 0; z < 16; z++) {
    const f = path.join(TIBIAMAPS_DIR, `floor-${String(z).padStart(2, '0')}-path.png`)
    if (!fs.existsSync(f)) continue
    const png = PNG.sync.read(fs.readFileSync(f))
    if (png.width !== W || png.height !== H) { console.warn(`tibiamaps floor ${z}: unexpected ${png.width}x${png.height}, skipped`); continue }
    for (let i = 0; i < W * H; i++) blend(wpcByFloor[z], i, png.data[i * 4])
  }
  const cost = Array.from({ length: 16 }, () => new Uint8Array(W * H))
  const client = Array.from({ length: 16 }, () => new Uint8Array(W * H)) // 1 = cost came from client data
  const counts = { client: 0, blocked250: 0, otbmFallback: 0 }
  for (let z = 0; z < 16; z++) {
    const wpc = wpcByFloor[z]
    const out = cost[z]
    for (let i = 0; i < W * H; i++) {
      const v = wpc[i]
      if (v < 250) { out[i] = Math.max(1, v); client[z][i] = 1; counts.client++ }
      else if (v === 255 && walk[z][i]) { out[i] = DEFAULT_COST; counts.otbmFallback++ }
      else if (v === 250) counts.blocked250++
    }
  }
  console.log(`waypoint merge: ${counts.client} client tiles, ${counts.otbmFallback} otbm-fallback, ${counts.blocked250} hard-blocked`)

  // Colour veto over the OTBM fallback: an unexplored tile the OTBM rule opened
  // but the minimap paints as water/wall/rock/tree/void is far more likely an
  // OTBM false-walkable (item-only tiles, overlays, wall tops) than a real path —
  // and it's exactly what the user sees the route "crossing". Client tiles and
  // functional tiles (doors/stairs, forced right after) are untouched.
  {
    const vetoCount = new Map()
    const colourDir = path.join(root, 'frontend', 'public', 'minimap')
    for (const f of fs.readdirSync(colourDir)) {
      const m = f.match(/^Minimap_Color_(\d+)_(\d+)_(\d+)\.png$/)
      if (!m) continue
      const gx = +m[1], gy = +m[2], z = +m[3]
      if (z !== VETO_FLOOR_ONLY || gx + 256 <= X0 || gx >= X1 || gy + 256 <= Y0 || gy >= Y1) continue
      const png = PNG.sync.read(fs.readFileSync(path.join(colourDir, f)))
      for (let py = 0; py < png.height; py++) {
        const y = gy + py
        if (y < Y0 || y >= Y1) continue
        for (let px = 0; px < png.width; px++) {
          const x = gx + px
          if (x < X0 || x >= X1) continue
          const i = (y - Y0) * W + (x - X0)
          if (cost[z][i] === 0 || client[z][i]) continue
          const o = (py * png.width + px) * 4
          const col = (png.data[o] << 16) | (png.data[o + 1] << 8) | png.data[o + 2]
          if (VETO_COLOURS.has(col)) {
            cost[z][i] = 0
            vetoCount.set(col, (vetoCount.get(col) || 0) + 1)
          }
        }
      }
    }
    const parts = [...vetoCount.entries()].map(([c, n]) => `#${c.toString(16).padStart(6, '0')}:${n}`)
    console.log('colour veto on fallback tiles:', parts.join(' ') || 'none')
  }
  return { cost, client }
}

// --- 5. validate links against the baked walkability ------------------------------
// A link is only usable if its destination is a tile you can actually stand on.
// Tens of thousands of raw links land in solid rock / water / void: map noise,
// but mostly real stairs whose one-tile exit shift lands next to blocked terrain
// (Yalahar's shallow-water ring, mountain edges…). At runtime those destinations
// used to get "snapped" up to 60 tiles away — straight through walls — inventing
// connections the game doesn't have.
//
// Resolution, in order:
//   1. exact / ring-snap ≤2 — the client's own tolerance for a stair-exit shift;
//   2. CLIENT-ANCHORED snap 3..8: only onto tiles real players demonstrably
//      stand on (client waypoint cost). A stair whose computed exit sits in the
//      cave wall but has walked ground a few tiles away is a real stair with an
//      imprecise offset — anchoring to walked ground can't land inside rock;
//   3. PAIR RESCUE: real stairs are two-sided — the upper floor carries a
//      floor-change tile that leads back down beside this link's origin. If one
//      exists within 6 tiles of the computed destination, its own tile (walkable
//      by the portal rule) is the true landing — anchored to the correct region
//      by the game's own data, so it can never jump a wall;
//   4. otherwise drop the link (decorative stairs, holes into unmapped space).
function validateLinks(links, walk, client) {
  const at = (z, x, y) => x >= X0 && x < X1 && y >= Y0 && y < Y1 && walk[z][(y - Y0) * W + (x - X0)] > 0
  const atClient = (z, x, y) => x >= X0 && x < X1 && y >= Y0 && y < Y1 && client[z][(y - Y0) * W + (x - X0)] === 1
  const snap2 = (z, x, y) => {
    if (at(z, x, y)) return [x, y]
    for (let r = 1; r <= 2; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
          if (at(z, x + dx, y + dy)) return [x + dx, y + dy]
        }
    return null
  }
  const clientSnap8 = (z, x, y) => {
    for (let r = 3; r <= 8; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
          if (atClient(z, x + dx, y + dy)) return [x + dx, y + dy]
        }
    return null
  }
  // Origin index: links keyed by their origin tile, to find "the way back".
  const byOrigin = new Map()
  for (const l of links) {
    const k = l[2] + ':' + l[0] + ':' + l[1]
    let a = byOrigin.get(k)
    if (!a) { a = []; byOrigin.set(k, a) }
    a.push(l)
  }
  const pairRescue = (x, y, z, dx, dy, dz) => {
    // Around the computed destination (ring r=0..6 on floor dz), find a link that
    // goes back to floor z and lands within 3 tiles of this link's origin.
    for (let r = 0; r <= 6; r++)
      for (let oy = -r; oy <= r; oy++)
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue
          const cand = byOrigin.get(dz + ':' + (dx + ox) + ':' + (dy + oy))
          if (!cand) continue
          for (const [bx, by, , bdx, bdy, bdz] of cand) {
            if (bdz !== z) continue
            if (Math.abs(bdx - x) <= 3 && Math.abs(bdy - y) <= 3) return [bx, by]
          }
        }
    return null
  }
  const out = []
  const droppedRows = []
  let nudged = 0, clientAnchored = 0, rescued = 0
  for (const [x, y, z, dx, dy, dz, t] of links) {
    if (dz < 0 || dz > 15) { droppedRows.push([x, y, z, dx, dy, dz, t]); continue }
    let s = snap2(dz, dx, dy)
    if (s) {
      if (s[0] !== dx || s[1] !== dy) nudged++
    } else {
      s = clientSnap8(dz, dx, dy)
      if (s) clientAnchored++
      else {
        s = pairRescue(x, y, z, dx, dy, dz)
        if (s) rescued++
        else { droppedRows.push([x, y, z, dx, dy, dz, t]); continue }
      }
    }
    out.push([x, y, z, s[0], s[1], dz, t])
  }
  console.log(`link validation: ${out.length} kept (${nudged} nudged ≤2, ${clientAnchored} client-anchored ≤8, ${rescued} pair-rescued), ${droppedRows.length} dropped (dest not walkable)`)
  // Debug artifact (gitignored): what got dropped, for tuning the tolerance.
  fs.writeFileSync(path.join(root, 'tools', 'otbm', 'dropped-links.json'), JSON.stringify(droppedRows))
  return out
}

// --- run -------------------------------------------------------------------------
console.log('loading appearances.dat …')
const unpass = loadUnpass()
console.log('  unpass ids:', unpass.size)
const { doors, ladders, fchange, gates, useDown, ropeUp, shovelDown } = loadItems()
console.log('  doors:', doors.size, '| gates:', gates.size, '| ladders:', ladders.size, '| floorchange:', fchange.size, '| use-down:', useDown.size)

console.log('parsing otservbr.otbm (184 MB, ~1 min) …')
const t0 = Date.now()
const parsed = parseOtbm({ unpass, doors, ladders, fchange, gates, useDown, ropeUp, shovelDown })
console.log('  parsed in', ((Date.now() - t0) / 1000).toFixed(0) + 's')

const { cost, client } = mergeWaypointCost(parsed.walk)
// Functional tiles must stay standable even where the waypoint export never saw
// them open/used: floor-change origins (or their links dangle) and door/gate
// tiles (a door the exploring player never opened bakes as 250 and seals the
// building or bridge behind it — but auto-walk opens doors).
{
  let forced = 0
  const force = (x, y, z) => {
    if (z < 0 || z > 15 || x < X0 || x >= X1 || y < Y0 || y >= Y1) return
    const i = (y - Y0) * W + (x - X0)
    if (cost[z][i] === 0 && parsed.walk[z][i]) { cost[z][i] = DEFAULT_COST; forced++ }
  }
  for (const { x, y, z } of parsed.raw) force(x, y, z)
  for (const t of parsed.teleports) force(t.x, t.y, t.z)
  for (const d of parsed.doorTiles) force(d.x, d.y, d.z)
  console.log('forced', forced, 'floor-change/door tiles walkable')
}

const links = validateLinks(resolveLinks(parsed), cost, client)
const byT = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
for (const l of links) byT[l[6]]++
console.log('floor-links:', links.length, '| down:', byT[0], 'up:', byT[1], 'teleport:', byT[2], 'rope:', byT[3], 'shovel:', byT[4])

fs.mkdirSync(WALK_DIR, { recursive: true })
for (const f of fs.readdirSync(WALK_DIR)) fs.unlinkSync(path.join(WALK_DIR, f))
let totalBytes = 0
for (let z = 0; z < 16; z++) {
  let n = 0
  for (let i = 0; i < W * H; i++) if (cost[z][i]) n++
  if (n === 0) continue
  const gz = zlib.gzipSync(Buffer.from(cost[z].buffer), { level: 9 })
  fs.writeFileSync(path.join(WALK_DIR, `f${z}.bin`), gz)
  totalBytes += gz.length
  process.stdout.write(`f${z}:${n} `)
}
console.log('\nwalk grids (0=blocked, else client walk-cost):', (totalBytes / 1048576).toFixed(1) + 'MB gzipped')

fs.writeFileSync(LINKS_OUT, JSON.stringify(links))
console.log('wrote', path.relative(root, LINKS_OUT), '(' + links.length + ' links)')
console.log('wrote', path.relative(root, WALK_DIR))
