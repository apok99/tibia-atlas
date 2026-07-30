<?php

namespace App\Queries\KillStats;

use App\Queries\KillStats\Concerns\ResolvesTibiaIds;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Per-creature kill stats resolved from a lore entry slug via its linked race:
 * the race row, the latest 24h/7d totals, and the daily trend.
 */
class CreatureKillStatsQuery
{
    use ResolvesTibiaIds;

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
     * Popularity of a race by creatures slain (7d) among every race hunted on
     * a given snapshot date. Returns null when the race had no kills that week.
     */
    public function popularityOn(int $raceId, string $date): ?\stdClass
    {
        $killed = (int) DB::table('kill_daily')
            ->where('race_id', $raceId)
            ->where('snapshot_date', $date)
            ->sum('week_killed');

        if ($killed <= 0) {
            return null;
        }

        $totals = DB::table('kill_daily')
            ->where('snapshot_date', $date)
            ->groupBy('race_id')
            ->selectRaw('SUM(week_killed) AS killed');

        $row = DB::query()
            ->fromSub($totals, 't')
            ->selectRaw(
                'COUNT(*) FILTER (WHERE killed > 0) AS total,
                 COUNT(*) FILTER (WHERE killed > ?) AS above',
                [$killed],
            )
            ->first();

        return (object) [
            'killed' => $killed,
            'rank' => (int) $row->above + 1,
            'total' => (int) $row->total,
        ];
    }

    /**
     * Daily trend across all worlds (kill_daily retains ~30 days).
     *
     * @return Collection<int, \stdClass> rows of {period, players_killed, killed}
     */
    public function dailySeries(int $raceId): Collection
    {
        return $this->dailySeriesFor($raceId, null);
    }

    /**
     * Same daily trend, optionally scoped to ONE world — what the map's kill
     * pulse reads (the map has a selected world, so its numbers must be that
     * world's, not the network's).
     *
     * @param  int|null  $worldId  null → every world summed
     * @return Collection<int, \stdClass> rows of {period, players_killed, killed}
     */
    public function dailySeriesFor(int $raceId, ?int $worldId): Collection
    {
        return DB::table('kill_daily')
            ->where('race_id', $raceId)
            ->when($worldId, fn ($q) => $q->where('world_id', $worldId))
            ->groupBy('snapshot_date')
            ->select([
                DB::raw('snapshot_date as period'),
                DB::raw('SUM(day_players_killed) AS players_killed'),
                DB::raw('SUM(day_killed) AS killed'),
            ])
            ->orderBy('snapshot_date')
            ->get();
    }

    /**
     * Where one world ranks by creatures slain on a given day, among the worlds
     * that killed this race at all. Cheap: the (race_id, snapshot_date) index
     * narrows it to one row per world (~93).
     *
     * @return \stdClass|null {rank, total} — null when the race went unkilled
     *                        everywhere that day.
     */
    public function worldRankOn(int $raceId, string $date, int $worldId): ?\stdClass
    {
        $killed = (int) DB::table('kill_daily')
            ->where('race_id', $raceId)
            ->where('snapshot_date', $date)
            ->where('world_id', $worldId)
            ->sum('day_killed');

        $row = DB::table('kill_daily')
            ->where('race_id', $raceId)
            ->where('snapshot_date', $date)
            ->selectRaw(
                'COUNT(*) FILTER (WHERE day_killed > 0) AS total,
                 COUNT(*) FILTER (WHERE day_killed > ?) AS above',
                [$killed],
            )
            ->first();

        if (! $row || (int) $row->total < 1 || $killed <= 0) {
            return null;
        }

        return (object) [
            'rank' => (int) $row->above + 1,
            'total' => (int) $row->total,
        ];
    }
}
