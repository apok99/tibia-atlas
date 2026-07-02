// Parse the Tibia client's `minimapmarkers.bin` (Protocol Buffers) that shipped
// with the imported minimap, and emit `frontend/public/map-markers.json` — the
// point-of-interest overlay for the web map (levitate spots, levers, quest
// items, depots, teleports, boss/rare spawn tiles…).
//
//   node tools/gen-map-markers.mjs
//
// Protobuf schema (reverse-engineered from the file):
//   message Marker {
//     message Position { uint32 x=1; uint32 y=2; uint32 z=3; }
//     Position position = 1;   // world coordinates + floor
//     uint32   icon     = 2;   // client marker icon id
//     string   description = 3;
//     uint32   unknown  = 4;
//   }
//   message File { repeated Marker markers = 1; }
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buf = fs.readFileSync(path.join(root, 'minimap', 'minimapmarkers.bin'))

let p = 0
const varint = () => {
  let shift = 0,
    res = 0
  for (;;) {
    const b = buf[p++]
    res |= (b & 0x7f) << shift
    if (!(b & 0x80)) break
    shift += 7
  }
  return res >>> 0
}
const readMsg = (end) => {
  const m = {}
  while (p < end) {
    const tag = varint()
    const field = tag >>> 3
    const wt = tag & 7
    if (wt === 0) m[field] = varint()
    else if (wt === 2) {
      const len = varint()
      m[field] = { start: p, end: p + len }
      p += len
    } else throw new Error('unexpected wire type ' + wt)
  }
  return m
}

const markers = []
while (p < buf.length) {
  varint() // outer tag (field 1, repeated)
  const len = varint()
  const end = p + len
  const mk = readMsg(end)
  p = end
  let pos = {}
  if (mk[1]) {
    const save = p
    p = mk[1].start
    pos = readMsg(mk[1].end)
    p = save
  }
  const desc = mk[3] ? buf.toString('utf8', mk[3].start, mk[3].end).trim() : ''
  markers.push({ x: pos[1], y: pos[2], z: pos[3] || 0, icon: mk[2] || 0, desc })
}

// Keep only markers that carry a description — the blank ones are route
// waypoints/arrows and would just litter the map.
const kept = markers.filter((m) => m.desc)
// Compact shape: [x, y, z, icon, desc].
const out = kept.map((m) => [m.x, m.y, m.z, m.icon, m.desc])

const dest = path.join(root, 'frontend', 'public', 'map-markers.json')
fs.writeFileSync(dest, JSON.stringify(out))
console.log(`Wrote ${out.length} markers (of ${markers.length} total) -> ${dest}`)
