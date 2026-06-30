<?php

namespace App\Queries\Entry;

use App\Models\Entry;
use App\Models\EntryView;
use Illuminate\Support\Collection;

/**
 * Raw reads behind the "Trending" carousel: recent view counts plus the
 * published entries that back them (and a fallback pool to top the list up).
 */
class TrendingEntriesQuery
{
    /**
     * View counts per entry within the trailing window.
     *
     * @return Collection<int, int>  views keyed by entry_id
     */
    public function recentViewCounts(int $hours, int $limit): Collection
    {
        return EntryView::query()
            ->where('created_at', '>=', now()->subHours($hours))
            ->selectRaw('entry_id, count(*) as views')
            ->groupBy('entry_id')
            ->orderByDesc('views')
            // Over-fetch: some hot entries may be drafts/unpublished.
            ->limit($limit * 3)
            ->pluck('views', 'entry_id');
    }

    /**
     * Published entries for the given ids.
     *
     * @param  iterable<int>  $ids
     * @return Collection<int, Entry>
     */
    public function publishedByIds(iterable $ids): Collection
    {
        return Entry::query()
            ->published()
            ->with('translations')
            ->whereIn('id', $ids)
            ->get();
    }

    /**
     * Fallback pool (most-viewed, then newest) excluding entries already chosen.
     *
     * @param  iterable<int>  $excludeIds
     * @return Collection<int, Entry>
     */
    public function fallback(iterable $excludeIds, int $limit): Collection
    {
        return Entry::query()
            ->published()
            ->with('translations')
            ->whereNotIn('id', $excludeIds)
            ->orderByDesc('view_count')
            ->latest('published_at')
            ->limit($limit)
            ->get();
    }
}
