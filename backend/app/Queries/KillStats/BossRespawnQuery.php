<?php

namespace App\Queries\KillStats;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Raw data behind the per-boss respawn tracker: the linked race, last-known kill
 * date per world, the current rolling-window status per world, and the pooled
 * kill events used to build the empirical respawn-interval distribution.
 */
class BossRespawnQuery
{
    /** The race linked to a lore entry, with the fields {@see BossRule} needs. */
    public function raceForSlug(string $slug): ?\stdClass
    {
        return DB::table('tibia_races as r')
            ->join('entries as e', 'e.id', '=', 'r.entry_id')
            ->where('e.slug', $slug)
            ->select(
                'r.id',
                'r.name',
                DB::raw("(e.meta->>'rank') AS rank"),
                DB::raw("(e.meta->>'spawn_type') AS spawn_type"),
            )
            ->first();
    }

    /** Latest snapshot date that recorded this race. */
    public function latestDate(int $raceId): ?string
    {
        return DB::table('kill_daily')->where('race_id', $raceId)->max('snapshot_date');
    }

    /**
     * Last-known kill date per world from accumulated history (improves as
     * snapshots pile up).
     *
     * @return Collection<int, string> keyed by world_id
     */
    public function lastKillPerWorld(int $raceId): Collection
    {
        return DB::table('kill_daily')
            ->where('race_id', $raceId)
            ->where('day_killed', '>', 0)
            ->groupBy('world_id')
            ->select('world_id', DB::raw('MAX(snapshot_date) AS last_kill'))
            ->pluck('last_kill', 'world_id');
    }

    /**
     * Current rolling-window status per world from the latest snapshot.
     *
     * @return Collection<int, \stdClass>
     */
    public function currentStatus(int $raceId, string $latestDate): Collection
    {
        return DB::table('kill_daily as kd')
            ->join('tibia_worlds as w', 'w.id', '=', 'kd.world_id')
            ->where('kd.race_id', $raceId)
            ->where('kd.snapshot_date', $latestDate)
            ->select('w.id as world_id', 'w.name', 'kd.day_killed', 'kd.week_killed')
            ->get();
    }

    /**
     * Pooled kill events (world_id, snapshot_date) ordered for consecutive-date
     * interval diffing.
     *
     * @return Collection<int, \stdClass>
     */
    public function killEvents(int $raceId): Collection
    {
        return DB::table('kill_daily')
            ->where('race_id', $raceId)
            ->where('day_killed', '>', 0)
            ->orderBy('world_id')
            ->orderBy('snapshot_date')
            ->get(['world_id', 'snapshot_date']);
    }
}
