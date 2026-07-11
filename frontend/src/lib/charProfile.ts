// Client-side "your character" profile for the map. Deliberately server-free:
// the chosen character name lives in localStorage, and the live character data
// (level, vocation, world, house, deaths) is fetched on demand from the
// /api/character/{name} proxy. This is the wiring the map's personal overlay
// (house pin, death markers, level-aware hunt hints) reads from.

import { api } from './api'

const KEY = 'tibiaAtlas.char'

// The persisted profile: just the name the user typed. The world/level/etc. are
// authoritative from TibiaData, so we never store them — we refetch.
export type CharProfile = { name: string }

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
    return obj && typeof obj.name === 'string' && obj.name ? { name: obj.name } : null
  } catch {
    return null
  }
}

export function saveCharProfile(p: CharProfile | null): void {
  try {
    if (p && p.name.trim()) localStorage.setItem(KEY, JSON.stringify({ name: p.name.trim() }))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage full / disabled — profile just won't persist */
  }
}

// Fetch a character by name. Returns null when the name is unknown (found:false)
// so callers can show a "no such character" hint; throws only on a real error.
export async function fetchCharacter(name: string): Promise<Character | null> {
  const { data } = await api.get<{ found: boolean; character?: Character }>(
    `/character/${encodeURIComponent(name.trim())}`,
  )
  return data.found && data.character ? data.character : null
}
