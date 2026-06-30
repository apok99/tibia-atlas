<?php

namespace App\Queries\KillStats;

use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The raw aggregates behind the dashboard hero overview: headline totals, the
 * 14-day global activity series, the players-online history, and the live world
 * population. Shaping (regions / pvp / top worlds) is done by the transformer.
 */
class KillOverviewQuery
{
    /** Latest daily snapshot date. */
    public function latestDate(): ?string
    {
        return DB::table('kill_daily')->max('snapshot_date');
    }

    /** Resolve a world name to its id; null for "all" / unknown. */
    public function worldId(string $world): ?int
    {
        return $world !== '' && $world !== 'all'
            ? DB::table('tibia_worlds')->where('name', $world)->value('id')
            : null;
    }

    /** 24h/7d kill totals + active-race count for the latest snapshot (optionally one world). */
    public function totals(string $latest, ?int $worldId = null): ?\stdClass
    {
        return DB::table('kill_daily')
            ->where('snapshot_date', $latest)
            ->when($worldId, fn ($q) => $q->where('world_id', $worldId))
            ->selectRaw('
                COALESCE(SUM(day_players_killed), 0) AS pk_24h,
                COALESCE(SUM(day_killed), 0) AS k_24h,
                COALESCE(SUM(week_players_killed), 0) AS pk_7d,
                COALESCE(SUM(week_killed), 0) AS k_7d,
                COUNT(DISTINCT CASE WHEN day_killed > 0 THEN race_id END) AS active_races
            ')
            ->first();
    }

    /** XP handed out in the last 24h = Σ (per-kill exp × creatures killed). */
    public function experience24h(string $latest, ?int $worldId = null): int
    {
        return (int) DB::table('kill_daily as kd')
            ->join('tibia_races as r', 'r.id', '=', 'kd.race_id')
            ->join('entries as e', 'e.id', '=', 'r.entry_id')
            ->where('kd.snapshot_date', $latest)
            ->when($worldId, fn ($q) => $q->where('kd.world_id', $worldId))
            ->whereRaw("(e.meta->>'experience') ~ '^[0-9]+$'")
            ->selectRaw("COALESCE(SUM((e.meta->>'experience')::bigint * kd.day_killed), 0) AS exp")
            ->value('exp');
    }

    /**
     * Global daily activity for the last ~14 snapshots.
     *
     * @return Collection<int, \stdClass>  rows of {period, players_killed, killed}
     */
    public function activitySeries(string $latest): Collection
    {
        return DB::table('kill_daily')
            ->where('snapshot_date', '>', Carbon::parse($latest)->subDays(14)->toDateString())
            ->groupBy('snapshot_date')
            ->orderBy('snapshot_date')
            ->select([
                DB::raw('snapshot_date as period'),
                DB::raw('SUM(day_players_killed) AS players_killed'),
                DB::raw('SUM(day_killed) AS killed'),
            ])
            ->get();
    }

    /**
     * Players-online history (hourly buckets we record ourselves), last ~3 days.
     *
     * @return Collection<int, \stdClass>
     */
    public function onlineHistory(): Collection
    {
        return DB::table('online_snapshots')
            ->where('captured_at', '>', Carbon::now()->subDays(3))
            ->orderBy('captured_at')
            ->get(['captured_at', 'players_online', 'worlds_online']);
    }

    /** All-time peak players-online we've observed. */
    public function onlinePeak(): int
    {
        return (int) DB::table('online_snapshots')->max('players_online');
    }

    /**
     * Live world population.
     *
     * @return Collection<int, \stdClass>
     */
    public function worlds(): Collection
    {
        return DB::table('tibia_worlds')->get(['name', 'location', 'pvp_type', 'players_online']);
    }
}
