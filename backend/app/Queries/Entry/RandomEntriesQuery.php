<?php

namespace App\Queries\Entry;

use App\Models\Entry;
use Illuminate\Support\Collection;

/**
 * Reads behind the "recommended reading" widget. A cheap id-keyed pool is
 * cached and sampled in PHP (avoiding ORDER BY RANDOM() full scans); the chosen
 * ids are then hydrated.
 */
class RandomEntriesQuery
{
    /**
     * Published pool for in-memory sampling, keyed by id. Each row carries the
     * slug (for exclusion) and whether the entry has a sprite/image, so visual
     * showcases can prefer image-bearing entries and avoid empty cards.
     *
     * @return array<int, array{slug: string, img: bool}>
     */
    public function pool(): array
    {
        return Entry::published()
            ->get(['id', 'slug', 'primary_image'])
            ->mapWithKeys(fn ($e) => [$e->id => ['slug' => $e->slug, 'img' => $e->primary_image !== null]])
            ->all();
    }

    /**
     * Hydrate the sampled ids.
     *
     * @param  iterable<int>  $ids
     * @return Collection<int, Entry>
     */
    public function byIds(iterable $ids): Collection
    {
        return Entry::query()
            ->whereIn('id', $ids)
            ->with('translations')
            ->get();
    }
}
