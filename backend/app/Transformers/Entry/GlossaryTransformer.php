<?php

namespace App\Transformers\Entry;

use App\Models\Entry;
use Illuminate\Support\Collection;

/**
 * Shapes the auto-linking glossary: {slug, type, name, image} per published entry in
 * the active locale, longest names first so multi-word matches win over their
 * substrings.
 */
class GlossaryTransformer
{
    /**
     * @param  Collection<int, Entry>  $entries
     * @return list<array<string, mixed>>
     */
    public function items(Collection $entries, string $locale): array
    {
        return $entries
            ->map(fn (Entry $e) => [
                'slug' => $e->slug,
                'type' => $e->type->value,
                'name' => $e->translation($locale)?->name,
                'image' => $e->primary_image,
                // Only tag bosses (keeps the payload lean for the ~thousands of
                // non-boss entries the auto-linker doesn't care about).
                ...((int) $e->is_boss === 1 ? ['boss' => true] : []),
            ])
            ->filter(fn ($i) => filled($i['name']))
            ->sortByDesc(fn ($i) => mb_strlen($i['name']))
            ->values()
            // Return a plain array, not a Collection: some cache drivers
            // round-trip a serialized Collection into a __PHP_Incomplete_Class,
            // which then JSON-encodes as an object and breaks the client.
            ->all();
    }
}
