<?php

namespace App\Queries\Entry;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Read of the most-searched entries log (one row per opened slug). The write
 * side lives in {@see \App\Services\Entry\SearchLogService}.
 */
class SearchTermsQuery
{
    /**
     * Most-opened entries within the trailing window, most hits first.
     *
     * @return Collection<int, \stdClass>  rows of {slug, term, hits}
     */
    public function topTerms(int $days, int $limit): Collection
    {
        return DB::table('search_terms')
            // Legacy rows logged raw typed fragments (e.g. "mord") with no slug;
            // they can't resolve to an entry, so skip them — only real opened
            // entries count, and the service falls back to "most viewed" until
            // enough genuine slug-based searches accumulate.
            ->whereNotNull('slug')
            ->where('last_searched_at', '>=', now()->subDays($days))
            ->orderByDesc('hits')
            ->limit($limit)
            ->get(['slug', 'term', 'hits']);
    }
}
