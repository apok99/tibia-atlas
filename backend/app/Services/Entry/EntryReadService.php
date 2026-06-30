<?php

namespace App\Services\Entry;

use App\Models\Entry;
use App\Queries\Entry\EntryFacetsQuery;
use App\Queries\Entry\EntryListFilters;
use App\Queries\Entry\EntryListingQuery;
use App\Queries\Entry\EntrySearchQuery;
use App\Queries\Entry\GlossaryQuery;
use App\Queries\Entry\PopularEntriesQuery;
use App\Queries\Entry\RandomEntriesQuery;
use App\Queries\Entry\SearchTermsQuery;
use App\Queries\Entry\SpawnsQuery;
use App\Queries\Entry\TrendingEntriesQuery;
use App\Support\ContentCache;
use App\Transformers\Entry\GlossaryTransformer;
use App\Transformers\Entry\SearchResultTransformer;
use App\Transformers\Entry\SpawnsTransformer;
use App\Transformers\Entry\TopSearchTransformer;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

/**
 * Read-side application service for published lore. Each method assembles one
 * endpoint by delegating to a query (DB) and a transformer (shape), and owns the
 * caching policy for the rarely-changing endpoints (facets, glossary, …).
 */
class EntryReadService
{
    /** Rolling window for the "trending" carousel. */
    private const TRENDING_WINDOW_HOURS = 72;

    /** A searched term must resolve to at least this many before we trust the log. */
    private const MIN_TERMS = 3;

    public function __construct(
        private EntryListingQuery $listing,
        private EntrySearchQuery $search,
        private SearchTermsQuery $searchTerms,
        private EntryFacetsQuery $facets,
        private TrendingEntriesQuery $trending,
        private PopularEntriesQuery $popular,
        private RandomEntriesQuery $random,
        private GlossaryQuery $glossary,
        private SpawnsQuery $spawns,
        private SearchResultTransformer $searchResults,
        private TopSearchTransformer $topSearches,
        private GlossaryTransformer $glossaryTransformer,
        private SpawnsTransformer $spawnsTransformer,
        private SearchLogService $searchLog,
        private EntryViewTracker $viewTracker,
    ) {}

    /**
     * @return LengthAwarePaginator<int, Entry>
     */
    public function listing(EntryListFilters $filters, int $perPage): LengthAwarePaginator
    {
        return $this->listing->paginate($filters, $perPage);
    }

    /**
     * Autocomplete search results. Popularity is logged on click
     * ({@see logSearchClick}), not here — so half-typed fragments never pollute
     * the "most searched" ranking.
     *
     * @return array<string, mixed>
     */
    public function search(string $term, int $limit): array
    {
        $term = trim($term);
        if (mb_strlen($term) < 2) {
            return ['data' => []];
        }

        return ['data' => $this->searchResults->collection(
            $this->search->search($term, $limit),
            app()->getLocale(),
        )];
    }

    /** Record that a search result was opened, feeding the "most searched" log. */
    public function logSearchClick(string $slug): void
    {
        $this->searchLog->recordClick($slug);
    }

    /**
     * Most-searched (most-opened) entries, falling back to most-viewed while the
     * search log is still sparse.
     *
     * @return array<string, mixed>
     */
    public function topSearches(int $limit, int $days): array
    {
        $locale = app()->getLocale();
        $terms = $this->searchTerms->topTerms($days, $limit);

        if ($terms->count() >= self::MIN_TERMS) {
            // Resolve every slug at once for the sprite + link + localised name.
            $entries = $this->search->bySlugs($terms->pluck('slug')->all());

            $data = $terms->map(fn ($row) => $this->topSearches->term(
                $row->term,
                (int) $row->hits,
                $entries[$row->slug] ?? null,
                $locale,
            ))->values();

            return ['source' => 'searches', 'data' => $data];
        }

        // Fallback: most-viewed published entries (real data from day one).
        $data = $this->popular->mostViewed($limit)
            ->map(fn (Entry $e) => $this->topSearches->fromView($e, $locale))
            ->filter(fn ($i) => filled($i['name']))
            ->values();

        return ['source' => 'views', 'data' => $data];
    }

    /**
     * Cached filter facets for a type; any content write invalidates the set via
     * the content version stamp.
     *
     * @return array<string, mixed>
     */
    public function facets(string $type): array
    {
        return Cache::remember(
            ContentCache::key("facets:{$type}"),
            3600,
            fn () => $this->facets->compute($type),
        );
    }

    /**
     * Most-viewed published entries in the trailing 72h window, topped up with
     * all-time popular / newest so the carousel is never empty.
     *
     * @return Collection<int, Entry>
     */
    public function trending(int $count): Collection
    {
        $counts = $this->trending->recentViewCounts(self::TRENDING_WINDOW_HOURS, $count);

        $entries = $this->trending->publishedByIds($counts->keys())
            ->each(fn (Entry $e) => $e->trend_views = (int) ($counts[$e->id] ?? 0))
            ->sortByDesc('trend_views')
            ->take($count)
            ->values();

        if ($entries->count() < $count) {
            $fill = $this->trending->fallback($entries->pluck('id'), $count - $entries->count());
            $entries = $entries->concat($fill)->values();
        }

        return $entries;
    }

    /**
     * @return LengthAwarePaginator<int, Entry>
     */
    public function popular(?string $type, int $perPage): LengthAwarePaginator
    {
        return $this->popular->paginate($type, $perPage);
    }

    /**
     * A random sample of published entries, excluding one slug. Samples a cached
     * [id => slug] pool in PHP instead of ORDER BY RANDOM().
     *
     * @return Collection<int, Entry>
     */
    public function random(int $count, ?string $exclude, bool $preferImages = false): Collection
    {
        $pool = Cache::remember(
            ContentCache::key('random-pool-v2'),
            3600,
            fn () => $this->random->pool(),
        );

        $ids = array_keys($pool);
        if ($exclude !== null) {
            $ids = array_values(array_filter($ids, fn ($id) => $pool[$id]['slug'] !== $exclude));
        }

        if ($ids === []) {
            return collect();
        }

        if ($preferImages) {
            $withImg = array_values(array_filter($ids, fn ($id) => $pool[$id]['img']));
            $withoutImg = array_values(array_filter($ids, fn ($id) => ! $pool[$id]['img']));
            shuffle($withImg);
            shuffle($withoutImg);
            // Images first; dip into image-less entries only to top up the count.
            $ids = array_merge($withImg, $withoutImg);
        } else {
            shuffle($ids);
        }

        return $this->random->byIds(array_slice($ids, 0, $count));
    }

    /**
     * Cached per-locale glossary for auto-linking entity mentions.
     *
     * @return array<string, mixed>
     */
    public function glossary(): array
    {
        $locale = app()->getLocale();

        return Cache::remember(
            ContentCache::key("glossary:{$locale}"),
            3600,
            fn () => $this->glossaryTransformer->items($this->glossary->publishedNames(), $locale),
        );
    }

    /**
     * Cached spawn overlay for one floor (z).
     *
     * @return array<string, mixed>
     */
    public function spawns(int $z): array
    {
        $locale = app()->getLocale();

        return Cache::remember(
            "map-spawns-{$locale}-{$z}",
            600,
            fn () => $this->spawnsTransformer->forFloor($this->spawns->creaturesWithSpawns(), $z, $locale),
        );
    }

    /**
     * Record a view (deduplicated) and eager-load the relations the detail
     * resource needs.
     */
    public function show(Request $request, Entry $entry): Entry
    {
        $this->viewTracker->record($request, $entry);
        $entry->load(['translations', 'sources', 'relatedEntries.translations']);

        return $entry;
    }
}
