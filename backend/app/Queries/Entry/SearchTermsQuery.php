<?php

namespace App\Queries\Entry;

use App\Services\Entry\SearchLogService;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Read of the most-searched log. The write side lives in
 * {@see SearchLogService}.
 *
 * Ranks by how many searches landed INSIDE the window, counted from the event
 * log — not by the lifetime counter in `search_terms`. With the counter, one
 * popular week pinned an entry to the top forever and nothing searched today
 * could overtake it, which is exactly what made the panel look frozen.
 */
class SearchTermsQuery
{
    /**
     * Most-searched entries within the trailing window, most searches first.
     *
     * @return Collection<int, \stdClass> rows of {slug, term, hits}
     */
    public function topTerms(int $days, int $limit): Collection
    {
        return DB::table('search_clicks')
            ->where('searched_at', '>=', now()->subDays($days))
            // NPC searches have no slug and group by name; everything else
            // groups by slug, so a rename can't split one entry in two.
            ->groupBy(DB::raw('coalesce(slug, term)'))
            ->orderByDesc('hits')
            ->limit($limit)
            ->get([
                DB::raw('max(slug) as slug'),
                DB::raw('max(term) as term'),
                DB::raw('count(*) as hits'),
            ]);
    }
}
