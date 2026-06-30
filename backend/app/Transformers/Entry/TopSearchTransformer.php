<?php

namespace App\Transformers\Entry;

use App\Models\Entry;

/**
 * Shapes the "most-searched" dashboard module. Each row carries the term + hit
 * count and, where possible, the matching entry (sprite + link). Reuses
 * {@see SearchResultTransformer} for locale-aware name resolution.
 */
class TopSearchTransformer
{
    public function __construct(private SearchResultTransformer $names) {}

    /**
     * A searched term resolved to its best-matching entry (may be null).
     *
     * @return array<string, mixed>
     */
    public function term(string $term, int $hits, ?Entry $entry, string $locale): array
    {
        return [
            'term' => $term,
            'hits' => $hits,
            'slug' => $entry?->slug,
            'type' => $entry?->type->value,
            'name' => $entry ? $this->names->name($entry, $locale) : null,
            'image' => $entry?->primary_image,
        ];
    }

    /**
     * Fallback row built from a most-viewed entry (term = the entry's name).
     *
     * @return array<string, mixed>
     */
    public function fromView(Entry $entry, string $locale): array
    {
        $name = $this->names->name($entry, $locale);

        return [
            'term' => $name,
            'hits' => (int) $entry->view_count,
            'slug' => $entry->slug,
            'type' => $entry->type->value,
            'name' => $name,
            'image' => $entry->primary_image,
        ];
    }
}
