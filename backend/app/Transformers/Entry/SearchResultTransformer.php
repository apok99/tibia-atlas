<?php

namespace App\Transformers\Entry;

use App\Models\Entry;
use Illuminate\Support\Collection;

/**
 * Shapes entries into compact autocomplete results {slug, type, name, image},
 * resolving the name to the active locale with an English fallback and dropping
 * entries that have no usable name.
 */
class SearchResultTransformer
{
    /**
     * @param  Collection<int, Entry>  $entries
     * @return Collection<int, array<string, mixed>>
     */
    public function collection(Collection $entries, string $locale): Collection
    {
        return $entries
            ->map(fn (Entry $e) => [
                'slug' => $e->slug,
                'type' => $e->type->value,
                'name' => $this->name($e, $locale),
                'image' => $e->primary_image,
            ])
            ->filter(fn ($i) => filled($i['name']))
            ->values();
    }

    /** Active-locale name with an English fallback. */
    public function name(Entry $entry, string $locale): ?string
    {
        return $entry->translation($locale)?->name ?? $entry->translation('en')?->name;
    }
}
