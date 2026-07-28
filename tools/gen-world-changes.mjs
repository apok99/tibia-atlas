// Bake the "Mini World Changes" map layer from the OT server's own scripts.
//
//   node tools/gen-world-changes.mjs
//
// A mini world change is a daily dice roll the server makes at start-up: a fury
// gate opens in ONE of ten cities, a nightmare isle surfaces at ONE of three
// coasts, Yasir shows up in ONE of three ports (only a third of the days), and
// on the 13th of the month Grimvale drowns in werecreatures. We cannot know
// which one is live on a given server today — that state only exists inside a
// running world — so the layer answers the question that *is* answerable and is
// the one players actually ask: WHERE can it happen, and WHAT does the world say
// when it does.
//
// Three sources, all inside `ot/`:
//   scripts/world_changes/*.lua   the roll: candidate spots, odds, portal exits
//   npc/towncryer.lua             the Town Crier's lines, one per possible spot
//   world/world_changes/**.otbm   the ground the change swaps in — parsed here
//                                 for its real footprint, which is how the layer
//                                 draws a rectangle instead of a lonely dot
//
// The OTBM footprint is also a correction: fury_gates' README claims the Full
// Moon arena sits at 33919,31047,8, but its map file lays tiles at
// 33413-33447 / 31520-31554 on floor 11. The binary wins.
//
// Announcements stay in their original English, like the raid layer's: that
// string is what the world literally says, translating it would make it
// unrecognisable in-game.
//
// Output: frontend/public/world-changes.json
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const otDir = path.join(root, 'ot', 'data-otservbr-global')
const outFile = path.join(root, 'frontend', 'public', 'world-changes.json')

const lua = (rel) => fs.readFileSync(path.join(otDir, rel), 'utf8')

// --- OTBM footprints ----------------------------------------------------------
// The world-change maps are tiny patches (a few hundred tiles) the server loads
// on top of the live world, so only the tile geometry is needed: which floors
// they touch and the box they cover. Node grammar per the server's own reader
// (ot/src/io/io_definitions.hpp), same as tools/otbm/bake-walk.mjs.
const NODE_START = 0xfe, NODE_END = 0xff, ESCAPE = 0xfd
const T_TILE_AREA = 4, T_TILE = 5, T_HOUSETILE = 14

/** `{ x1, y1, x2, y2, floors[] }` covered by one world-change .otbm patch. */
function otbmFootprint(file) {
  const buf = fs.readFileSync(file)
  let p = 4 // header: version u32
  let area = { x: 0, y: 0, z: 0 }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  const floors = new Set()

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

  const node = () => {
    p++ // NODE_START
    const type = buf[p++]
    const pr = readProps()
    if (type === T_TILE_AREA && pr.length >= 5) {
      area = { x: pr.readUInt16LE(0), y: pr.readUInt16LE(2), z: pr[4] }
    } else if ((type === T_TILE || type === T_HOUSETILE) && pr.length >= 2) {
      const x = area.x + pr[0], y = area.y + pr[1]
      x1 = Math.min(x1, x); x2 = Math.max(x2, x)
      y1 = Math.min(y1, y); y2 = Math.max(y2, y)
      floors.add(area.z)
    }
    while (buf[p] === NODE_START) node()
    p++ // NODE_END
  }
  node()

  if (!floors.size) return null
  return { x1, y1, x2, y2, floors: [...floors].sort((a, b) => a - b) }
}

const patch = (dir, name) => {
  const file = path.join(otDir, 'world', 'world_changes', dir, `${name}.otbm`)
  return fs.existsSync(file) ? otbmFootprint(file) : null
}

// --- who lives there ----------------------------------------------------------
// The interesting half of a fury gate is not the gate, it is Fury Hell on the
// other side. The spawn file is the only honest source for that roster, so it is
// counted per box instead of hand-listed.
const spawnPoints = (() => {
  const xml = fs.readFileSync(path.join(otDir, 'world', 'otservbr-monster.xml'), 'utf8')
  const out = []
  const re = /<monster centerx="(\d+)" centery="(\d+)" centerz="(\d+)"[^>]*>([\s\S]*?)<\/monster>/g
  for (const m of xml.matchAll(re)) {
    const x = Number(m[1]), y = Number(m[2]), z = Number(m[3])
    for (const mm of m[4].matchAll(/name="([^"]+)"/g)) out.push({ x, y, z, name: mm[1] })
  }
  return out
})()

/** `[{ name, spawns }]` inside a box, most numerous first. */
function creaturesIn(box, limit = 14) {
  const counts = new Map()
  for (const s of spawnPoints) {
    if (!box.floors.includes(s.z)) continue
    if (s.x < box.x1 || s.x > box.x2 || s.y < box.y1 || s.y > box.y2) continue
    counts.set(s.name, (counts.get(s.name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, spawns]) => ({ name, spawns }))
}

// --- the Town Crier -----------------------------------------------------------
// He is the whole reason this layer can quote anything: `npc/towncryer.lua`
// carries one line per possible outcome, gated on the global storage the roll
// sets. The storage's LAST path segment identifies which spot the line is for.
const crier = (() => {
  const src = lua('npc/towncryer.lua')
  const out = new Map()
  for (const m of src.matchAll(/\{\s*text\s*=\s*"([^"]+)"\s*,\s*storage\s*=\s*[\w.]*?(\w+)\s*\}/g)) {
    out.set(m[2], m[1])
  }
  return out
})()

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
/** Crier line for a storage key ("FuryGates", "AnkrahmunNorth"), or null. */
const crierLine = (key) => {
  for (const [k, text] of crier) if (norm(k) === norm(key)) return text
  return null
}

const positions = (src) => [...src.matchAll(/Position\((\d+),\s*(\d+),\s*(\d+)\)/g)]
/** First `player:teleportTo(Position(...))` literal in a script — the way in. */
function teleportLiteral(src) {
  const m = src.match(/teleportTo\(Position\((\d+),\s*(\d+),\s*(\d+)\)\)/)
  return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null
}

const changes = []

// --- 1. Fury Gates ------------------------------------------------------------
// One of ten cities wakes up with a burning portal in it. Level 60+, premium and
// promoted, or the gate spits you back out — that check is a real in-game line,
// so it is quoted like an announcement.
{
  const src = lua('scripts/world_changes/fury_gates.lua')
  const spots = []
  for (const m of src.matchAll(
    /\{\s*city\s*=\s*"([^"]+)",\s*mapName\s*=\s*"([^"]+)",\s*exitPosition\s*=\s*Position\((\d+),\s*(\d+),\s*(\d+)\)\s*\}/g
  )) {
    const [, city, mapName, x, y, z] = m
    spots.push({
      key: mapName,
      // The portal's EXIT is where the gate stands: stepping out of Fury Hell
      // drops you back on the gate tile.
      label: city,
      x: Number(x),
      y: Number(y),
      z: Number(z),
      bounds: patch('fury_gates', mapName),
      phrase: null,
    })
  }

  const inside = teleportLiteral(src)
  // Fury Hell itself is two floors below the arrival corridor; the box is the
  // cave the spawn file fills, not the corridor you land in.
  const hellBox = { x1: 33260, y1: 31790, x2: 33335, y2: 31860, floors: [14, 15] }
  const denial = src.match(/player:say\("([^"]+)"/)

  changes.push({
    id: 'fury_gates',
    kind: 'daily',
    chance: 100,
    day: null,
    spots,
    inside: {
      label: 'Fury Hell',
      ...inside,
      bounds: hellBox,
      floors: hellBox.floors,
      creatures: creaturesIn(hellBox),
    },
    requirement: { premium: true, promoted: true, level: 60 },
    phrases: [
      ...(crierLine('FuryGates') ? [{ from: 'crier', text: crierLine('FuryGates'), spot: null }] : []),
      ...(denial ? [{ from: 'portal', text: denial[1], spot: null }] : []),
    ],
    sources: ['scripts/world_changes/fury_gates.lua', 'npc/towncryer.lua'],
  })
}

// --- 2. Nightmare Isles -------------------------------------------------------
// Three coasts, one isle. Every spot has its OWN crier line naming the region,
// which is what makes the announcement useful: it tells you where to sail.
{
  const src = lua('scripts/world_changes/nightmare_isles.lua')
  const byStorage = new Map()
  for (const m of src.matchAll(
    /\{\s*position\s*=\s*Position\((\d+),\s*(\d+),\s*(\d+)\),\s*storage\s*=\s*[\w.]*?(\w+)\s*\}/g
  )) {
    byStorage.set(m[4], { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) })
  }

  const spots = []
  for (const m of src.matchAll(
    /\{\s*displayName\s*=\s*"([^"]+)",\s*mapName\s*=\s*"([^"]+)",\s*storage\s*=\s*[\w.]*?(\w+)\s*\}/g
  )) {
    const [, label, mapName, storage] = m
    const pos = byStorage.get(storage)
    if (!pos) continue
    spots.push({
      key: mapName,
      label,
      ...pos,
      bounds: patch('nightmare_isle', mapName),
      phrase: crierLine(storage),
    })
  }

  const inside = teleportLiteral(src)
  const isleBox = { x1: 33405, y1: 32565, x2: 33505, y2: 32665, floors: [8, 9, 10, 11] }

  changes.push({
    id: 'nightmare_isles',
    kind: 'daily',
    chance: 100,
    day: null,
    spots,
    inside: {
      label: 'Nightmare Isles',
      ...inside,
      bounds: isleBox,
      floors: isleBox.floors,
      creatures: creaturesIn(isleBox),
    },
    requirement: null,
    phrases: spots
      .filter((s) => s.phrase)
      .map((s) => ({ from: 'crier', text: s.phrase, spot: s.key })),
    sources: ['scripts/world_changes/nightmare_isles.lua', 'npc/towncryer.lua'],
  })
}

// --- 3. Oriental Trader (Yasir) -----------------------------------------------
// The only change that can simply not happen: a 33% roll first, then one of
// three ports. Yasir buys creature products at a premium, which is why the site
// already tracks him — this layer answers the other half, WHERE he docks.
{
  const src = lua('scripts/world_changes/oriental_trader.lua')
  const chance = Number(src.match(/spawnChance\s*=\s*(\d+)/)?.[1] ?? 0)
  const spots = []
  for (const m of src.matchAll(/\[\d+\]\s*=\s*\{([\s\S]*?)\n\t\t\},/g)) {
    const block = m[1]
    const pos = block.match(/yasirPosition\s*=\s*Position\((\d+),\s*(\d+),\s*(\d+)\)/)
    const name = block.match(/mapName\s*=\s*"([^"]+)"/)
    if (!pos || !name) continue
    const key = name[1].toLowerCase().replace(/\s+/g, '')
    spots.push({
      key,
      label: name[1],
      x: Number(pos[1]),
      y: Number(pos[2]),
      z: Number(pos[3]),
      bounds: patch('oriental_trader', key),
      phrase: null,
    })
  }

  changes.push({
    id: 'oriental_trader',
    kind: 'chance',
    chance,
    day: null,
    spots,
    inside: null,
    requirement: null,
    phrases: crierLine('Yasir') ? [{ from: 'crier', text: crierLine('Yasir'), spot: null }] : [],
    sources: ['scripts/world_changes/oriental_trader.lua', 'npc/towncryer.lua'],
  })
}

// --- 4. Full Moon (Grimvale) --------------------------------------------------
// The one change with a date instead of a dice roll, and the only one the server
// BROADCASTS to everybody rather than leaving to the crier. Two places matter:
// the vale itself, where wereboars and werebadgers replace the badgers and
// butterflies, and Feroxa's arena, whose ground the map patch swaps mid-fight.
{
  const feroxa = lua('scripts/quests/grimvale/globalevents_grimvale_feroxa.lua')
  const respawn = lua('scripts/world_changes/grimvale_respawn_event.lua')
  const day = Number(feroxa.match(/spawnDay\s*=\s*(\d+)/)?.[1] ?? 13)
  const broadcast = feroxa.match(/broadcastMessage\("([^"]+)"/)

  const vale = positions(respawn).map((m) => ({ x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }))
  const valeBox = vale.length >= 2
    ? {
        x1: Math.min(vale[0].x, vale[1].x),
        y1: Math.min(vale[0].y, vale[1].y),
        x2: Math.max(vale[0].x, vale[1].x),
        y2: Math.max(vale[0].y, vale[1].y),
        floors: [vale[0].z],
      }
    : null

  // The werecreatures the 13th swaps IN, and the ordinary wildlife it swaps out.
  const lists = [...respawn.matchAll(/\{\s*("(?:[^"]+)"(?:\s*,\s*"[^"]+")*)\s*\}/g)].map((m) =>
    [...m[1].matchAll(/"([^"]+)"/g)].map((w) => w[1])
  )
  const proper = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase())

  const arena = patch('full_moon', 'middle')

  changes.push({
    id: 'full_moon',
    kind: 'monthly',
    chance: 100,
    day,
    spots: [
      {
        key: 'grimvale',
        label: 'Grimvale',
        x: valeBox ? Math.round((valeBox.x1 + valeBox.x2) / 2) : 33340,
        y: valeBox ? Math.round((valeBox.y1 + valeBox.y2) / 2) : 31680,
        z: valeBox ? valeBox.floors[0] : 7,
        bounds: valeBox,
        phrase: null,
        // What the day-13 roll puts on the ground, and what it replaces.
        creatures: (lists[0] ?? []).map(proper),
        instead: (lists[1] ?? []).map(proper),
      },
    ],
    inside: arena
      ? {
          label: "Feroxa's arena",
          x: Math.round((arena.x1 + arena.x2) / 2),
          y: Math.round((arena.y1 + arena.y2) / 2),
          z: arena.floors[0],
          bounds: arena,
          floors: arena.floors,
          creatures: [{ name: 'Feroxa', spawns: 1 }],
        }
      : null,
    requirement: null,
    phrases: broadcast ? [{ from: 'broadcast', text: broadcast[1], spot: null }] : [],
    sources: [
      'scripts/world_changes/grimvale_respawn_event.lua',
      'scripts/quests/grimvale/globalevents_grimvale_feroxa.lua',
    ],
  })
}

// --- 5. Their Master's Voice --------------------------------------------------
// A silent one: no crier, no broadcast. One morning in five the stone floor of a
// cave east of Edron sprouts slime fungus, and that is the only tell.
{
  const src = lua('scripts/world_changes/their_masters_voice.lua')
  const chance = Number(src.match(/math\.random\(100\)\s*<=\s*(\d+)/)?.[1] ?? 0)
  const xr = src.match(/for x = (\d+), (\d+) do/)
  const yr = src.match(/for y = (\d+), (\d+) do/)
  const z = Number(src.match(/Position\(x,\s*y,\s*(\d+)\)/)?.[1] ?? 9)
  const box = xr && yr
    ? { x1: Number(xr[1]), y1: Number(yr[1]), x2: Number(xr[2]), y2: Number(yr[2]), floors: [z] }
    : null

  if (box) {
    changes.push({
      id: 'their_masters_voice',
      kind: 'chance',
      chance,
      day: null,
      spots: [
        {
          key: 'edron-caves',
          label: 'Edron (underground)',
          x: Math.round((box.x1 + box.x2) / 2),
          y: Math.round((box.y1 + box.y2) / 2),
          z,
          bounds: box,
          phrase: null,
        },
      ],
      inside: null,
      requirement: null,
      phrases: [],
      sources: ['scripts/world_changes/their_masters_voice.lua', 'npc/servant_sentry.lua'],
    })
  }
}

// --- 6. Day & night visitors --------------------------------------------------
// Not a dice roll but the same idea: NPCs the server adds and removes as Tibian
// day turns to night. Two of them share a tile in Feyrist and never meet.
{
  const src = lua('scripts/world_changes/spawns_npc_by_time.lua')
  // The script only knows coordinates. Naming the region is only done where the
  // ground says so beyond doubt — Talila and Valindara share a tile ringed by
  // fauns, nymphs and pixies, which is Feyrist and nowhere else. The ghostly
  // wolf's islet south of Cormaya has no such tell, so it stays unlabelled and
  // lets the pin speak.
  const PLACE = { Talila: 'Feyrist', Valindara: 'Feyrist' }
  const spots = []
  for (const m of src.matchAll(
    /\{\s*name\s*=\s*"([^"]+)",\s*spawnPeriod\s*=\s*LIGHT_STATE_(\w+),\s*despawnPeriod\s*=\s*LIGHT_STATE_\w+,\s*position\s*=\s*Position\((\d+),\s*(\d+),\s*(\d+)\),?\s*\}/g
  )) {
    const [, name, period, x, y, z] = m
    spots.push({
      key: name.toLowerCase().replace(/\s+/g, '-'),
      label: `${name} — ${PLACE[name] ?? ''}`.trim().replace(/—\s*$/, '').trim(),
      x: Number(x),
      y: Number(y),
      z: Number(z),
      bounds: null,
      phrase: null,
      // SUNSET = comes out at night, SUNRISE = only by day.
      when: period === 'SUNSET' ? 'night' : 'day',
      npc: name,
    })
  }

  if (spots.length) {
    changes.push({
      id: 'day_night_npcs',
      kind: 'daynight',
      chance: 100,
      day: null,
      spots,
      inside: null,
      requirement: null,
      phrases: [],
      sources: ['scripts/world_changes/spawns_npc_by_time.lua'],
    })
  }
}

fs.writeFileSync(
  outFile,
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), changes }) + '\n'
)

const spots = changes.reduce((n, c) => n + c.spots.length, 0)
const quoted = changes.reduce((n, c) => n + c.phrases.length, 0)
console.log(`world-changes.json: ${changes.length} changes, ${spots} spots, ${quoted} quoted lines`)
for (const c of changes) {
  const foot = c.spots.filter((s) => s.bounds).length
  console.log(
    `  - ${c.id}: ${c.spots.length} spot(s), ${foot} with a map patch, ` +
      `${c.phrases.length} line(s)${c.inside ? `, inside: ${c.inside.creatures.length} species` : ''}`
  )
}
