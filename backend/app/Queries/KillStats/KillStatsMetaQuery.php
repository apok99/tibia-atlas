<?php

namespace App\Queries\KillStats;

use App\Models\TibiaWorld;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Read queries behind the dashboard header numbers and the world selector.
 */
class KillStatsMetaQuery
{
    /**
     * Headline counters + the latest snapshot date.
     *
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        return [
            'latest_snapshot' => DB::table('kill_daily')->max('snapshot_date'),
            'worlds' => (int) DB::table('tibia_worlds')->count(),
            'races' => (int) DB::table('tibia_races')->count(),
            'months_available' => (int) DB::table('kill_monthly')->distinct()->count('period'),
            'players_online' => (int) DB::table('tibia_worlds')->sum('players_online'),
        ];
    }

    /**
     * World list for the selector, most populated first.
     *
     * @return Collection<int, TibiaWorld>
     */
    public function worlds(): Collection
    {
        return TibiaWorld::query()
            ->orderByDesc('players_online')
            ->get(['name', 'location', 'pvp_type', 'status', 'players_online']);
    }
}
