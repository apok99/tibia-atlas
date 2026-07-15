import type { HuntZone } from '../hooks/useHunts'

// --- AFK Hero: the idle-hunt game engine ---------------------------------------
// Pure functions + types for the /idle game. Your character keeps hunting a real
// Tibia zone (data from the Hunt Finder API) while the tab is closed; on return
// the elapsed time is simulated level-by-level. Everything here is deterministic
// and framework-free so the hook/page stay thin and the math is testable.

export type IdleVocation = 'knight' | 'paladin' | 'sorcerer' | 'druid' | 'monk'
export const IDLE_VOCATIONS: IdleVocation[] = ['knight', 'paladin', 'sorcerer', 'druid', 'monk']

// A creature frozen into the zone snapshot (subset of the Hunt Finder payload).
export type IdleCreature = {
  slug: string
  name: string
  image: string | null
  hp: number
  experience: number
  gold: number
  count: number
  tooDangerous: boolean
}

// The hunting ground the hero is parked in: a snapshot of a Hunt Finder zone,
// stored in the save so offline progress needs no network. `fetchedAtLevel`
// lets the UI nudge the player to re-scout once they outgrow it.
export type IdleZone = {
  id: number
  name: string
  x: number
  y: number
  z: number
  danger: number
  expAvg: number
  fetchedAtLevel: number
  creatures: IdleCreature[]
}

export type IdleUpgrades = { weapon: number; armor: number; training: number }
export type IdleUpgradeKind = keyof IdleUpgrades

export type IdleSave = {
  v: 1
  name: string
  vocation: IdleVocation
  xp: number
  gold: number
  upgrades: IdleUpgrades
  zone: IdleZone | null
  lastTick: number // epoch ms of the last simulated instant
  totalKills: number
  createdAt: number
}

export const IDLE_STORAGE_KEY = 'idle:v1'

// Mainland start: fresh Tibia characters leave Rookgaard at level 8.
export const IDLE_START_LEVEL = 8

// Progress keeps accruing this long after the tab closes. Long enough to sleep
// on it, short enough that checking in daily still matters.
export const OFFLINE_CAP_SEC = 12 * 3600

// --- Tibia's real experience curve ---------------------------------------------
// Total experience required to BE level l — the game's actual formula.
export function xpForLevel(l: number): number {
  return Math.round((50 / 3) * (l * l * l - 6 * l * l + 17 * l - 12))
}

export function levelFromXp(xp: number): number {
  let l = 1
  while (xpForLevel(l + 1) <= xp && l < 3000) l++
  return l
}

// --- Derived hero stats ----------------------------------------------------------
// Mirrors the Hunt Finder's danger model (HP per level per vocation) so what the
// API calls "too dangerous" and what we simulate stay coherent.
const HP_PER_LEVEL: Record<IdleVocation, number> = {
  knight: 15,
  paladin: 12,
  monk: 13,
  sorcerer: 6,
  druid: 6,
}

// Damage leaning per vocation: mages burn faster, knights endure.
const DPS_MOD: Record<IdleVocation, number> = {
  knight: 0.9,
  paladin: 1.05,
  monk: 1.0,
  sorcerer: 1.25,
  druid: 1.15,
}

export function heroDps(level: number, vocation: IdleVocation, up: IdleUpgrades): number {
  return (10 + level * 2.1) * DPS_MOD[vocation] * (1 + 0.22 * up.weapon) * (1 + 0.1 * up.training)
}

export function heroHp(level: number, vocation: IdleVocation, up: IdleUpgrades): number {
  return (185 + level * HP_PER_LEVEL[vocation]) * (1 + 0.15 * up.armor)
}

// --- Hunt rates ------------------------------------------------------------------
// Seconds lost per kill on walking, targeting and looting.
const KILL_OVERHEAD_SEC = 2

export type IdleRates = { xpPerSec: number; goldPerSec: number; killsPerSec: number }

// Average the zone's population (weighted by spawn count): how fast the hero
// clears a creature, and what each corpse pays. Creatures the Hunt Finder deems
// lethal are skipped — the hero hunts around them, like a sane player would.
export function huntRates(
  zone: IdleZone,
  level: number,
  vocation: IdleVocation,
  up: IdleUpgrades,
): IdleRates {
  const dps = heroDps(level, vocation, up)
  const pool = zone.creatures.filter((c) => !c.tooDangerous && c.hp > 0)
  const prey = pool.length > 0 ? pool : zone.creatures.filter((c) => c.hp > 0)
  if (prey.length === 0 || dps <= 0) return { xpPerSec: 0, goldPerSec: 0, killsPerSec: 0 }

  let w = 0
  let killTime = 0
  let xp = 0
  let gold = 0
  for (const c of prey) {
    const n = Math.max(1, c.count)
    w += n
    killTime += n * (c.hp / dps + KILL_OVERHEAD_SEC)
    xp += n * c.experience
    gold += n * c.gold
  }
  const avgKillTime = killTime / w
  // Danger drag: a spicy zone forces retreats and potions — up to 35% slower.
  const caution = 1 - 0.35 * Math.min(1, Math.max(0, zone.danger))
  const killsPerSec = caution / avgKillTime
  return {
    xpPerSec: (xp / w) * killsPerSec,
    goldPerSec: (gold / w) * killsPerSec,
    killsPerSec,
  }
}

// --- Upgrades ----------------------------------------------------------------------
// Geometric prices: each tier costs ~75% more than the last.
const UPGRADE_BASE_COST: Record<IdleUpgradeKind, number> = {
  weapon: 2000,
  armor: 1500,
  training: 3500,
}

export function upgradeCost(kind: IdleUpgradeKind, currentTier: number): number {
  return Math.round(UPGRADE_BASE_COST[kind] * Math.pow(1.75, currentTier))
}

// --- Simulation --------------------------------------------------------------------
export type IdleSimResult = {
  xpGained: number
  goldGained: number
  killsGained: number
  levelsGained: number
  simulatedSec: number
  capped: boolean
}

// Advance the save by `elapsedSec` of hunting. Piecewise: rates depend on the
// hero's level, so each iteration runs at most up to the next level-up, then
// recomputes. Mutates nothing — returns the new save plus a gains summary.
export function simulate(save: IdleSave, elapsedSec: number): { save: IdleSave; result: IdleSimResult } {
  const capped = elapsedSec > OFFLINE_CAP_SEC
  let dt = Math.max(0, Math.min(elapsedSec, OFFLINE_CAP_SEC))
  const simulatedSec = dt
  const startLevel = levelFromXp(save.xp)

  let xp = save.xp
  let gold = save.gold
  let kills = save.totalKills

  if (save.zone) {
    for (let i = 0; i < 400 && dt > 0.001; i++) {
      const level = levelFromXp(xp)
      const rates = huntRates(save.zone, level, save.vocation, save.upgrades)
      if (rates.xpPerSec <= 0) break
      const xpToNext = xpForLevel(level + 1) - xp
      const step = Math.min(dt, xpToNext / rates.xpPerSec + 0.001)
      xp += rates.xpPerSec * step
      gold += rates.goldPerSec * step
      kills += rates.killsPerSec * step
      dt -= step
    }
  }

  const next: IdleSave = { ...save, xp, gold, totalKills: kills }
  return {
    save: next,
    result: {
      xpGained: xp - save.xp,
      goldGained: gold - save.gold,
      killsGained: kills - save.totalKills,
      levelsGained: levelFromXp(xp) - startLevel,
      simulatedSec,
      capped,
    },
  }
}

// --- Save helpers ---------------------------------------------------------------------
export function newSave(name: string, vocation: IdleVocation, now: number): IdleSave {
  return {
    v: 1,
    name,
    vocation,
    xp: xpForLevel(IDLE_START_LEVEL),
    gold: 0,
    upgrades: { weapon: 0, armor: 0, training: 0 },
    zone: null,
    lastTick: now,
    totalKills: 0,
    createdAt: now,
  }
}

export function loadSave(): IdleSave | null {
  try {
    const raw = localStorage.getItem(IDLE_STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as IdleSave
    if (s?.v !== 1 || !IDLE_VOCATIONS.includes(s.vocation)) return null
    return s
  } catch {
    return null
  }
}

export function persistSave(save: IdleSave): void {
  try {
    localStorage.setItem(IDLE_STORAGE_KEY, JSON.stringify(save))
  } catch {
    /* quota / private mode — the run simply lives in memory */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(IDLE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

// Freeze a Hunt Finder zone into the save. Creatures are capped to the 12 most
// numerous so the snapshot stays small in localStorage.
export function snapshotZone(zone: HuntZone, level: number): IdleZone {
  const creatures = [...zone.creatures]
    .filter((c) => !c.boss)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      image: c.image,
      hp: c.hp,
      experience: c.experience,
      gold: c.gold,
      count: c.count,
      tooDangerous: c.too_dangerous,
    }))
  return {
    id: zone.id,
    name: zone.name ?? 'Wilderness',
    x: zone.x,
    y: zone.y,
    z: zone.z,
    danger: zone.danger,
    expAvg: zone.exp_avg,
    fetchedAtLevel: level,
    creatures,
  }
}
