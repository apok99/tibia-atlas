// Load the baked walkability + links and check the real routes move like the game:
// respect water/walls, cross floors only via stairs/holes, hop islands by boat.
//   node tools/otbm/verify-routes.mjs
import fs from 'fs'
import zlib from 'zlib'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const X0 = 31744, X1 = 34304, Y0 = 30976, Y1 = 33024, W = X1 - X0, H = Y1 - Y0
const idx = (x, y) => (y - Y0) * W + (x - X0)
const inB = (x, y) => x >= X0 && x < X1 && y >= Y0 && y < Y1

const walk = {}
for (let z = 0; z < 16; z++) {
  const f = path.join(root, 'frontend/public/walk', `f${z}.bin`)
  if (!fs.existsSync(f)) { walk[z] = new Uint8Array(W * H); continue }
  walk[z] = new Uint8Array(zlib.gunzipSync(fs.readFileSync(f)).buffer)
}
const links = JSON.parse(fs.readFileSync(path.join(root, 'frontend/public/floor-links.json')))

const PORTS = [['Thais', 32365, 32224], ['Carlin', 32343, 31792], ['Venore', 32947, 32081], ['Edron', 33211, 31830], ['PortHope', 32629, 32769], ['Ankrahmun', 33146, 32816], ['LibertyBay', 32309, 32794], ['Svargrond', 32278, 31146], ['Yalahar', 32805, 31234], ['Oramond', 33607, 31955]]

function snap(z, x, y, R = 25) {
  if (z < 0 || z > 15 || !walk[z] || !inB(x, y)) return null
  if (walk[z][idx(x, y)]) return [x, y]
  for (let r = 1; r <= R; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
    const nx = x + dx, ny = y + dy
    if (inB(nx, ny) && walk[z][idx(nx, ny)]) return [nx, ny]
  }
  return null
}

const eFrom = new Map()
for (const [x, y, z, dx, dy, dz, t] of links) {
  const k = z + ':' + x + ':' + y
  let a = eFrom.get(k); if (!a) { a = []; eFrom.set(k, a) }
  a.push([dx, dy, dz, t])
}
const portCells = new Set(PORTS.map(([n, x, y]) => { const s = snap(7, x, y, 40); return s ? '7:' + s[0] + ':' + s[1] : null }).filter(Boolean))

// Multimodal reachability flood (foot A*-region + links + boats), directed or not.
// biKinds = set of link kinds (t) that are ALSO traversable in reverse (real stairs
// and ladders are physically two-way; holes/teleports are one-way).
function flood(sx, sy, sz, { boats = true, undirected = false, biKinds = null } = {}) {
  const seen = {}; for (let z = 0; z < 16; z++) seen[z] = new Uint8Array(W * H)
  const rev = new Map()
  const wantRev = (t) => undirected || (biKinds && biKinds.has(t))
  for (const [x, y, z, dx, dy, dz, t] of links) { if (!wantRev(t)) continue; const s = snap(dz, dx, dy, 6); if (!s) continue; const k = dz + ':' + s[0] + ':' + s[1]; let a = rev.get(k); if (!a) { a = []; rev.set(k, a) } a.push([x, y, z]) }
  const useRev = undirected || !!biKinds
  const s = snap(sz, sx, sy, 30); if (!s) return { seen, ok: () => false }
  const q = [[sz, s[0], s[1]]]; seen[sz][idx(s[0], s[1])] = 1; let head = 0
  while (head < q.length) {
    const [z, x, y] = q[head++]; const a = walk[z]
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nx = x + dx, ny = y + dy
      if (!inB(nx, ny)) continue
      if (a[idx(nx, ny)] && !seen[z][idx(nx, ny)]) { seen[z][idx(nx, ny)] = 1; q.push([z, nx, ny]) }
    }
    const es = eFrom.get(z + ':' + x + ':' + y)
    if (es) for (const [dx, dy, dz] of es) { const sn = snap(dz, dx, dy, 10); if (sn && !seen[dz][idx(sn[0], sn[1])]) { seen[dz][idx(sn[0], sn[1])] = 1; q.push([dz, sn[0], sn[1]]) } }
    if (useRev) { const rs = rev.get(z + ':' + x + ':' + y); if (rs) for (const [rx, ry, rz] of rs) { const sn = snap(rz, rx, ry, 10); if (sn && !seen[rz][idx(sn[0], sn[1])]) { seen[rz][idx(sn[0], sn[1])] = 1; q.push([rz, sn[0], sn[1]]) } } }
    if (boats && z === 7 && portCells.has('7:' + x + ':' + y)) for (const [n, px, py] of PORTS) { const sn = snap(7, px, py, 40); if (sn && !seen[7][idx(sn[0], sn[1])]) { seen[7][idx(sn[0], sn[1])] = 1; q.push([7, sn[0], sn[1]]) } }
  }
  let tot = 0; for (let z = 0; z < 16; z++) tot += seen[z].reduce((a, b) => a + b, 0)
  return { seen, tot, ok: (gz, gx, gy) => { const g = snap(gz, gx, gy, 20); return g ? seen[gz][idx(g[0], g[1])] === 1 : false } }
}

const CASES = [
  ['Thais→Cyclopolis', 32365, 32224, 7, 33251, 31698, 7],
  ['Thais→Carlin', 32365, 32224, 7, 32343, 31792, 7],
  ['Thais→Venore', 32365, 32224, 7, 32947, 32081, 7],
  ['Thais→Edron', 32365, 32224, 7, 33211, 31830, 7],
  ['Carlin→AbDendriel', 32343, 31792, 7, 32665, 31652, 7],
  ['Yalahar→GrimReaper', 32805, 31234, 7, 32784, 31025, 8],
  ['Venore→Thais depot', 32957, 32076, 7, 32369, 32241, 7],
  ['Ankrahmun→Darashia', 33146, 32816, 7, 33236, 32432, 7],
  ['Darashia→Ankrahmun', 33236, 32432, 7, 33146, 32816, 7],
  ['Thais→MountSternum', 32365, 32224, 7, 32494, 32072, 7],
]
const BI = new Set([1]) // stairs + ladders are two-way; holes/teleports one-way
console.log('=== multimodal reachability (foot + stairs/holes + boats; two-way stairs) ===')
for (const [name, sx, sy, sz, gx, gy, gz] of CASES) {
  const r = flood(sx, sy, sz, { biKinds: BI })
  console.log(`  ${r.ok(gz, gx, gy) ? 'OK  ' : 'MISS'} ${name}  (flood ${r.tot})`)
}
console.log('\n=== Grim Reaper deep dive ===')
console.log('  Yalahar→GR directed       :', flood(32805, 31234, 7).ok(8, 32784, 31025))
console.log('  Yalahar→GR two-way stairs :', flood(32805, 31234, 7, { biKinds: BI }).ok(8, 32784, 31025))
console.log('  Yalahar→GR fully undirected:', flood(32805, 31234, 7, { undirected: true }).ok(8, 32784, 31025))
