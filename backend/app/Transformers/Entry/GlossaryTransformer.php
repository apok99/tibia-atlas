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
            ->map(function (Entry $e) use ($locale) {
                $isBoss = (int) $e->is_boss === 1;
                // spawn_type comes back as raw JSON text ("[\"Raid\"]"); decode it
                // to a list. Tolerate a legacy plain string ("Raid, Unique") too.
                $spawn = null;
                if ($isBoss && filled($e->spawn_type)) {
                    $decoded = json_decode((string) $e->spawn_type, true);
                    $spawn = is_array($decoded)
                        ? array_values(array_filter($decoded))
                        : array_values(array_filter(array_map('trim', explode(',', (string) $decoded))));
                }

                return [
                    'slug' => $e->slug,
                    'type' => $e->type->value,
                    'name' => $e->translation($locale)?->name,
                    'image' => $e->primary_image,
                    // Only tag bosses (keeps the payload lean for the ~thousands of
                    // non-boss entries the auto-linker doesn't care about).
                    ...($isBoss ? ['boss' => true] : []),
                    // Its spawntypes — drives the Boss Watch's category tabs.
                    ...($spawn ? ['spawn_type' => $spawn] : []),
                ];
            })
            ->filter(fn ($i) => filled($i['name']))
            ->sortByDesc(fn ($i) => mb_strlen($i['name']))
            ->values()
            // Return a plain array, not a Collection: some cache drivers
            // round-trip a serialized Collection into a __PHP_Incomplete_Class,
            // which then JSON-encodes as an object and breaks the client.
            ->all();
    }
}
