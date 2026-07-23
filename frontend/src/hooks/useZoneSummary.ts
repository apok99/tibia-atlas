import { keepPreviousData, useQuery } from '@tanstack/react-query'
import i18n from '../i18n'
import { api } from '../lib/api'

// The rectangle the user dragged on the map, in Tibia world coordinates
// (normalised: x1 <= x2, y1 <= y2). The floor is NOT part of the box — it comes
// from the map's floor control, so keeping the selection while flipping floors
// re-analyzes the same rectangle one level up/down.
export type ZoneBox = { x1: number; y1: number; x2: number; y2: number }

// One species living inside the analyzed rectangle, with its real combat data
// from the OT server files: per-turn burst (total and by element), sustained
// dps, whether it can hit from range, and its elemental weaknesses/resists
// (damage_mods: pct of normal damage taken; 0 = immune).
export type ZoneCreature = {
  slug: string
  name: string
  image: string | null
  boss: boolean
  count: number
  hp: number
  experience: number
  burst: number
  dps: number
  stars: number | null
  ranged: boolean
  damage_elements: { element: string; burst: number }[]
  weak_to: { element: string; pct: number }[]
  resists: { element: string; pct: number }[]
}

// The zone-wide verdict: what the combined incoming damage arrives as (share
// per element, spawn-count weighted), which elements work best against the
// crowd, which to avoid, and how many species shoot from range.
export type ZoneSummary = {
  name: string | null
  x1: number
  y1: number
  x2: number
  y2: number
  z: number
  species: number
  spawn_points: number
  ranged_species: number
  incoming: { element: string; pct: number }[]
  attack_with: { element: string; avg_pct: number }[]
  avoid: { element: string; avg_pct: number; immune_species: number }[]
  creatures: ZoneCreature[]
}

// Fetch the combat summary of a drag-selected rectangle on a floor. Disabled
// until a box exists; keeps the previous payload while a floor flip or a
// corner-handle nudge refetches, so the panel never flashes empty.
export function useZoneSummary(box: ZoneBox | null, z: number) {
  return useQuery({
    queryKey: ['zone-summary', box?.x1, box?.y1, box?.x2, box?.y2, z, i18n.language],
    queryFn: async () => {
      const { data } = await api.get<ZoneSummary>('/zone-summary', {
        params: { ...box, z },
      })
      return data
    },
    enabled: !!box,
    staleTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData,
  })
}
