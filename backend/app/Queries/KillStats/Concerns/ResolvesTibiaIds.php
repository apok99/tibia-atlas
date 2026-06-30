<?php

namespace App\Queries\KillStats\Concerns;

use App\Models\TibiaWorld;
use Illuminate\Support\Facades\DB;

/**
 * Shared name → id lookups for the kill-statistics queries. Keeps the
 * "all worlds" sentinel and the case-insensitive race match in one place.
 */
trait ResolvesTibiaIds
{
    /** Resolve a world name to its id; null for "all" (or unknown). */
    public function worldId(?string $world): ?int
    {
        if ($world === null || $world === '' || $world === 'all') {
            return null;
        }

        return TibiaWorld::where('name', $world)->value('id');
    }

    /** Resolve a race name (case-insensitive) to its id, or null. */
    public function raceId(string $race): ?int
    {
        return DB::table('tibia_races')
            ->whereRaw('lower(name) = lower(?)', [$race])
            ->value('id');
    }
}
