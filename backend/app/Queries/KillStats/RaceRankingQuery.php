<?php

namespace App\Queries\KillStats;

use App\Queries\KillStats\Concerns\ResolvesTibiaIds;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Ranking of the deadliest (or most-killed) races over a time window. Day/week
 * read the rolling columns of the latest daily snapshot; month/year aggregate
 * the monthly warehouse for the current calendar period.
 */
class RaceRankingQuery
{
    use ResolvesTibiaIds;

    /**
     * @param  'players_killed'|'killed'  $metric  ordering column (validated upstream)
     * @return Collection<int, \stdClass>
     */
    public function get(string $window, ?string $world, string $metric, int $limit): Collection
    {
        $worldId = $this->worldId($world);

        return in_array($window, ['day', 'week'], true)
            ? $this->daily($window, $worldId, $metric, $limit)
            : $this->monthly($window, $worldId, $metric, $limit);
    }

    /** @return Collection<int, \stdClass> */
    private function daily(string $window, ?int $worldId, string $metric, int $limit): Collection
    {
        $col = $window === 'day' ? 'day_' : 'week_';

        $latest = DB::table('kill_daily')
            ->when($worldId, fn ($q) => $q->where('world_id', $worldId))
            ->max('snapshot_date');

        return DB::table('kill_daily as kd')
            ->join('tibia_races as r', 'r.id', '=', 'kd.race_id')
            ->leftJoin('entries as e', 'e.id', '=', 'r.entry_id')
            ->where('kd.snapshot_date', $latest)
            ->when($worldId, fn ($q) => $q->where('kd.world_id', $worldId))
            ->groupBy('r.name', 'e.slug', 'e.primary_image')
            ->select([
                'r.name as race',
                'e.slug',
                'e.primary_image as image',
                DB::raw("SUM(kd.{$col}players_killed) as players_killed"),
                DB::raw("SUM(kd.{$col}killed) as killed"),
            ])
            ->orderByDesc($metric)
            ->limit($limit)
            ->get();
    }

    /** @return Collection<int, \stdClass> */
    private function monthly(string $window, ?int $worldId, string $metric, int $limit): Collection
    {
        return DB::table('kill_monthly as km')
            ->join('tibia_races as r', 'r.id', '=', 'km.race_id')
            ->leftJoin('entries as e', 'e.id', '=', 'r.entry_id')
            ->when($worldId, fn ($q) => $q->where('km.world_id', $worldId))
            ->when($window === 'month',
                fn ($q) => $q->whereRaw("km.period = date_trunc('month', current_date)::date"),
                fn ($q) => $q->whereRaw("km.period >= date_trunc('year', current_date)::date"),
            )
            ->groupBy('r.name', 'e.slug', 'e.primary_image')
            ->select([
                'r.name as race',
                'e.slug',
                'e.primary_image as image',
                DB::raw('SUM(km.players_killed) as players_killed'),
                DB::raw('SUM(km.killed) as killed'),
            ])
            ->orderByDesc($metric)
            ->limit($limit)
            ->get();
    }
}
