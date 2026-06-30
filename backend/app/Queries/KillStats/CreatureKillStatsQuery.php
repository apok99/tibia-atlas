<?php

namespace App\Queries\KillStats;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Per-creature kill stats resolved from a lore entry slug via its linked race:
 * the race row, the latest 24h/7d totals, and the daily trend.
 */
class CreatureKillStatsQuery
{
    /** The race linked to a lore entry, with its per-kill experience. */
    public function raceForSlug(string $slug): ?\stdClass
    {
        return DB::table('tibia_races as r')
            ->join('entries as e', 'e.id', '=', 'r.entry_id')
            ->where('e.slug', $slug)
            ->select('r.id', 'r.name', DB::raw("(e.meta->>'experience') AS exp_each"))
            ->first();
    }

    /** Latest snapshot date that recorded this race. */
    public function latestDate(int $raceId): ?string
    {
        return DB::table('kill_daily')->where('race_id', $raceId)->max('snapshot_date');
    }

    /** Aggregated 24h/7d totals for a race on a given snapshot date. */
    public function totalsOn(int $raceId, string $date): ?\stdClass
    {
        return DB::table('kill_daily')
            ->where('race_id', $raceId)
            ->where('snapshot_date', $date)
            ->selectRaw('SUM(day_players_killed) AS day_players_killed, SUM(day_killed) AS day_killed,
                         SUM(week_players_killed) AS week_players_killed, SUM(week_killed) AS week_killed')
            ->first();
    }

    /**
     * Daily trend across all worlds (kill_daily retains ~30 days).
     *
     * @return Collection<int, \stdClass>  rows of {period, players_killed, killed}
     */
    public function dailySeries(int $raceId): Collection
    {
        return DB::table('kill_daily')
            ->where('race_id', $raceId)
            ->groupBy('snapshot_date')
            ->select([
                DB::raw('snapshot_date as period'),
                DB::raw('SUM(day_players_killed) AS players_killed'),
                DB::raw('SUM(day_killed) AS killed'),
            ])
            ->orderBy('snapshot_date')
            ->get();
    }
}
