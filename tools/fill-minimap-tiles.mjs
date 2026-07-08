// Fill gaps in our self-hosted minimap tiles using the community-complete
// tibiamaps/tibia-map-data floor PNGs.
//
// Our /minimap/Minimap_Color_<gx>_<gy>_<floor>.png tiles come from a *personal*
// client minimap export, so unexplored sectors are missing (whole tiles absent)
// or partly black. tibia-map-data ships one community-complete PNG per floor,
// 2560x2048, whose top-left pixel is world (31744, 30976) — EXACTLY our map
// bounds — so cropping is a 1:1 pixel->world map with no georeferencing.
//
// This tool is "compose, not replace": it only ever ADDS information where we
// had none.
//   - a tile we don't have at all  -> crop the 256x256 region and write it
//     (skipped when the crop is entirely black, i.e. the community map lacks it too)
//   - a tile we DO have             -> replace only its pure-black pixels
//     (unexplored/void) with the community pixel; every pixel we already have
//     is left untouched. The tile is rewritten only if something changed.
//
// Re-run this after refreshing tibia-map-data (e.g. when CipSoft ships new
// content and you regenerate tiles) — see the map-routing memory for the
// walkability half of the same pipeline (tools/otbm/tibiamaps/*-path.png).
//
// Usage:
//   node tools/fill-minimap-tiles.mjs            # download (cached) + fill
//   node tools/fill-minimap-tiles.mjs --dry      # report only, write nothing
//   node tools/fill-minimap-tiles.mjs --no-patch # only create fully-missing tiles

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
// pngjs already lives in the OTBM tooling install.
const { PNG } = require(resolve(__dirname, 'otbm/node_modules/pngjs'))

const ROOT = resolve(__dirname, '..')
const MINIMAP_DIR = resolve(ROOT, 'frontend/public/minimap')
const CACHE_DIR = resolve(__dirname, 'otbm/tibiamaps') // gitignored, shares the path.png cache
const BASE_URL = 'https://tibiamaps.github.io/tibia-map-data'

const TILE = 256
const X_MIN = 31744, X_MAX = 34304 // exclusive edge
const Y_MIN = 30976, Y_MAX = 33024 // exclusive edge
const FULL_W = X_MAX - X_MIN // 2560
const FULL_H = Y_MAX - Y_MIN // 2048

const argv = new Set(process.argv.slice(2))
const DRY = argv.has('--dry')
const PATCH = !argv.has('--no-patch')

const isBlack = (r, g, b) => r === 0 && g === 0 && b === 0

async function ensureFloorPng(floor) {
  const name = `floor-${String(floor).padStart(2, '0')}-map.png`
  const path = resolve(CACHE_DIR, name)
  if (existsSync(path)) return path
  const url = `${BASE_URL}/${name}`
  process.stdout.write(`  fetching ${name} ... `)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(path, buf)
  console.log(`${(buf.length / 1024).toFixed(0)} KB`)
  return path
}

// Crop a 256x256 RGBA region out of the decoded full-floor PNG.
function cropTile(full, px, py) {
  const out = new PNG({ width: TILE, height: TILE })
  for (let y = 0; y < TILE; y++) {
    const srcRow = (py + y) * full.width * 4
    const dstRow = y * TILE * 4
    for (let x = 0; x < TILE; x++) {
      const s = srcRow + (px + x) * 4
      const d = dstRow + x * 4
      out.data[d] = full.data[s]
      out.data[d + 1] = full.data[s + 1]
      out.data[d + 2] = full.data[s + 2]
      out.data[d + 3] = 255
    }
  }
  return out
}

function allBlack(png) {
  for (let i = 0; i < png.data.length; i += 4)
    if (!isBlack(png.data[i], png.data[i + 1], png.data[i + 2])) return false
  return true
}

const stats = { created: 0, patched: 0, patchedPx: 0, skippedBlack: 0, unchanged: 0 }

for (let floor = 0; floor <= 15; floor++) {
  const fullPath = await ensureFloorPng(floor)
  const full = PNG.sync.read(readFileSync(fullPath))
  if (full.width !== FULL_W || full.height !== FULL_H)
    throw new Error(`floor ${floor}: unexpected ${full.width}x${full.height}, expected ${FULL_W}x${FULL_H}`)

  for (let gx = X_MIN; gx < X_MAX; gx += TILE) {
    for (let gy = Y_MIN; gy < Y_MAX; gy += TILE) {
      const px = gx - X_MIN
      const py = gy - Y_MIN
      const tilePath = resolve(MINIMAP_DIR, `Minimap_Color_${gx}_${gy}_${floor}.png`)
      const crop = cropTile(full, px, py)

      if (!existsSync(tilePath)) {
        if (allBlack(crop)) { stats.skippedBlack++; continue }
        if (!DRY) writeFileSync(tilePath, PNG.sync.write(crop))
        stats.created++
        continue
      }

      if (!PATCH) continue

      // Existing tile: fill only its pure-black pixels from the community data.
      const ours = PNG.sync.read(readFileSync(tilePath))
      if (ours.width !== TILE || ours.height !== TILE) continue // leave odd tiles alone
      let changed = 0
      for (let i = 0; i < ours.data.length; i += 4) {
        if (!isBlack(ours.data[i], ours.data[i + 1], ours.data[i + 2])) continue
        const r = crop.data[i], g = crop.data[i + 1], b = crop.data[i + 2]
        if (isBlack(r, g, b)) continue // community has nothing here either
        ours.data[i] = r; ours.data[i + 1] = g; ours.data[i + 2] = b; ours.data[i + 3] = 255
        changed++
      }
      if (changed > 0) {
        if (!DRY) writeFileSync(tilePath, PNG.sync.write(ours))
        stats.patched++
        stats.patchedPx += changed
      } else {
        stats.unchanged++
      }
    }
  }
  process.stdout.write(`floor ${String(floor).padStart(2)} done  `)
  if (floor % 4 === 3) process.stdout.write('\n')
}

console.log('\n---')
console.log(`created (new tiles):      ${stats.created}`)
console.log(`patched (existing tiles): ${stats.patched}  (${stats.patchedPx} px)`)
console.log(`skipped (all-black data): ${stats.skippedBlack}`)
console.log(`unchanged existing:       ${stats.unchanged}`)
if (DRY) console.log('(dry run — nothing written)')
