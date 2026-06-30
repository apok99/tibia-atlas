<?php

namespace App\Queries\Entry;

use App\Models\Entry;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

/**
 * All-time popularity reads: the paginated "Most popular" list and the
 * most-viewed fallback used when the search log is still sparse.
 */
class PopularEntriesQuery
{
    /**
     * @return LengthAwarePaginator<int, Entry>
     */
    public function paginate(?string $type, int $perPage): LengthAwarePaginator
    {
        return Entry::query()
            ->published()
            ->with('translations')
            ->when($type !== null, fn ($q) => $q->ofType($type))
            ->orderByDesc('view_count')
            ->latest('published_at')
            ->paginate($perPage)
            ->withQueryString();
    }

    /**
     * Most-viewed published entries (real data from day one).
     *
     * @return Collection<int, Entry>
     */
    public function mostViewed(int $limit): Collection
    {
        return Entry::query()
            ->published()
            ->where('view_count', '>', 0)
            ->orderByDesc('view_count')
            ->with('translations')
            ->limit($limit)
            ->get();
    }
}
