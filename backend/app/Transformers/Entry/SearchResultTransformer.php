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
                // Gold value for items so callers (the hunt-profit loot list) can
                // rank loot by worth. Null for lore.
                'value' => $e->type->value === 'item' ? $this->itemValue($e->meta) : null,
            ])
            ->filter(fn ($i) => filled($i['name']))
            ->values();
    }

    /**
     * A single gold worth for an item. `npc_value` is a clean integer (the NPC
     * sell price); `value` is a TibiaWiki market string like "30,000 - 40,000",
     * so we pull its first number rather than blindly casting (which would keep
     * only "30"). Returns null when neither yields a positive number.
     *
     * @param  array<string, mixed>|null  $meta
     */
    private function itemValue(?array $meta): ?int
    {
        $npc = data_get($meta, 'npc_value');
        if (is_numeric($npc) && (int) $npc > 0) {
            return (int) $npc;
        }

        $raw = data_get($meta, 'value');
        if (is_numeric($raw)) {
            return (int) $raw ?: null;
        }
        if (is_string($raw) && preg_match('/[\d,]+/', $raw, $m)) {
            return (int) str_replace(',', '', $m[0]) ?: null;
        }

        return null;
    }

    /** Active-locale name with an English fallback. */
    public function name(Entry $entry, string $locale): ?string
    {
        return $entry->translation($locale)?->name ?? $entry->translation('en')?->name;
    }
}
