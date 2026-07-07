<?php

namespace App\Queries\Entry;

use App\Models\Entry;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

/**
 * The bestiary / content listing query: published-only, with optional type,
 * featured, classification and boss facets plus free-text search.
 */
class EntryListingQuery
{
    /**
     * @return LengthAwarePaginator<int, Entry>
     */
    public function paginate(EntryListFilters $filters, int $perPage): LengthAwarePaginator
    {
        return Entry::query()
            // Free-text search also surfaces the item catalogue, which lives as
            // draft entries (≈10k imported, never hand-published); every other
            // listing stays published-only.
            ->when(
                $filters->q !== null,
                fn ($q) => $q->where(fn ($w) => $w->where('status', 'published')->orWhere('type', 'item')),
                fn ($q) => $q->published(),
            )
            ->with('translations')
            ->when($filters->type !== null, fn ($q) => $q->ofType($filters->type))
            ->when($filters->featuredOnly, fn ($q) => $q->where('featured', true))
            // Bestiary facet: filter creatures by their classification (Demon, Undead, …).
            ->when($filters->classification !== null, fn ($q) => $q
                ->where('meta->classification', $filters->classification))
            // Bestiary facet: boss=1 → only bosses, boss=0 → only regular creatures.
            ->when($filters->boss !== null, fn ($q) => $filters->boss
                ? $q->where('meta->rank', 'Boss')
                : $q->where(fn ($w) => $w->where('meta->rank', '!=', 'Boss')->orWhereNull('meta->rank')))
            ->when($filters->q !== null, function ($q) use ($filters) {
                // Escape LIKE wildcards in user input so "50%" or "a_b" match
                // literally, mirroring the autocomplete search.
                $escaped = addcslashes($filters->q, '%_\\');

                if ($filters->qMode === 'starts') {
                    // Prefix mode: only names that begin with the term — the
                    // overview would make "starts with" meaningless.
                    $q->whereHas('translations', fn ($t) => $t
                        ->where('name', 'ilike', $escaped.'%'));

                    return;
                }

                $term = '%'.$escaped.'%';
                $q->whereHas('translations', fn ($t) => $t
                    ->where('name', 'ilike', $term)
                    ->orWhere('overview', 'ilike', $term))
                    // Rank name matches above overview-only matches, so a search
                    // for "dragon" surfaces the actual dragons before creatures
                    // that merely mention them in their lore. Applied before the
                    // published_at order below, so relevance wins.
                    ->orderByRaw(
                        'exists (select 1 from entry_translations et where et.entry_id = entries.id and et.name ilike ?) desc',
                        [$term],
                    );
            })
            // Draft items have no published_at; keep them last, not first
            // (Postgres sorts NULLs first on DESC by default). The `id`
            // tiebreaker is essential: bulk-imported creatures share one
            // published_at (405 in a single batch), and without a stable
            // secondary sort Postgres returns those ties in an arbitrary order
            // that differs per page — the same creature surfaces on several
            // pages while others vanish.
            ->orderByRaw('published_at desc nulls last')
            ->orderBy('id')
            ->paginate($perPage)
            ->withQueryString();
    }
}
