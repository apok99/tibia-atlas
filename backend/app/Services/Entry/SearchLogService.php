<?php

namespace App\Services\Entry;

use App\Models\TradeNpc;
use App\Queries\Entry\EntrySearchQuery;
use Illuminate\Support\Facades\DB;

/**
 * Best-effort search-popularity logging, keyed by what a user actually OPENED
 * from a search box — never the raw typed text (half-typed fragments polluted
 * the ranking and split one name across duplicate rows).
 *
 * Two writes per click: an EVENT row in `search_clicks` (what the windowed
 * "most searched" ranking reads) and the lifetime counter in `search_terms`.
 * Both are wrapped so a logging failure can never break the request.
 */
class SearchLogService
{
    public function __construct(private EntrySearchQuery $entries) {}

    public function recordClick(string $slug): void
    {
        $slug = trim($slug);
        if ($slug === '' || mb_strlen($slug) > 120) {
            return;
        }

        // Only log real, searchable entries; capture the canonical name now so
        // the dashboard has a label even if the entry later changes.
        $entry = $this->entries->findBySlug($slug);
        if ($entry === null) {
            return;
        }
        $name = $entry->translation('en')?->name
            ?? $entry->translation(app()->getLocale())?->name
            ?? $slug;

        $this->write($slug, $name);
    }

    /**
     * A merchant NPC opened from the map's NPC search. Most of them have no lore
     * page — without this the whole third mode of the map's search box would log
     * nothing. The name is validated against the NPC directory rather than
     * trusted, so this unauthenticated endpoint can't write arbitrary text into
     * a public panel.
     */
    public function recordNpcClick(string $name): void
    {
        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 120) {
            return;
        }

        $npc = TradeNpc::query()->where('name', $name)->first();
        if ($npc === null) {
            return;
        }

        // An NPC that DOES have a published page logs as that entry, so the two
        // paths never split one NPC across two rows.
        $entry = $npc->entry;
        if ($entry !== null && $entry->status->value === 'published') {
            $this->recordClick($entry->slug);

            return;
        }

        $this->write(null, $npc->name);
    }

    /** Append the event + bump the all-time counter. Never throws. */
    private function write(?string $slug, string $term): void
    {
        try {
            DB::table('search_clicks')->insert([
                'slug' => $slug,
                'term' => $term,
                'searched_at' => now(),
            ]);

            if ($slug === null) {
                return;
            }

            DB::table('search_terms')->upsert(
                [[
                    'slug' => $slug,
                    'term' => $term,
                    'hits' => 1,
                    'last_searched_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]],
                ['slug'],
                // Postgres: reference the proposed row via EXCLUDED through a raw
                // expression so hits accumulate instead of resetting to 1.
                [
                    'hits' => DB::raw('search_terms.hits + 1'),
                    'term' => DB::raw('excluded.term'),
                    'last_searched_at' => DB::raw('excluded.last_searched_at'),
                    'updated_at' => DB::raw('excluded.updated_at'),
                ],
            );
        } catch (\Throwable) {
            // never block the request on a logging failure
        }
    }
}
