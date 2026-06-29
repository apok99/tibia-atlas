<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\EntryListResource;
use App\Http\Resources\EntryResource;
use App\Jobs\RecordEntryView;
use App\Models\Entry;
use App\Models\EntryView;
use App\Support\ContentCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Public, read-only access to published lore. No auth required.
 */
class EntryController extends Controller
{
    /** Rolling window for the "trending" carousel. */
    private const TRENDING_WINDOW_HOURS = 72;

    /** A visitor's repeat views of the same entry within this window count once. */
    private const VIEW_DEDUP_HOURS = 6;

    public function index(Request $request): AnonymousResourceCollection
    {
        $entries = Entry::query()
            // Free-text search also surfaces the item catalogue, which lives as
            // draft entries (≈10k imported, never hand-published); every other
            // listing stays published-only.
            ->when(
                $request->filled('q'),
                fn ($q) => $q->where(fn ($w) => $w->where('status', 'published')->orWhere('type', 'item')),
                fn ($q) => $q->published(),
            )
            ->with('translations')
            ->when($request->filled('type'), fn ($q) => $q->ofType($request->string('type')))
            ->when($request->boolean('featured'), fn ($q) => $q->where('featured', true))
            // Bestiary facet: filter creatures by their classification (Demon, Undead, …).
            ->when($request->filled('classification'), fn ($q) => $q
                ->where('meta->classification', (string) $request->string('classification')))
            // Bestiary facet: boss=1 → only bosses, boss=0 → only regular creatures.
            ->when($request->filled('boss'), function ($q) use ($request) {
                $request->boolean('boss')
                    ? $q->where('meta->rank', 'Boss')
                    : $q->where(fn ($w) => $w->where('meta->rank', '!=', 'Boss')->orWhereNull('meta->rank'));
            })
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.$request->string('q').'%';
                $q->whereHas('translations', fn ($t) => $t
                    ->where('name', 'ilike', $term)
                    ->orWhere('overview', 'ilike', $term));
            })
            // Draft items have no published_at; keep them last, not first
            // (Postgres sorts NULLs first on DESC by default).
            ->orderByRaw('published_at desc nulls last')
            ->paginate($this->perPage($request, 24, 60))
            ->withQueryString();

        return EntryListResource::collection($entries);
    }

    /** Clamp a client-supplied page size to a sane range. */
    private function perPage(Request $request, int $default, int $max): int
    {
        return min(max($request->integer('per_page', $default), 1), $max);
    }

    /**
     * Global search for the home-page autocomplete. Spans every published entry
     * PLUS the item catalogue (items are imported as drafts but must still be
     * findable) and matches on both the name and the overview. Name matches rank
     * above lore-text-only matches, with shorter names winning ties.
     */
    public function search(Request $request): JsonResponse
    {
        $term = trim((string) $request->string('q'));
        if (mb_strlen($term) < 2) {
            return response()->json(['data' => []]);
        }

        $limit = min(max($request->integer('limit', 8), 1), 25);
        $locale = app()->getLocale();
        $like = '%'.addcslashes($term, '%_\\').'%';

        $rows = Entry::query()
            ->join('entry_translations as et', 'et.entry_id', '=', 'entries.id')
            ->where(fn ($w) => $w->where('entries.status', 'published')->orWhere('entries.type', 'item'))
            ->where(fn ($w) => $w->where('et.name', 'ilike', $like)->orWhere('et.overview', 'ilike', $like))
            ->groupBy('entries.id')
            ->select('entries.*')
            // Name hits rank above overview-only hits; shorter names win ties
            // (so "Demon" beats "Demon Helmet" for the term "demon").
            ->orderByRaw('max((et.name ilike ?)::int) desc', [$like])
            ->orderByRaw('min(char_length(et.name)) asc')
            ->limit($limit)
            ->with('translations')
            ->get();

        $data = $rows
            ->map(fn (Entry $e) => [
                'slug' => $e->slug,
                'type' => $e->type->value,
                'name' => $e->translation($locale)?->name ?? $e->translation('en')?->name,
                'image' => $e->primary_image,
            ])
            ->filter(fn ($i) => filled($i['name']))
            ->values();

        return response()->json(['data' => $data]);
    }

    /**
     * Available filter facets for a given entry type, used to populate the
     * bestiary's filter controls: every classification with its entry count,
     * plus how many entries are bosses.
     */
    public function facets(Request $request): JsonResponse
    {
        $type = (string) $request->string('type');

        // Facets only change when content does; cache them and let any entry
        // write invalidate the whole set via the content version stamp.
        $payload = Cache::remember(ContentCache::key("facets:{$type}"), 3600, function () use ($request, $type) {
            $base = Entry::published()
                ->when($type !== '', fn ($q) => $q->ofType($type));

            $classifications = (clone $base)
                ->selectRaw("meta->>'classification' as value, count(*) as count")
                ->whereRaw("meta->>'classification' is not null")
                ->whereRaw("meta->>'classification' <> ''")
                ->groupByRaw("meta->>'classification'")
                ->orderByDesc('count')
                ->get()
                ->map(fn ($row) => ['value' => $row->value, 'count' => (int) $row->count])
                // Cache a plain array (see glossary): a serialized Collection can
                // round-trip into a __PHP_Incomplete_Class on some cache drivers.
                ->all();

            $bosses = (clone $base)->where('meta->rank', 'Boss')->count();

            return ['classifications' => $classifications, 'bosses' => $bosses];
        });

        return response()->json($payload);
    }

    public function show(Request $request, Entry $entry): EntryResource
    {
        abort_unless($entry->status->value === 'published', 404);

        $this->recordView($request, $entry);

        $entry->load(['translations', 'sources', 'relatedEntries.translations']);

        return new EntryResource($entry);
    }

    /**
     * Count one view of an entry, deduplicated per visitor. The same visitor
     * (identified by a hash of IP + user agent, so no raw PII is stored) only
     * counts once within {@see self::VIEW_DEDUP_HOURS} — keeps reloads from
     * inflating the popularity figures.
     */
    private function recordView(Request $request, Entry $entry): void
    {
        $visitor = hash('sha256', ($request->ip() ?? '').'|'.($request->userAgent() ?? ''));

        // Atomic dedup in the cache: Cache::add only succeeds the first time the
        // key is set, so a repeat view within the window is a single cache op and
        // never touches the database — no SELECT on the hot path.
        $isFreshView = Cache::add(
            "view:{$entry->id}:{$visitor}",
            1,
            now()->addHours(self::VIEW_DEDUP_HOURS)
        );

        if (! $isFreshView) {
            return;
        }

        // Persist off the request path (queued in production).
        RecordEntryView::dispatch($entry->id, $visitor);
    }

    /**
     * The most-viewed published entries within the trailing 72-hour window,
     * across every type (creatures, bosses, historical events, …) — the home
     * page "Trending" carousel. Falls back to all-time popularity, then newest,
     * so the carousel is never empty on a fresh site or quiet day.
     */
    public function trending(Request $request): AnonymousResourceCollection
    {
        $count = min(max($request->integer('count', 9), 1), 24);

        $counts = EntryView::query()
            ->where('created_at', '>=', now()->subHours(self::TRENDING_WINDOW_HOURS))
            ->selectRaw('entry_id, count(*) as views')
            ->groupBy('entry_id')
            ->orderByDesc('views')
            // Over-fetch: some hot entries may be drafts/unpublished.
            ->limit($count * 3)
            ->pluck('views', 'entry_id');

        $entries = Entry::query()
            ->published()
            ->with('translations')
            ->whereIn('id', $counts->keys())
            ->get()
            ->each(fn (Entry $e) => $e->trend_views = (int) ($counts[$e->id] ?? 0))
            ->sortByDesc('trend_views')
            ->take($count)
            ->values();

        if ($entries->count() < $count) {
            $fill = Entry::query()
                ->published()
                ->with('translations')
                ->whereNotIn('id', $entries->pluck('id'))
                ->orderByDesc('view_count')
                ->latest('published_at')
                ->limit($count - $entries->count())
                ->get();

            $entries = $entries->concat($fill)->values();
        }

        return EntryListResource::collection($entries);
    }

    /**
     * Published entries ordered by all-time popularity, optionally filtered by
     * type — the home page "Most popular" list with its category filters.
     */
    public function popular(Request $request): AnonymousResourceCollection
    {
        $entries = Entry::query()
            ->published()
            ->with('translations')
            ->when($request->filled('type'), fn ($q) => $q->ofType($request->string('type')))
            ->orderByDesc('view_count')
            ->latest('published_at')
            ->paginate($this->perPage($request, 12, 48))
            ->withQueryString();

        return EntryListResource::collection($entries);
    }

    /**
     * A small random sample of published entries, used by the frontend's
     * rotating "recommended reading" widget. Excludes the given slug (e.g.
     * the entry currently being viewed) so it never recommends itself.
     */
    public function random(Request $request): AnonymousResourceCollection
    {
        $count = min(max($request->integer('count', 5), 1), 24);
        $exclude = $request->filled('exclude') ? (string) $request->string('exclude') : null;

        // `ORDER BY RANDOM()` full-scans + sorts the whole table on every call.
        // Instead keep a cheap cached pool of published [id => slug] (invalidated
        // by the content version stamp) and sample it in PHP.
        $pool = Cache::remember(
            ContentCache::key('random-pool'),
            3600,
            fn () => Entry::published()->pluck('slug', 'id')->all()
        );

        $ids = array_keys($pool);
        if ($exclude !== null) {
            $ids = array_values(array_filter($ids, fn ($id) => $pool[$id] !== $exclude));
        }

        if ($ids === []) {
            return EntryListResource::collection(collect());
        }

        shuffle($ids);
        $pick = array_slice($ids, 0, $count);

        $entries = Entry::query()
            ->whereIn('id', $pick)
            ->with('translations')
            ->get();

        return EntryListResource::collection($entries);
    }

    /**
     * Lightweight index of every published entry's name in the active locale,
     * used by the frontend to auto-link entity mentions inside lore text.
     */
    public function glossary(): JsonResponse
    {
        $locale = app()->getLocale();

        // The glossary is requested on virtually every page (to auto-link entity
        // mentions) yet only changes when content is edited. Cache it per locale,
        // selecting just the columns the payload needs instead of hydrating the
        // full Entry + every translation field.
        $items = Cache::remember(ContentCache::key("glossary:{$locale}"), 3600, function () use ($locale) {
            return Entry::published()
                ->select('id', 'slug', 'type')
                ->with(['translations' => fn ($q) => $q->select('id', 'entry_id', 'locale', 'name')])
                ->get()
                ->map(fn (Entry $e) => [
                    'slug' => $e->slug,
                    'type' => $e->type->value,
                    'name' => $e->translation($locale)?->name,
                ])
                ->filter(fn ($i) => filled($i['name']))
                // Longest names first so multi-word matches win over their substrings.
                ->sortByDesc(fn ($i) => mb_strlen($i['name']))
                ->values()
                // Cache a plain array, not a Collection: some cache drivers
                // round-trip a serialized Collection into a __PHP_Incomplete_Class,
                // which then JSON-encodes as an object and breaks the client.
                ->all();
        });

        return response()->json(['data' => $items]);
    }

    /**
     * All creature spawn points on a given floor (z), aggregated across
     * published creatures, for the map's "all creatures" overlay. Compact
     * payload: a `creatures` table + `points` as [x, y, creatureIndex].
     */
    public function spawns(Request $request): JsonResponse
    {
        $z = (int) $request->query('z', 7);
        $locale = app()->getLocale();

        $payload = Cache::remember("map-spawns-{$locale}-{$z}", 600, function () use ($z, $locale) {
            $creatures = [];
            $points = [];

            // All creatures with spawn data (incl. drafts) — the map is a
            // hunting tool, so surface every documented spawn, not just
            // published articles.
            Entry::query()
                ->where('type', 'creature')
                ->whereNotNull('meta->spawn_count')
                ->with('translations')
                ->get()
                ->each(function (Entry $e) use ($z, $locale, &$creatures, &$points) {
                    $idx = null;
                    foreach (($e->meta['spawns'] ?? []) as $s) {
                        if ((int) $s[2] !== $z) {
                            continue;
                        }
                        if ($idx === null) {
                            $idx = count($creatures);
                            $creatures[] = [
                                'slug' => $e->slug,
                                // Creature names are proper nouns — keep the
                                // original English name on the map regardless of UI locale.
                                'name' => $e->translation('en')?->name
                                    ?? $e->translation($locale)?->name
                                    ?? $e->slug,
                                'image' => $e->primary_image,
                                'classification' => $e->meta['classification'] ?? null,
                                'difficulty' => $e->meta['difficulty'] ?? null,
                                'boss' => ($e->meta['rank'] ?? null) === 'Boss',
                            ];
                        }
                        $points[] = [(int) $s[0], (int) $s[1], $idx];
                    }
                });

            return ['creatures' => $creatures, 'points' => $points];
        });

        return response()->json($payload);
    }
}
