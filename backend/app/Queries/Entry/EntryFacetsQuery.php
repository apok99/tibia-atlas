<?php

namespace App\Queries\Entry;

use App\Models\Entry;

/**
 * Filter facets for the bestiary controls: every classification with its entry
 * count, plus how many entries are bosses, for a given type.
 */
class EntryFacetsQuery
{
    /**
     * @return array{classifications: list<array{value: string, count: int}>, bosses: int}
     */
    public function compute(string $type): array
    {
        $base = Entry::published()
            ->when($type !== '', fn ($q) => $q->ofType($type));

        $classifications = (clone $base)
            ->selectRaw("meta->>'classification' as value, count(*) as count")
            ->whereRaw("meta->>'classification' is not null")
            ->whereRaw("meta->>'classification' <> ''")
            ->groupByRaw("meta->>'classification'")
            ->orderByDesc('count')
            ->get()
            ->map(fn ($row) => ['value' => $row->value, 'count' => (int) $row->count])
            // Return a plain array: a serialized Collection can round-trip into a
            // __PHP_Incomplete_Class on some cache drivers.
            ->all();

        return [
            'classifications' => $classifications,
            'bosses' => (clone $base)->where('meta->rank', 'Boss')->count(),
        ];
    }
}
