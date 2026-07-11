<?php

namespace App\Transformers\KillStats;

use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Shapes per-world boss respawn status into the tracker payload: each world's
 * status bucket (cooldown / recent / due) plus the days-since the last known
 * kill, ordered most-"due" first, with a roll-up summary.
 */
class BossRespawnTransformer
{
    /**
     * @param  Collection<int, \stdClass>  $current  rolling-window status per world
     * @param  Collection<int, string>  $lastKills  last kill date keyed by world_id
     * @return array{worlds: Collection<int, array<string, mixed>>, summary: array<string, int>}
     */
    public function build(Collection $current, Collection $lastKills, Carbon $today): array
    {
        $worlds = $current
            ->map(fn ($w) => $this->shapeWorld($w, $lastKills, $today))
            // Most "due" first (long quiet → likely available), then recent,
            // cooldown, and finally the ones we simply have no kill record for.
            ->sortBy(fn ($w) => ['due' => 0, 'recent' => 1, 'cooldown' => 2, 'unknown' => 3][$w['status']])
            ->values();

        return [
            'worlds' => $worlds,
            'summary' => [
                'worlds_total' => $worlds->count(),
                'cooldown' => $worlds->where('status', 'cooldown')->count(),
                'recent' => $worlds->where('status', 'recent')->count(),
                'due' => $worlds->where('status', 'due')->count(),
                'unknown' => $worlds->where('status', 'unknown')->count(),
            ],
        ];
    }

    /**
     * @param  Collection<int, string>  $lastKills
     * @return array<string, mixed>
     */
    private function shapeWorld(\stdClass $w, Collection $lastKills, Carbon $today): array
    {
        $lastKill = $lastKills[$w->world_id] ?? null;
        // diffInDays is signed by direction (today → a past date is negative), so
        // take the magnitude — we want "N days ago", never "-N".
        $daysSince = $lastKill ? (int) abs($today->diffInDays(Carbon::parse($lastKill))) : null;

        // Status bucket: infer from the rolling windows of the latest snapshot.
        if ($w->day_killed > 0) {
            $status = 'cooldown';        // killed within last 24h
        } elseif ($w->week_killed > 0) {
            $status = 'recent';          // killed 2-7 days ago
        } elseif ($lastKill !== null) {
            $status = 'due';             // has a real kill anchor, now 7+ days quiet → likely up
        } else {
            // No kill ever recorded on this world: "0 kills" is not evidence the
            // boss is up (it's usually a rare/summoned boss we've simply never
            // seen die). Report it as no-data, matching the map's Boss Watch,
            // instead of the misleading "likely up".
            $status = 'unknown';
        }

        return [
            'world' => $w->name,
            'status' => $status,
            'last_kill' => $lastKill,
            'days_since' => $daysSince,
        ];
    }
}
