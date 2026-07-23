// Parse the OT server's raid definitions (`ot/data-otservbr-global/raids/`) and
// emit `frontend/public/raids.json` — the "Invasiones" map layer.
//
//   node tools/gen-raids.mjs
//
// Each raid is an XML file with three element types:
//   <announce delay type message>            the literal broadcast players read
//   <singlespawn delay name x y z>           one named creature (almost always the boss)
//   <areaspawn delay from{x,y,z} to{x,y,z}>  a rectangle filled with <monster name amount>
//
// `raids/raids.xml` indexes them all, grouped by `<!-- City -->` comments, and
// carries the scheduling knobs: interval2 (minutes between rolls) and margin
// (weight used when several raids compete for the same slot).
//
// The output keeps the raw announcement text — that string is the whole point of
// the layer, it is what the world actually says when the invasion fires.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const otDir = path.join(root, 'ot', 'data-otservbr-global')
const raidsDir = path.join(otDir, 'raids')
const outFile = path.join(root, 'frontend', 'public', 'raids.json')

/**
 * Loot entries of one monster lua, as `{ item, chance }`. Items are written two
 * ways — `name = "amazon helmet"` or `id = 3393` with the name in a trailing
 * comment — so both are normalised to the lowercase item name, which is what
 * makes variants comparable to their base monster.
 */
function parseLoot(src) {
  const block = src.match(/monster\.loot\s*=\s*\{([\s\S]*?)\n\}/)
  if (!block) return []
  const out = []
  for (const line of block[1].split('\n')) {
    if (!line.includes('chance')) continue
    const named = line.match(/name\s*=\s*"([^"]+)"/)
    const comment = line.match(/--\s*(.+?)\s*$/)
    const id = line.match(/id\s*=\s*(\d+)/)
    const item = named?.[1] ?? comment?.[1] ?? (id ? `#${id[1]}` : null)
    const chance = line.match(/chance\s*=\s*(\d+)/)
    if (item && chance) out.push({ item: item.toLowerCase(), chance: Number(chance[1]) })
  }
  return out
}

/**
 * Raids spawn creatures by monster-TYPE key, which is not always the creature's
 * name. `monster/raids/` holds special-drop variants whose key describes the
 * intent: createMonsterType("Orc Helmet") is really an Orc Warlord carrying an
 * extra item. Two things fall out of that and both matter to the layer:
 *
 *  - the display name, so it never claims "Orc Helmet" is a boss;
 *  - what the variant carries that its BASE monster does not. Diffing the two
 *    loot tables is what surfaces the Amazon set (helmet/shield/armour at 5%,
 *    only obtainable from the Thais orc raid) and Venore's guaranteed backpack.
 */
function monsterIndex(dir) {
  const files = []
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name)
      if (e.isDirectory()) walk(f)
      else if (f.endsWith('.lua')) files.push(f)
    }
  }
  walk(dir)

  const byKey = new Map()
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    const key = src.match(/createMonsterType\("([^"]+)"\)/)
    if (!key) continue
    const display = src.match(/^\s*monster\.name\s*=\s*"([^"]+)"/m)
    byKey.set(key[1].toLowerCase(), {
      name: display ? display[1] : key[1],
      loot: parseLoot(src),
      drops: [],
    })
  }

  // A variant is any type whose key is not its creature's name. What it adds on
  // top of the base creature's loot is the reason the raid exists.
  for (const [key, m] of byKey) {
    if (key === m.name.toLowerCase()) continue
    const base = byKey.get(m.name.toLowerCase())
    if (!base) continue
    const had = new Set(base.loot.map((l) => l.item))
    m.drops = m.loot.filter((l) => !had.has(l.item)).map((l) => ({ item: l.item, chance: l.chance }))
  }

  return byKey
}
const MONSTERS = monsterIndex(path.join(otDir, 'monster'))

// Coordinates outside the real world map are script artefacts (test rooms).
const X_MIN = 30000, X_MAX = 34500, Y_MIN = 30500, Y_MAX = 33500, Z_MAX = 15
const inWorld = (x, y, z) => x >= X_MIN && x <= X_MAX && y >= Y_MIN && y <= Y_MAX && z >= 0 && z <= Z_MAX

// Folder name -> display region. The index's `<!-- ... -->` comments say the same
// thing but are inconsistently spelled, so the folder is the key and this is the
// label. Kept in English: all but two are city names that read the same in both
// site languages, and the frontend translates the odd ones out off `regionKey`.
const REGIONS = {
  abdendriel: "Ab'Dendriel",
  ankrahmun: 'Ankrahmun',
  carlin: 'Carlin',
  chayenne: "Chayenne's Realm",
  darashia: 'Darashia',
  edron: 'Edron',
  farmine: 'Farmine',
  fury_gate: 'Fury Gates',
  kazordoon: 'Kazordoon',
  liberty_bay: 'Liberty Bay',
  oramond: 'Oramond',
  port_hope: 'Port Hope',
  rookgaard: 'Rookgaard',
  roshamuul: 'Roshamuul',
  svargrond: 'Svargrond',
  thais: 'Thais',
  venore: 'Venore',
}

const attrs = (tag) => {
  const out = {}
  // Digits matter: the scheduling attribute is literally named `interval2`.
  for (const m of tag.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2]
  return out
}
const num = (v) => (v === undefined ? undefined : Number(v))
// Announcement text is often wrapped across source lines; collapse to one line.
const clean = (s) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")

const MINOR = new Set(['the', 'of', 'and', 'a'])

/** "the Horned Fox" / "Minotaur mage" -> "The Horned Fox" / "Minotaur Mage". */
const properName = (s) =>
  s
    .split(/\s+/)
    .map((w, i) => (i > 0 && MINOR.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')

/**
 * Raid monster-type key -> the creature name the codex knows. OT capitalisation
 * is inconsistent too ("the Horned Fox", "Minotaur mage"), so normalise both.
 */
const creatureName = (raw) => properName(MONSTERS.get(raw.toLowerCase())?.name ?? raw)

/**
 * What this raid variant carries beyond its ordinary self, as `{ item, chance }`
 * with chance already in percent. Empty for a plain creature.
 */
function creatureDrops(raw) {
  const drops = MONSTERS.get(raw.toLowerCase())?.drops ?? []
  return drops.map((d) => ({ item: d.item, chance: d.chance / 1000 }))
}

/** Read one raid file into { announcements, spawns, areas }. */
function parseRaidFile(file) {
  const xml = fs.readFileSync(file, 'utf8')
  const announcements = []
  const spawns = []
  const areas = []

  for (const m of xml.matchAll(/<announce\b[^>]*\/?>/g)) {
    const a = attrs(m[0])
    const message = clean(a.message ?? '')
    if (message) announcements.push({ delay: num(a.delay) ?? 0, message })
  }

  for (const m of xml.matchAll(/<singlespawn\b[^>]*\/?>/g)) {
    const a = attrs(m[0])
    const [x, y, z] = [num(a.x), num(a.y), num(a.z)]
    if (!a.name || !inWorld(x, y, z)) continue
    const drops = creatureDrops(a.name)
    spawns.push({
      name: creatureName(a.name),
      x,
      y,
      z,
      delay: num(a.delay) ?? 0,
      ...(drops.length ? { drops } : {}),
    })
  }

  // <areaspawn ...> ... <monster/> ... </areaspawn> — the monsters belong to the
  // enclosing rectangle, so the block has to be matched as a whole.
  for (const m of xml.matchAll(/<areaspawn\b([^>]*)>([\s\S]*?)<\/areaspawn>/g)) {
    const a = attrs('<x' + m[1] + '>')
    const x1 = Math.min(num(a.fromx), num(a.tox))
    const x2 = Math.max(num(a.fromx), num(a.tox))
    const y1 = Math.min(num(a.fromy), num(a.toy))
    const y2 = Math.max(num(a.fromy), num(a.toy))
    const z = num(a.fromz)
    if (!inWorld(x1, y1, z) || !inWorld(x2, y2, z)) continue

    const monsters = []
    for (const mm of m[2].matchAll(/<monster\b[^>]*\/?>/g)) {
      const ma = attrs(mm[0])
      if (!ma.name) continue
      const drops = creatureDrops(ma.name)
      monsters.push({
        name: creatureName(ma.name),
        amount: num(ma.amount) ?? 1,
        ...(drops.length ? { drops } : {}),
      })
    }
    // Plenty of raids express a named spawn as a 1x1 "area" (Munster, Apprentice
    // Sheng, Rottie the Rotworm…). Fold those back into point spawns so they are
    // pinned — and named — like the singlespawn bosses they really are.
    if (x1 === x2 && y1 === y2) {
      for (const mo of monsters) {
        spawns.push({
          name: mo.name,
          x: x1,
          y: y1,
          z,
          delay: num(a.delay) ?? 0,
          amount: mo.amount,
          ...(mo.drops ? { drops: mo.drops } : {}),
        })
      }
      continue
    }

    areas.push({ x1, y1, x2, y2, z, delay: num(a.delay) ?? 0, monsters })
  }

  return { announcements, spawns, areas }
}

// --- index -------------------------------------------------------------------
const indexXml = fs.readFileSync(path.join(raidsDir, 'raids.xml'), 'utf8')
// Drop commented-out raids (e.g. venore/feverish_citizen) — they never fire.
const liveIndex = indexXml.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))

/** Every raid XML on disk, relative to raidsDir, forward-slashed. */
function allRaidFiles(dir, base = dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...allRaidFiles(f, base))
    else if (f.endsWith('.xml')) out.push(path.relative(base, f).split(path.sep).join('/'))
  }
  return out
}

// The index only schedules ~62 of the 87 raid files. The rest (Ferumbras,
// Furyosa, The Pale Count, Hirintror…) are perfectly real encounters that this
// distro simply doesn't put on the timer, so they are kept and flagged
// `scheduled: false` instead of being dropped.
const indexed = new Map()
for (const m of liveIndex.matchAll(/<raid\b[^>]*\/>/g)) {
  const a = attrs(m[0])
  if (a.file) indexed.set(a.file, a)
}

const titleCase = (slug) =>
  slug
    .split('_')
    .map((w, i) => (i > 0 && MINOR.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')

const raids = []
const skipped = []
// Some raid files are byte-identical copies of another (rookgaard/rottie1.xml is
// rats.xml, mislabelled "Rottie The Rotworm katana" in the index). Identical
// spawn geometry means the same event, so only the first one is kept.
const seen = new Map()

// Scheduled files first, so a duplicate pair keeps the one that actually fires.
const files = allRaidFiles(raidsDir).sort(
  (p, q) => Number(indexed.has(q)) - Number(indexed.has(p))
)

for (const rel of files) {
  if (rel === 'raids.xml') continue
  const a = indexed.get(rel) ?? {}
  const file = path.join(raidsDir, rel)

  const { announcements, spawns, areas } = parseRaidFile(file)
  if (!spawns.length && !areas.length) {
    skipped.push(`${rel}: no usable coordinates`)
    continue
  }

  const sig = JSON.stringify([spawns, areas])
  if (seen.has(sig)) {
    skipped.push(`${rel}: duplicate of ${seen.get(sig)}`)
    continue
  }
  seen.set(sig, rel)

  // Bounding box over everything the raid touches, for the map pin + fit-bounds.
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const s of spawns) {
    x1 = Math.min(x1, s.x); x2 = Math.max(x2, s.x)
    y1 = Math.min(y1, s.y); y2 = Math.max(y2, s.y)
  }
  for (const ar of areas) {
    x1 = Math.min(x1, ar.x1); x2 = Math.max(x2, ar.x2)
    y1 = Math.min(y1, ar.y1); y2 = Math.max(y2, ar.y2)
  }

  // The pin sits on the named creature when there is one (that IS the event),
  // otherwise on the centre of the invaded ground.
  const anchor = spawns[0] ?? null
  const floors = [...new Set([...spawns.map((s) => s.z), ...areas.map((ar) => ar.z)])].sort((p, q) => p - q)

  // Total creature count across the whole raid, so the list can sort by scale.
  const total =
    areas.reduce((n, ar) => n + ar.monsters.reduce((k, mo) => k + mo.amount, 0), 0) +
    spawns.reduce((n, s) => n + (s.amount ?? 1), 0)

  const dir = rel.split('/')[0]
  const slug = path.basename(rel, '.xml')
  // Labels: the index codes are internal shorthand ("GoEdron", "Orcss") and the
  // first singlespawn lies whenever the raid also floods an area (horned.xml
  // summons a "Minotaur mage" alongside the fox). The file name is the reliable
  // source — except when it is a shortening of a boss the raid summons
  // ("horned" -> "The Horned Fox", "mad_mage" -> "Mad Mage"), where the full
  // creature name wins. Matching is word-wise on purpose: a bare prefix would let
  // "orcs" latch onto "Orc Shield" and "dragons" onto "Dragon Lord".
  const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  // Trailing counters distinguish repeats of the same encounter at different
  // spots (midnight_panther_1, rottie2) and must not block the name match —
  // including when they are glued to the word.
  const slugWords = words(slug.replace(/(\d+)/g, ' $1 ')).filter((w) => !/^\d+$/.test(w))
  const contains = (hay, needle) =>
    hay.some((_, i) => needle.every((w, k) => hay[i + k] === w))
  const fuller = spawns.find((s) => contains(words(s.name), slugWords))
  const name = fuller ? fuller.name : titleCase(slug)

  raids.push({
    id: rel.replace(/\.xml$/, ''),
    name,
    code: a.name ?? null,
    region: REGIONS[dir] ?? dir,
    regionKey: dir,
    // On the timer in raids.xml? The rest are real encounters this distro just
    // doesn't schedule (Ferumbras, Furyosa, The Pale Count…).
    scheduled: indexed.has(rel),
    // interval2 is in minutes; margin is the relative weight in the raid roll.
    interval: num(a.interval2) ?? null,
    margin: num(a.margin) ?? null,
    x: anchor ? anchor.x : Math.round((x1 + x2) / 2),
    y: anchor ? anchor.y : Math.round((y1 + y2) / 2),
    z: anchor ? anchor.z : floors[0],
    bounds: { x1, y1, x2, y2 },
    floors,
    bosses: [...new Set(spawns.map((s) => s.name))],
    creatures: total,
    announcements,
    spawns,
    areas,
  })
}

// The same encounter can be staged at several spots inside one region (three
// Crustacea Gigantica sites around Liberty Bay). Number those so the list has no
// ambiguous twins — but leave same-named raids in different regions alone, since
// the region already tells Carlin's orc invasion from Edron's.
const nameCounts = new Map()
const regionName = (r) => `${r.regionKey} ${r.name}`
for (const r of raids) nameCounts.set(regionName(r), (nameCounts.get(regionName(r)) ?? 0) + 1)
const nameSeen = new Map()
for (const r of raids) {
  const key = regionName(r)
  if (nameCounts.get(key) === 1) continue
  const n = (nameSeen.get(key) ?? 0) + 1
  nameSeen.set(key, n)
  r.name = `${r.name} ${n}`
}

raids.sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name))

fs.writeFileSync(
  outFile,
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), raids }) + '\n'
)

const withBoss = raids.filter((r) => r.bosses.length).length
console.log(`raids.json: ${raids.length} raids (${withBoss} with a named boss), ${skipped.length} skipped`)
for (const s of skipped) console.log(`  - ${s}`)
