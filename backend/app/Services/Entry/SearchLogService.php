<?php

namespace App\Services\Entry;

use App\Queries\Entry\EntrySearchQuery;
use Illuminate\Support\Facades\DB;

/**
 * Best-effort search-popularity logging, keyed by the entry a user actually
 * OPENED from the search box — never the raw typed text (half-typed fragments
 * polluted the ranking and split one name across duplicate rows). One row per
 * slug; wrapped so a logging failure can never break the request.
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

        try {
            DB::table('search_terms')->upsert(
                [[
                    'slug' => $slug,
                    'term' => $name,
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
