<?php

namespace App\Queries\Entry;

use App\Models\Entry;
use Illuminate\Support\Collection;

/**
 * All creatures carrying spawn data (incl. drafts — the map is a hunting tool,
 * so every documented spawn surfaces, not just published articles).
 */
class SpawnsQuery
{
    /**
     * @return Collection<int, Entry>
     */
    public function creaturesWithSpawns(): Collection
    {
        return Entry::query()
            ->where('type', 'creature')
            ->whereNotNull('meta->spawn_count')
            ->with('translations')
            ->get();
    }
}
