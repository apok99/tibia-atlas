<?php

namespace App\Transformers\Entry;

use App\Models\Entry;
use Illuminate\Support\Collection;

/**
 * Builds the compact map-overlay payload for a single floor (z): a `creatures`
 * table plus `points` as [x, y, creatureIndex], aggregated across creatures.
 */
class SpawnsTransformer
{
    /**
     * @param  Collection<int, Entry>  $entries
     * @return array{creatures: list<array<string, mixed>>, points: list<array{0:int,1:int,2:int}>}
     */
    public function forFloor(Collection $entries, int $z, string $locale): array
    {
        $creatures = [];
        $points = [];

        foreach ($entries as $e) {
            $idx = null;
            foreach (($e->meta['spawns'] ?? []) as $s) {
                if ((int) $s[2] !== $z) {
                    continue;
                }
                if ($idx === null) {
                    // Creature names are proper nouns — keep the original English
                    // name on the map regardless of UI locale.
                    $enName = $e->translation('en')?->name
                        ?? $e->translation($locale)?->name
                        ?? $e->slug;
                    $idx = count($creatures);
                    $creatures[] = [
                        'slug' => $e->slug,
                        'name' => $enName,
                        'image' => $e->primary_image,
                        'classification' => $e->meta['classification'] ?? null,
                        'difficulty' => $e->meta['difficulty'] ?? null,
                        'boss' => ($e->meta['rank'] ?? null) === 'Boss',
                        // Signals the client turns into the spawn money badge + a
                        // "profit" heat: realistic expected gold per kill (from
                        // TibiaWiki loot statistics, `tibia:etl-loot-stats`) and
                        // experience. loot_value is 0 for creatures without stats.
                        'experience' => (int) ($e->meta['experience'] ?? 0),
                        'loot_value' => (int) ($e->meta['gold_per_kill'] ?? 0),
                    ];
                }
                $points[] = [(int) $s[0], (int) $s[1], $idx];
            }
        }

        return ['creatures' => $creatures, 'points' => $points];
    }
}
