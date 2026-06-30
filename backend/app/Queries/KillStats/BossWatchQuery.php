<?php

namespace App\Queries\KillStats;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Raw raid-boss roster for the "Raid Boss Watch": published Boss entries present
 * in at most `raid_max_worlds` worlds on the latest snapshot, with per-boss
 * activity counts and a sample of cooldown/open world names. Heat scoring and
 * filtering live in the transformer.
 */
class BossWatchQuery
{
    /** Latest daily snapshot date. */
    public function latestDate(): ?string
    {
        return DB::table('kill_daily')->max('snapshot_date');
    }

    /**
     * @return Collection<int, \stdClass>
     */
    /**
     * @param  string  $type  'raid' → present in ≤ $maxWorlds worlds (rare world
     *                        bosses); 'daily' → present in ≥10 worlds (per-cooldown
     *                        bosses killed across most worlds every day).
     */
    public function rows(string $latest, int $maxWorlds, string $type = 'raid'): Collection
    {
        return DB::table('kill_daily as kd')
            ->join('tibia_races as r', 'r.id', '=', 'kd.race_id')
            ->join('entries as e', 'e.id', '=', 'r.entry_id')
            ->join('tibia_worlds as w', 'w.id', '=', 'kd.world_id')
            ->where('kd.snapshot_date', $latest)
            ->where('e.status', 'published')
            ->whereRaw("e.meta->>'rank' = 'Boss'")
            ->groupBy('r.name', 'e.slug', 'e.primary_image')
            ->having(DB::raw('COUNT(*)'), $type === 'daily' ? '>=' : '<=', $type === 'daily' ? 10 : $maxWorlds)
            ->select([
                'r.name as race',
                'e.slug',
                'e.primary_image as image',
                DB::raw('COUNT(*) AS worlds_active'),
                DB::raw('COUNT(*) FILTER (WHERE kd.day_killed > 0) AS cooldown'),
                DB::raw('COUNT(*) FILTER (WHERE kd.week_killed > 0) AS week_worlds'),
                DB::raw('SUM(kd.day_killed) AS day_killed'),
                DB::raw('SUM(kd.week_killed) AS week_killed'),
                // Up to 4 world names where it was killed today (cooldown) / where
                // it's quiet today (open → likely up there), most-active first.
                DB::raw("array_to_string((array_agg(w.name ORDER BY kd.week_killed DESC) FILTER (WHERE kd.day_killed > 0))[1:4], ',') AS cooldown_worlds"),
                DB::raw("array_to_string((array_agg(w.name ORDER BY kd.week_killed DESC) FILTER (WHERE kd.day_killed = 0))[1:4], ',') AS open_worlds"),
            ])
            ->get();
    }
}
