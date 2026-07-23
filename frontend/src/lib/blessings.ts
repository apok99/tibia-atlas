// --- The blessing pilgrimage --------------------------------------------------
// One button that plans the whole run: every blessing shrine, in the order that
// walks the fewest tiles, drawn as a single route.
//
// The ORDER is precomputed offline (`node tools/gen-blessings.mjs` →
// public/blessings.json) because it needs an exact tour over real travel
// distances — 5040 orderings for the seven-shrine set, each edge a full search
// over the walkability bake. The browser then only walks the chosen order,
// stitching the legs with the same planRoute the "Cómo llegar" tool uses.
import { useQuery } from '@tanstack/react-query'
import { planRoute, type RoutePlan } from './routing'

export type Shrine = {
  /** Blessing id: 2-6 are the classic five, 7-8 the mountain pair. */
  id: number
  name: string
  npc: string
  x: number
  y: number
  z: number
}

export type BlessingTour = {
  start: { name: string; x: number; y: number; z: number }
  set: 'five' | 'seven'
  /** Shrine ids in the cheapest visiting order. */
  order: number[]
  legs: { to: number; steps: number }[]
  steps: number
}

export type BlessingsFile = { generated: string; shrines: Shrine[]; tours: BlessingTour[] }

/**
 * Shrines that sit in a pocket the walking graph cannot enter, and how you really
 * get in. Both are documented in the game data (the OT's own NPC script for the
 * ferry; the client's minimap marker for the levitate spot), and the tour needs
 * to say so rather than pretend you can walk there.
 */
export const SHRINE_ACCESS: Record<number, { mode: 'boat' | 'levitate'; exit?: { x: number; y: number; floor: number } }> = {
  // Eremo's island — Pemaret sails there free from Cormaya. Modelled as a real
  // ferry line in routing.ts, so the router walks in and out on its own.
  2: { mode: 'boat' },
  // Nomad's ledge — you levitate up from the spot below and drop back down the
  // same way. The router has no levitate, so the leg AFTER this shrine has to
  // resume from that spot, otherwise every later stop looks unreachable.
  7: { mode: 'levitate', exit: { x: 31940, y: 31307, floor: 7 } },
}

export function useBlessings(enabled: boolean) {
  return useQuery({
    queryKey: ['blessings'],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<BlessingsFile> => {
      const res = await fetch('/blessings.json')
      if (!res.ok) throw new Error('blessings')
      return res.json()
    },
  })
}

/** The precomputed tour whose starting city is nearest to where you are now. */
export function nearestTour(
  data: BlessingsFile,
  set: 'five' | 'seven',
  from: { x: number; y: number }
): BlessingTour | null {
  let best: BlessingTour | null = null
  let bestD = Infinity
  for (const t of data.tours) {
    if (t.set !== set) continue
    const d = Math.max(Math.abs(t.start.x - from.x), Math.abs(t.start.y - from.y))
    if (d < bestD) {
      bestD = d
      best = t
    }
  }
  return best
}

export type PilgrimStop = { shrine: Shrine; tiles: number; reached: boolean }

/**
 * Walk the chosen order for real: one planRoute per leg, concatenated into a
 * single plan the map can draw in one go.
 *
 * A leg that cannot be routed does NOT abort the pilgrimage — it is reported as
 * unreached and the next leg starts from that shrine anyway, because the two
 * pocket shrines are entered by ferry or levitate rather than on foot.
 */
export async function planPilgrimage(
  data: BlessingsFile,
  tour: BlessingTour,
  from: { x: number; y: number; floor: number }
): Promise<{ plan: RoutePlan; stops: PilgrimStop[] }> {
  const byId = new Map(data.shrines.map((s) => [s.id, s]))
  const legs: RoutePlan['legs'] = []
  const stops: PilgrimStop[] = []
  let cursor = from
  let total = 0

  for (const id of tour.order) {
    const shrine = byId.get(id)
    if (!shrine) continue
    const leg = await planRoute(cursor, { x: shrine.x, y: shrine.y, floor: shrine.z })
    if (leg) {
      legs.push(...leg.legs)
      total += leg.totalTiles
    }
    stops.push({ shrine, tiles: leg?.totalTiles ?? 0, reached: Boolean(leg && !leg.partial) })
    // Resume from where you actually stand once the shrine is done. For a
    // levitate ledge that is the spot below it, not the ledge — continuing from
    // ground the router cannot leave would make every later stop look unreachable.
    const exit = SHRINE_ACCESS[shrine.id]?.exit
    cursor = exit ?? { x: shrine.x, y: shrine.y, floor: shrine.z }
  }

  return { plan: { legs, totalTiles: total }, stops }
}
