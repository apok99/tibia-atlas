<?php

namespace App\Queries\KillStats;

use App\Queries\KillStats\Concerns\ResolvesTibiaIds;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Time series of kills for a single race, monthly (warehouse) or daily
 * (rolling snapshots), optionally scoped to one world.
 */
class RaceSeriesQuery
{
    use ResolvesTibiaIds;

    /**
     * @return Collection<int, \stdClass> rows of {period, players_killed, killed}
     */
    public function get(int $raceId, ?string $world, string $granularity): Collection
    {
        $worldId = $this->worldId($world);

        return $granularity === 'day'
            ? $this->daily($raceId, $worldId)
            : $this->monthly($raceId, $worldId);
    }

    /** @return Collection<int, \stdClass> */
    private function monthly(int $raceId, ?int $worldId): Collection
    {
        return DB::table('kill_monthly')
            ->where('race_id', $raceId)
            ->when($worldId, fn ($q) => $q->where('world_id', $worldId))
            ->groupBy('period')
            ->select([
                DB::raw('period'),
                DB::raw('SUM(players_killed) as players_killed'),
                DB::raw('SUM(killed) as killed'),
            ])
            ->orderBy('period')
            ->get();
    }

    /** @return Collection<int, \stdClass> */
    private function daily(int $raceId, ?int $worldId): Collection
    {
        return DB::table('kill_daily')
            ->where('race_id', $raceId)
            ->when($worldId, fn ($q) => $q->where('world_id', $worldId))
            ->groupBy('snapshot_date')
            ->select([
                DB::raw('snapshot_date as period'),
                DB::raw('SUM(day_players_killed) as players_killed'),
                DB::raw('SUM(day_killed) as killed'),
            ])
            ->orderBy('snapshot_date')
            ->get();
    }
}
