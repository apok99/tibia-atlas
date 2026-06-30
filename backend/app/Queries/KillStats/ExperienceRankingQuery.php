<?php

namespace App\Queries\KillStats;

use App\Queries\KillStats\Concerns\ResolvesTibiaIds;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Ranking of creatures by EXPERIENCE handed out (killed × exp-per-kill) over the
 * latest snapshot, for the chosen window and world.
 */
class ExperienceRankingQuery
{
    use ResolvesTibiaIds;

    /**
     * @param  'day'|'week'  $window
     * @return Collection<int, \stdClass>
     */
    public function get(string $window, ?string $world, int $limit): Collection
    {
        $worldId = $this->worldId($world);
        $killCol = $window === 'day' ? 'day_killed' : 'week_killed';

        $latest = DB::table('kill_daily')
            ->when($worldId, fn ($q) => $q->where('world_id', $worldId))
            ->max('snapshot_date');

        return DB::table('kill_daily as kd')
            ->join('tibia_races as r', 'r.id', '=', 'kd.race_id')
            ->join('entries as e', 'e.id', '=', 'r.entry_id')
            ->where('kd.snapshot_date', $latest)
            ->whereNotNull(DB::raw("(e.meta->>'experience')"))
            ->whereRaw("(e.meta->>'experience') ~ '^[0-9]+$'")
            ->when($worldId, fn ($q) => $q->where('kd.world_id', $worldId))
            ->groupBy('r.name', 'e.slug', 'e.primary_image', DB::raw("(e.meta->>'experience')"))
            ->select([
                'r.name as race',
                'e.slug',
                'e.primary_image as image',
                DB::raw("(e.meta->>'experience')::bigint AS exp_each"),
                DB::raw("SUM(kd.{$killCol}) AS killed"),
                DB::raw("(e.meta->>'experience')::bigint * SUM(kd.{$killCol}) AS exp_total"),
            ])
            ->orderByDesc('exp_total')
            ->limit($limit)
            ->get();
    }
}
