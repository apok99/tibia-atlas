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
    staleTime: 5 * 60 * 1000,
  })
}

export interface KillOverview {
  latest: string | null
  totals: {
    players_killed_24h: number
    killed_24h: number
    players_killed_7d: number
    killed_7d: number
    exp_24h: number
    active_races: number
    players_online: number
    worlds: number
  }
  series: SeriesPoint[]
  online_history: { time: string; players_online: number; worlds_online: number }[]
  online_peak: number
  regions: { name: string; players_online: number; worlds: number }[]
  pvp: { name: string; players_online: number; worlds: number }[]
  top_worlds: { name: string; players_online: number }[]
}

/** Dashboard hero overview. The kill totals scope to `world`; online/pulse stay global. */
export function useKillOverview(world = 'all') {
  return useQuery({
    queryKey: ['killstats', 'overview', world],
    queryFn: async () => (await api.get<KillOverview>('/killstats/overview', { params: { world } })).data,
    staleTime: 60 * 1000,
  })
}

export interface BossRow {
  race: string
  slug: string | null
  image: string | null
  worlds_active: number
  cooldown: number
  recent: number
  due: number
  day_killed: number
  week_killed: number
  /** 0-100 respawn progress; null when world-scoped with no recorded kill there. */
  heat: number | null
  /** Cross-world reading (never null) — the fallback when `heat` is null. */
  heat_global: number
  /** The world the request was scoped to; null when aggregated across all. */
  world: string | null
  /** Does the selected world report this boss at all? null when not scoped. */
  world_present: boolean | null
  /**
   * Is the world-scoped reading backed by a kill recorded on that world? false =
   * derived from "never killed here in our window" (a lower bound, so the heat is
   * a floor, never a "just killed"). null when not scoped.
   */
  world_anchored: boolean | null
  /** Kills on the selected world only (day/week). null when not scoped. */
  world_day_killed: number | null
  world_week_killed: number | null
  worlds: string[]
  iconic: boolean
  rank: number
}

/**
 * Boss roster. type='raid' → rare world bosses; type='daily' → daily-cooldown
 * bosses (both are the KillStatsPage dashboard cuts); type='world' → every boss
 * with a real server-side respawn, which is what the map rail wants; type='all' →
 * no cut at all, for debugging the other three.
 * `world` scopes each boss's heat/status to a single world ('all' = aggregate).
 */
export function useBosses(type: 'raid' | 'daily' | 'world' | 'all' = 'raid', limit = 24, enabled = true, world = 'all') {
  return useQuery({
    queryKey: ['killstats', 'bosses', type, limit, world],
    enabled,
    queryFn: async () =>
      (await api.get<{ latest: string | null; data: BossRow[] }>('/killstats/bosses', { params: { type, limit, world } })).data.data,
    staleTime: 60 * 1000,
  })
}

export interface TopSearch {
  term: string
  hits: number
  slug: string | null
  type: string | null
  name: string | null
  image: string | null
}

/** Most-searched terms on the site (falls back to most-viewed). */
export function useTopSearches(limit = 10) {
  return useQuery({
    queryKey: ['search', 'top', limit],
    queryFn: async () =>
      (await api.get<{ source: 'searches' | 'views'; data: TopSearch[] }>('/search/top', { params: { limit } })).data,
    staleTime: 60 * 1000,
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
    staleTime: 60 * 1000,
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
  popularity: {
    rank: number
    total: number
    top_percent: number
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
    // The warehouse only refreshes when the hourly ETL lands new data.
    staleTime: 5 * 60 * 1000,
  })
}

export interface CreatureWorldKills {
  linked: boolean
  race: string | null
  /** The world actually applied ('all' when the requested one is unknown). */
  world: string
  /** Newest SEALED snapshot — the ETL rewrites today's row hourly, so today is partial. */
  yesterday: { date: string; killed: number; players_killed: number; share: number | null; all_worlds: number } | null
  month: {
    from: string
    to: string
    days: number
    killed: number
    players_killed: number
    per_day: number
    share: number | null
    all_worlds: number
  } | null
  best: { date: string; killed: number } | null
  /** Where this world ranks among the worlds that hunted the race yesterday. */
  rank: { rank: number; total: number } | null
  series: SeriesPoint[]
}

/** Per-creature kill pulse for ONE world — the map's stats popover. */
export function useCreatureWorldKills(slug: string | undefined, world: string, enabled = true) {
  return useQuery({
    queryKey: ['killstats', 'creature', slug, world],
    enabled: !!slug && enabled,
    queryFn: async () =>
      (await api.get<CreatureWorldKills>(`/killstats/creature/${slug}`, { params: { world } })).data,
    // Only moves when the hourly ETL lands a new snapshot.
    staleTime: 5 * 60 * 1000,
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
    staleTime: 5 * 60 * 1000,
  })
}

export interface BossWorld {
  world: string
  status: 'cooldown' | 'recent' | 'due' | 'unknown'
  last_kill: string | null
  days_since: number | null
}

export interface BossRespawnData {
  linked: boolean
  race: string | null
  is_boss?: boolean
  type?: 'raid' | 'daily'
  latest_date?: string | null
  summary?: { worlds_total: number; cooldown: number; recent: number; due: number; unknown: number }
  worlds?: BossWorld[]
  respawn?: {
    method: 'empirical' | 'collecting'
    sample_size: number
    min_days?: number
    median_days?: number
    max_days?: number
    cdf: { day: number; prob: number }[]
  }
  activity?: {
    killed_today: number
    killed_week: number
    worlds_killed_today: number
    worlds_total: number
    trend: { period: string; killed: number }[]
  }
}

/** Per-world respawn tracker for a boss. */
export function useBossRespawn(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['killstats', 'boss', slug],
    enabled: !!slug && enabled,
    queryFn: async () => (await api.get<BossRespawnData>(`/killstats/boss/${slug}`)).data,
    staleTime: 5 * 60 * 1000,
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
    staleTime: 5 * 60 * 1000,
  })
}
