import { useQuery } from '@tanstack/react-query'
import i18n from '../i18n'
import { api } from '../lib/api'

// One creature within a ranked hunting zone, with the Hunt Finder's per-creature
// verdict: how well your damage lands (off / off_element / hit_with), what it
// resists, its reward (experience, gold, hp) and how dangerous it is to your set.
export type HuntCreature = {
  slug: string
  name: string
  image: string | null
  boss: boolean
  score: number
  off: number
  off_element: string | null
  hit_with: string[]
  resists: { element: string; pct: number }[]
  experience: number
  gold: number
  hp: number
  danger: number
  too_dangerous: boolean
  count: number
}

// A ranked hunting zone: a spawn cluster labelled by its nearest named area,
// scored for the player (`match` is 0-100 relative to the best zone), with the
// creatures you'll meet there.
export type HuntZone = {
  id: number
  name: string | null
  x: number
  y: number
  z: number
  score: number
  match: number
  danger: number
  access: 'quest' | null
  exp_avg: number
  profit_avg: number
  spawn_count: number
  creatures: HuntCreature[]
}

export type HuntResult = {
  level: number
  vocation: string
  mode: 'solo' | 'team'
  set: {
    damage_elements: string[]
    resists: Record<string, number>
    armor: number
    weapon: string | null
  }
  zones: HuntZone[]
  count: number
}

// Fetch ranked hunting zones for a level + vocation + solo/team mode. Disabled
// (no request) until a level and vocation are set, so the panel can mount empty.
export function useHunts(
  level: number | null,
  vocation: string,
  mode: 'solo' | 'team',
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['hunts', level, vocation, mode, i18n.language],
    queryFn: async () => {
      const { data } = await api.get<HuntResult>('/hunts', {
        params: { level, vocation, mode },
      })
      return data
    },
    enabled: enabled && !!level && level > 0 && !!vocation,
    staleTime: 15 * 60 * 1000,
  })
}
