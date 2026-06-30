<?php

namespace App\Transformers\KillStats;

use Illuminate\Support\Collection;

/**
 * Shapes a deadliest-races ranking row into the public payload.
 */
class RaceRankingTransformer
{
    /**
     * @param  Collection<int, \stdClass>  $rows
     * @return Collection<int, array<string, mixed>>
     */
    public function collection(Collection $rows): Collection
    {
        return $rows->map(fn ($r) => [
            'race' => $r->race,
            'slug' => $r->slug,
            'image' => $r->image,
            'players_killed' => (int) $r->players_killed,
            'killed' => (int) $r->killed,
        ])->values();
    }
}
