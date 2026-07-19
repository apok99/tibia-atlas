// Client-side "your character" profile for the map. Deliberately server-free:
// the chosen character name and the equipment set the user picks live in
// localStorage, and the live character data (level, vocation, world, house,
// deaths) is fetched on demand from the /api/character/{name} proxy. This is
// the wiring the map's personal overlay (house pin, death markers, level-aware
// hunt hints) and the Hunt Finder's real-gear scoring read from.

import { api } from './api'

const KEY = 'tibiaAtlas.char'

// Canonical equipment slots, in head-to-toe display order (mirrors GearRules::SLOTS).
export const GEAR_SLOTS = [
  'head',
  'neck',
  'body',
  'weapon',
  'offhand',
  'legs',
  'finger',
  'feet',
  'ammo',
] as const
export type GearSlot = (typeof GEAR_SLOTS)[number]

// One equipped piece: enough to render the slot card and query stats by id.
// TibiaData doesn't expose worn equipment, so the set is picked by hand.
export type GearPiece = { id: number; slug: string; name: string; image: string | null }
export type CharGear = Partial<Record<GearSlot, GearPiece>>

// The persisted profile: the name the user typed plus the gear they picked.
// The world/level/etc. are authoritative from TibiaData, so we never store
// them — we refetch.
export type CharProfile = { name: string; gear?: CharGear }

// A recent death, trimmed by the backend proxy.
export type CharDeath = {
  time: string | null
  level: number | null
  reason: string | null
  killers: { name: string | null; player: boolean }[]
}

// The live character payload from GET /api/character/{name}.
export type Character = {
  name: string
  level: number | null
  vocation: string | null
  sex: string | null
  world: string | null
  residence: string | null
  guild: { name: string; rank: string | null } | null
  houses: { name: string | null; town: string | null; houseid: number | null }[]
  last_login: string | null
  deaths: CharDeath[]
}

export function loadCharProfile(): CharProfile | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj.name !== 'string' || !obj.name) return null
    // Rebuild the gear map defensively: only known slots, only sane pieces —
    // a stale/hand-edited blob must never break the map page.
    const gear: CharGear = {}
    if (obj.gear && typeof obj.gear === 'object') {
      for (const slot of GEAR_SLOTS) {
        const p = obj.gear[slot]
        if (p && typeof p.id === 'number' && typeof p.slug === 'string' && typeof p.name === 'string') {
          gear[slot] = { id: p.id, slug: p.slug, name: p.name, image: typeof p.image === 'string' ? p.image : null }
        }
      }
    }
    return Object.keys(gear).length ? { name: obj.name, gear } : { name: obj.name }
  } catch {
    return null
  }
}

export function saveCharProfile(p: CharProfile | null): void {
  try {
    if (p && p.name.trim()) {
      const gear = p.gear && Object.keys(p.gear).length ? p.gear : undefined
      localStorage.setItem(KEY, JSON.stringify({ name: p.name.trim(), ...(gear ? { gear } : {}) }))
    } else localStorage.removeItem(KEY)
  } catch {
    /* storage full / disabled — profile just won't persist */
  }
}

// Entry ids of the equipped pieces, sorted so the hunts/set-stats query keys
// (and the server-side cache keys) are stable regardless of pick order.
export function gearIds(p: CharProfile | null): number[] {
  if (!p?.gear) return []
  return Object.values(p.gear)
    .map((piece) => piece.id)
    .sort((a, b) => a - b)
}

// Fetch a character by name. Returns null when the name is unknown (found:false)
// so callers can show a "no such character" hint; throws only on a real error.
export async function fetchCharacter(name: string): Promise<Character | null> {
  const { data } = await api.get<{ found: boolean; character?: Character }>(
    `/character/${encodeURIComponent(name.trim())}`,
  )
  return data.found && data.character ? data.character : null
}
