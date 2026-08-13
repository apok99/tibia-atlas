// Extract, from the OT server scripts, every boss the server hands out with a
// PER-PLAYER cooldown — lever rooms and portal instances. Prints the PHP array
// body for `App\Support\WorldBossRule::INSTANCED`, which keeps those bosses off
// the map's Boss Watch rail (their "respawn" is per player, so a heat reading is
// meaningless — they are always available to whoever hasn't fought them today).
//
//   node tools/gen-instanced-bosses.mjs [--path=<data root>]
//
// Two mechanics produce the same semantics, so both are read:
//
//   BossLever(config)                  config.boss.name  — the lever quests
//     (data/libs/functions/boss_lever.lua wraps canFightBoss + setBossCooldown)
//   MoveEvent onStepIn portals         config[i].bossName, in a file that calls
//     `player:setBossCooldown(...)` / `canFightBoss(...)` itself
//
// The `bossName` key alone is NOT enough: the "Killing in the Name of..." task
// scripts use it too, and those bosses (Kerberos, Leviathan, Demodras, The Old
// Widow…) live in the open world on real respawn timers. Requiring the file to
// actually call the cooldown API is what separates the two.
//
// Why this exists at all: `meta.ot.quest_area` (the monster lua's folder under
// `monster/quests/`) catches most instanced bosses, but a boss whose lua sits in
// `monster/bosses/` reports no quest area even though a lever gates it —
// Bakragore, Ichgahal, Murcion, Chagorz and Vemiath (Rotten Blood) all leaked
// onto the rail that way. The script layer knows the truth; the folder doesn't.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv.find((a) => a.startsWith('--path='))?.slice(7)
const otDir = arg
  ? path.resolve(arg)
  : [path.join(root, 'ot'), path.join(root, 'new ot')].find((d) => fs.existsSync(d))

if (!otDir || !fs.existsSync(otDir)) {
  console.error('OT clone not found — pass --path=<repo>/ot')
  process.exit(1)
}

/** Every balanced `{ … }` body in the source, innermost occurrences included. */
function blocks(src) {
  const out = []
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '{') continue
    let depth = 1
    let j = i + 1
    while (j < src.length && depth) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
      j++
    }
    out.push(src.slice(i + 1, j - 1))
  }
  return out
}

/** The `boss = { name = "…" }` of each BossLever config in the source. */
function leverBosses(src) {
  const out = []
  for (const m of src.matchAll(/boss\s*=\s*\{/g)) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < src.length && depth) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    const name = src.slice(m.index + m[0].length, i).match(/name\s*=\s*"([^"]+)"/)
    if (name) out.push(name[1])
  }
  return out
}

const found = new Map() // lowercased name → source file (for the report)

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(p)
      continue
    }
    if (!e.name.endsWith('.lua')) continue
    // The library that DEFINES the mechanic, and the GM debug talkaction, name
    // bosses only as examples — they gate nothing.
    if (/libs[\\/]functions|manage_kv/.test(p)) continue

    const src = fs.readFileSync(p, 'utf8')
    const rel = path.relative(otDir, p).replace(/\\/g, '/')
    const names = []
    if (/setBossCooldown|canFightBoss/.test(src)) {
      for (const b of blocks(src)) {
        const m = b.match(/bossName\s*=\s*"([^"]+)"/)
        if (m) names.push(m[1])
      }
    }
    if (src.includes('BossLever')) names.push(...leverBosses(src))

    for (const n of names) {
      if (!found.has(n.toLowerCase())) found.set(n.toLowerCase(), rel)
    }
  }
}

walk(otDir)

const names = [...found.keys()].sort()
console.error(`${names.length} cooldown-gated bosses`)
for (const n of names) console.error(`  ${n.padEnd(30)} ${found.get(n)}`)

// PHP body, chunked so the const stays readable in the diff.
console.log('    public const INSTANCED = [')
for (let i = 0; i < names.length; i += 3) {
  console.log('        ' + names.slice(i, i + 3).map((n) => `'${n.replace(/'/g, "\\'")}'`).join(', ') + ',')
}
console.log('    ];')
