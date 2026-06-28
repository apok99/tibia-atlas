import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export type Metric = 'players_killed' | 'killed'
export type RankWindow = 'day' | 'week' | 'month' | 'year'
export type Granularity = 'month' | 'day'

export interface KillStatsMeta {
  latest_snapshot: string | null
  worlds: number
  races: number
  months_available: number
  players_online: number
}

export interface KillWorld {
  name: string
  location: string | null
  pvp_type: string | null
  status: string | null
  players_online: number
}

export interface RankingRow {
  race: string
  slug: string | null
  image: string | null
  players_killed: number
  killed: number
}

export interface SeriesPoint {
  period: string
  players_killed: number
  killed: number
}

export function useKillMeta() {
  return useQuery({
    queryKey: ['killstats', 'meta'],
    queryFn: async () => (await api.get<KillStatsMeta>('/killstats/meta')).data,
  })
}

export function useKillWorlds() {
  return useQuery({
    queryKey: ['killstats', 'worlds'],
    queryFn: async () => (await api.get<{ data: KillWorld[] }>('/killstats/worlds')).data.data,
    staleTime: 5 * 60 * 1000,
  })
}

export function useKillRanking(params: {
  world: string
  metric: Metric
  window: RankWindow
  limit?: number
}) {
  return useQuery({
    queryKey: ['killstats', 'ranking', params],
    queryFn: async () =>
      (await api.get<{ data: RankingRow[] }>('/killstats/ranking', { params })).data.data,
  })
}

export interface EntryKillStats {
  linked: boolean
  race: string | null
  latest: {
    date: string
    players_killed: number
    killed: number
    week_players_killed: number
    week_killed: number
    exp_each: number | null
    exp_24h: number | null
    exp_7d: number | null
    level_24h: number | null
    level_7d: number | null
  } | null
  series: SeriesPoint[]
}

/** Kill stats for one creature's lore entry (resolved via its linked race). */
export function useEntryKillStats(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['killstats', 'entry', slug],
    enabled: !!slug && enabled,
    queryFn: async () =>
      (await api.get<EntryKillStats>(`/killstats/entry/${slug}`)).data,
  })
}

export interface ExpRow {
  race: string
  slug: string | null
  image: string | null
  exp_each: number
  killed: number
  exp_total: number
  level: number
}

/** Ranking of creatures by experience handed out (killed × exp). */
export function useKillExperience(params: { world: string; window: 'day' | 'week'; limit?: number }) {
  return useQuery({
    queryKey: ['killstats', 'experience', params],
    queryFn: async () =>
      (await api.get<{ data: ExpRow[] }>('/killstats/experience', { params })).data.data,
  })
}

export interface BossWorld {
  world: string
  status: 'cooldown' | 'recent' | 'due'
  last_kill: string | null
  days_since: number | null
}

export interface BossRespawnData {
  linked: boolean
  race: string | null
  is_boss?: boolean
  latest_date?: string | null
  summary?: { worlds_total: number; cooldown: number; recent: number; due: number }
  worlds?: BossWorld[]
  respawn?: {
    method: 'empirical' | 'collecting'
    sample_size: number
    min_days?: number
    median_days?: number
    max_days?: number
    cdf: { day: number; prob: number }[]
  }
}

/** Per-world respawn tracker for a boss. */
export function useBossRespawn(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['killstats', 'boss', slug],
    enabled: !!slug && enabled,
    queryFn: async () => (await api.get<BossRespawnData>(`/killstats/boss/${slug}`)).data,
  })
}

export function useKillSeries(params: {
  race: string | null
  world: string
  granularity: Granularity
}) {
  return useQuery({
    queryKey: ['killstats', 'series', params],
    enabled: !!params.race,
    queryFn: async () =>
      (await api.get<{ data: SeriesPoint[] }>('/killstats/series', {
        params: { race: params.race, world: params.world, granularity: params.granularity },
      })).data.data,
  })
}
