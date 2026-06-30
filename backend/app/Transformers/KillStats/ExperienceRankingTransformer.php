<?php

namespace App\Transformers\KillStats;

use App\Support\TibiaExp;
use Illuminate\Support\Collection;

/**
 * Shapes an experience-ranking row, adding the level a fresh character would
 * reach from the total XP handed out.
 */
class ExperienceRankingTransformer
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
            'exp_each' => (int) $r->exp_each,
            'killed' => (int) $r->killed,
            'exp_total' => (int) $r->exp_total,
            'level' => TibiaExp::levelForExp((float) $r->exp_total),
        ])->values();
    }
}
