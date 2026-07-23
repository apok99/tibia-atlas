// Parse the OT server's quest definitions and emit `frontend/public/quests.json`
// — the "Atlas de quests" map layer: each quest's official mission list, with the
// tiles where those missions actually happen plotted on the right floors.
//
//   node tools/gen-quests.mjs
//
// Two halves have to be joined:
//
//   lib/core/quests/catalog/*.lua  the questlog as players read it: quest name,
//                                 ordered missions, and each mission's state text
//                                 ("Now you need to pull all 11 levers…").
//   scripts/quests/<folder>/*.lua  the machinery: teleport destinations, door and
//                                 lever tiles, boss rooms — with coordinates.
//
// The join that makes the layer worth building is the STORAGE KEY. A mission is
// identified by `storageId = Storage.Quest.U7_4.TheAncientTombs.OmrucsTreasure`,
// and the script that teleports you into Omruc's room reads and writes that very
// key. So a script's coordinates can be attributed to a specific mission instead
// of being dumped as an undifferentiated cloud of pins.
//
// What the coordinates mean: trigger tiles are usually NOT in the lua (movements
// register by `uid`, placed in the .otbm), so what we get are the destinations,
// doors and levers — which is the useful half anyway: where the quest happens,
// not which tile you happened to step on.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const otDir = path.join(root, 'ot', 'data-otservbr-global')
const outFile = path.join(root, 'frontend', 'public', 'quests.json')

// Coordinates outside the real world map are script artefacts (test rooms).
const X_MIN = 30000, X_MAX = 34500, Y_MIN = 30500, Y_MAX = 33500, Z_MAX = 15
const inWorld = (x, y, z) => x >= X_MIN && x <= X_MAX && y >= Y_MIN && y <= Y_MAX && z >= 0 && z <= Z_MAX

/** Cap per quest so a sprawling questline cannot flood the map. */
const MAX_POINTS = 60

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

const MINOR = new Set(['the', 'of', 'and', 'a', 'to', 'in'])
const titleCase = (s) =>
  s
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && MINOR.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')

function luaFiles(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...luaFiles(f))
    else if (f.endsWith('.lua')) out.push(f)
  }
  return out
}

// --- the questlog -------------------------------------------------------------

/** Split a `missions = { [1] = {...}, [2] = {...} }` block into its entries. */
function splitMissions(block) {
  const out = []
  const re = /\[(\d+)\]\s*=\s*\{/g
  let m
  while ((m = re.exec(block))) {
    // Walk braces from the opening one so nested `states = {}` stays inside.
    let depth = 0
    let end = -1
    for (let i = m.index + m[0].length - 1; i < block.length; i++) {
      const c = block[i]
      if (c === '"') {
        i++
        while (i < block.length && block[i] !== '"') i += block[i] === '\\' ? 2 : 1
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
    out.push({ n: +m[1], body: block.slice(m.index, end + 1) })
    re.lastIndex = end
  }
  return out
}

/** The `missions = { ... }` block of a catalog file, braces balanced. */
function missionsBlock(src) {
  const at = src.indexOf('missions')
  if (at < 0) return null
  const open = src.indexOf('{', at)
  if (open < 0) return null
  let depth = 0
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
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return null
}

const catalog = []
for (const file of luaFiles(path.join(otDir, 'lib', 'core', 'quests', 'catalog'))) {
  if (path.basename(file) === 'init.lua') continue
  const src = fs.readFileSync(file, 'utf8')
  const name = src.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1]
  if (!name) continue

  const startKey = src.match(/startStorageId\s*=\s*(Storage\.Quest\.[A-Za-z0-9_.]+)/)?.[1] ?? null
  const block = missionsBlock(src)
  const missions = []
  for (const { n, body } of block ? splitMissions(block) : []) {
    const mName = body.match(/name\s*=\s*"([^"]+)"/)?.[1] ?? `Mission ${n}`
    const key = body.match(/storageId\s*=\s*(Storage\.Quest\.[A-Za-z0-9_.]+)/)?.[1] ?? null
    // A mission describes itself either with one `description` or with a
    // `states` table, one line per progress value.
    const texts = []
    const statesAt = body.indexOf('states')
    if (statesAt >= 0) {
      for (const s of body.slice(statesAt).matchAll(/\[\d+\]\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
        texts.push(s[1].replace(/\\"/g, '"'))
      }
    }
    const desc = body.match(/description\s*=\s*"((?:[^"\\]|\\.)*)"/)?.[1]
    if (!texts.length && desc) texts.push(desc.replace(/\\"/g, '"'))
    missions.push({ n, name: mName, key, texts })
  }

  catalog.push({ file, name, startKey, missions })
}

// --- the machinery ------------------------------------------------------------
// Every quest script folder, with each file's coordinates and storage keys.
const scriptsRoot = path.join(otDir, 'scripts', 'quests')
const folders = fs
  .readdirSync(scriptsRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

/** A file's kind, from the OT's own naming convention. */
function kindOf(base) {
  if (/^actions?[_-]/.test(base)) return 'action'
  if (/^movements?[_-]/.test(base)) return 'movement'
  if (/^npcs?[_-]/.test(base)) return 'npc'
  if (/^creaturescripts?[_-]/.test(base)) return 'creature'
  return 'other'
}

/** Human label for a point, from the script file name. */
function labelOf(base) {
  return titleCase(
    base
      .replace(/\.lua$/, '')
      .replace(/^(actions?|movements?|npcs?|creaturescripts?|globalevents?)[_-]/, '')
      .replace(/[_-]+/g, ' ')
  )
}

const folderData = new Map()
for (const folder of folders) {
  const files = []
  for (const file of luaFiles(path.join(scriptsRoot, folder))) {
    const src = fs.readFileSync(file, 'utf8')
    const coords = []
    for (const m of src.matchAll(/Position\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g)) {
      const [x, y, z] = [+m[1], +m[2], +m[3]]
      if (inWorld(x, y, z)) coords.push({ x, y, z })
    }
    if (!coords.length) continue
    const keys = [...new Set([...src.matchAll(/Storage\.Quest\.[A-Za-z0-9_.]+/g)].map((m) => m[0]))]
    const base = path.basename(file)
    files.push({ base, kind: kindOf(base), label: labelOf(base), coords, keys })
  }
  if (files.length) folderData.set(folder, files)
}

// --- join ---------------------------------------------------------------------
const quests = []
const unmatched = []
const usedFolders = new Set()

for (const q of catalog) {
  // The catalog name and the script folder are the same words: "The Ancient
  // Tombs" <-> the_ancient_tombs. Fall back to the folder whose storage keys the
  // quest shares, which catches renames ("dangerous_depth" vs "Dangerous Depths").
  let folder = folders.find((f) => slug(f) === slug(q.name))
  if (!folder) {
    const questKeys = new Set([q.startKey, ...q.missions.map((m) => m.key)].filter(Boolean))
    let best = null
    for (const [f, files] of folderData) {
      const hits = files.reduce((n, file) => n + file.keys.filter((k) => questKeys.has(k)).length, 0)
      if (hits > 0 && (!best || hits > best.hits)) best = { f, hits }
    }
    folder = best?.f
  }
  const files = folder ? (folderData.get(folder) ?? []) : []
  if (folder) usedFolders.add(folder)

  // storage key -> mission number, so a script's tiles land on the right step.
  const keyToMission = new Map()
  for (const m of q.missions) if (m.key) keyToMission.set(m.key, m.n)

  const seen = new Set()
  const points = []
  for (const f of files) {
    // Attribute only when the file belongs to exactly ONE mission. Shared
    // machinery (the tombs' single teleport script serves all seven pharaohs)
    // would otherwise dump every tomb onto whichever mission matched first.
    const hits = [...new Set(f.keys.map((k) => keyToMission.get(k)).filter((v) => v !== undefined))]
    const mission = hits.length === 1 ? hits[0] : null
    for (const c of f.coords) {
      const id = `${c.x},${c.y},${c.z}`
      if (seen.has(id)) continue
      seen.add(id)
      points.push({ ...c, label: f.label, kind: f.kind, mission })
    }
  }

  if (!points.length) {
    unmatched.push(`${q.name}: no mapped coordinates${folder ? ` (folder ${folder})` : ' (no script folder)'}`)
  }

  // Attributed steps first, so the cap never throws away the precise ones.
  points.sort((a, b) => (a.mission ?? 99) - (b.mission ?? 99))
  const kept = points.slice(0, MAX_POINTS)

  const floors = [...new Set(kept.map((p) => p.z))].sort((a, b) => a - b)
  const xs = kept.map((p) => p.x)
  const ys = kept.map((p) => p.y)

  quests.push({
    id: slug(q.name),
    name: q.name,
    missions: q.missions.map((m) => ({ n: m.n, name: m.name, texts: m.texts })),
    points: kept,
    truncated: points.length > kept.length ? points.length : 0,
    floors,
    // Anchor on the first attributed step — where the quest actually begins.
    x: kept[0]?.x ?? null,
    y: kept[0]?.y ?? null,
    z: kept[0]?.z ?? null,
    bounds: kept.length
      ? { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
      : null,
  })
}

// Most quest script folders have no questlog entry at all — Demon Oak, Draconia,
// the Elemental Spheres and 70-odd more are fully scripted but never registered
// as missions. They are real quests with real coordinates, so they join the atlas
// named after their folder, simply without a mission breakdown.
// "the_inquisition" and "the_inquisition_quest" are two folders for one quest, so
// a bare name is the comparison key: no leading "the", no trailing "quest".
const bareName = (s) => slug(s).replace(/^the/, '').replace(/quest(s)?$/, '')
const byBare = new Map()
for (const q of quests) if (q.points.length) byBare.set(bareName(q.name), q)

for (const [folder, files] of folderData) {
  if (usedFolders.has(folder)) continue
  const seen = new Set()
  const points = []
  for (const f of files) {
    for (const c of f.coords) {
      const id = `${c.x},${c.y},${c.z}`
      if (seen.has(id)) continue
      seen.add(id)
      points.push({ ...c, label: f.label, kind: f.kind, mission: null })
    }
  }
  if (!points.length) continue

  // Same quest under a second folder: fold its tiles into the catalogued entry
  // (which owns the mission breakdown) instead of listing it twice.
  const twin = byBare.get(bareName(folder))
  if (twin) {
    const have = new Set(twin.points.map((p) => `${p.x},${p.y},${p.z}`))
    for (const p of points) {
      if (twin.points.length >= MAX_POINTS) break
      if (have.has(`${p.x},${p.y},${p.z}`)) continue
      have.add(`${p.x},${p.y},${p.z}`)
      twin.points.push(p)
    }
    twin.floors = [...new Set(twin.points.map((p) => p.z))].sort((a, b) => a - b)
    continue
  }

  const kept = points.slice(0, MAX_POINTS)
  const xs = kept.map((p) => p.x)
  const ys = kept.map((p) => p.y)
  const entry = {
    id: slug(folder),
    name: titleCase(folder),
    missions: [],
    points: kept,
    truncated: points.length > kept.length ? points.length : 0,
    floors: [...new Set(kept.map((p) => p.z))].sort((a, b) => a - b),
    x: kept[0].x,
    y: kept[0].y,
    z: kept[0].z,
    bounds: { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) },
  }
  quests.push(entry)
  // Register it so a later folder for the same quest ("the_spike_tasks" after
  // "spike_tasks") merges into this one instead of listing a twin.
  byBare.set(bareName(folder), entry)
}

const mapped = quests.filter((q) => q.points.length)
mapped.sort((a, b) => a.name.localeCompare(b.name))

fs.writeFileSync(
  outFile,
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), quests: mapped }) + '\n'
)

const withMission = mapped.reduce((n, q) => n + q.points.filter((p) => p.mission).length, 0)
const totalPoints = mapped.reduce((n, q) => n + q.points.length, 0)
console.log(`quests.json: ${mapped.length}/${catalog.length} quests mapped, ${totalPoints} points`)
console.log(`  ${withMission} attributed to a specific mission (${Math.round((withMission / totalPoints) * 100)}%)`)
console.log(`  ${folders.length - usedFolders.size} script folders with no catalog quest`)
if (unmatched.length) {
  console.log(`  ${unmatched.length} catalog quests dropped:`)
  for (const u of unmatched) console.log(`   - ${u}`)
}
