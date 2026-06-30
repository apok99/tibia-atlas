<?php

namespace App\Queries\Entry;

use App\Models\Entry;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * Free-text entry search across published lore PLUS the item catalogue (items
 * are imported as drafts but must stay findable). Matches name + overview; name
 * hits rank above overview-only hits, shorter names winning ties.
 */
class EntrySearchQuery
{
    /**
     * Ranked autocomplete results for a search term.
     *
     * @return Collection<int, Entry>
     */
    public function search(string $term, int $limit): Collection
    {
        $like = $this->like($term);

        return $this->base()
            ->where(fn ($w) => $w->where('et.name', 'ilike', $like)->orWhere('et.overview', 'ilike', $like))
            // Name hits rank above overview-only hits; shorter names win ties
            // (so "Demon" beats "Demon Helmet" for the term "demon").
            ->orderByRaw('max((et.name ilike ?)::int) desc', [$like])
            ->orderByRaw('min(char_length(et.name)) asc')
            ->limit($limit)
            ->with('translations')
            ->get();
    }

    /**
     * One searchable entry (published lore or item) by slug, with translations —
     * for resolving a clicked search result before logging it.
     */
    public function findBySlug(string $slug): ?Entry
    {
        return $this->inScope()
            ->where('slug', $slug)
            ->with('translations')
            ->first();
    }

    /**
     * Resolve many searchable entries by slug at once (sprite + link for the
     * most-searched module), keyed by slug.
     *
     * @param  list<string>  $slugs
     * @return Collection<string, Entry>
     */
    public function bySlugs(array $slugs): Collection
    {
        return $this->inScope()
            ->whereIn('slug', $slugs)
            ->with('translations')
            ->get()
            ->keyBy('slug');
    }

    /**
     * Shared base for ranked text search: join translations, restrict to
     * published lore + items, group by entry so each surfaces once.
     *
     * @return Builder<Entry>
     */
    private function base(): Builder
    {
        return Entry::query()
            ->join('entry_translations as et', 'et.entry_id', '=', 'entries.id')
            ->where(fn ($w) => $w->where('entries.status', 'published')->orWhere('entries.type', 'item'))
            ->groupBy('entries.id')
            ->select('entries.*');
    }

    /**
     * The searchable scope: published lore plus the (draft) item catalogue.
     *
     * @return Builder<Entry>
     */
    private function inScope(): Builder
    {
        return Entry::query()
            ->where(fn ($w) => $w->where('status', 'published')->orWhere('type', 'item'));
    }

    /** Escape LIKE wildcards in user input and wrap for a contains match. */
    private function like(string $term): string
    {
        return '%'.addcslashes($term, '%_\\').'%';
    }
}
