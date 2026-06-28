<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\EntryListResource;
use App\Http\Resources\EntryResource;
use App\Models\Entry;
use App\Models\EntryView;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
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
            ->published()
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
            ->latest('published_at')
            ->paginate($request->integer('per_page', 24))
            ->withQueryString();

        return EntryListResource::collection($entries);
    }

    /**
     * Available filter facets for a given entry type, used to populate the
     * bestiary's filter controls: every classification with its entry count,
     * plus how many entries are bosses.
     */
    public function facets(Request $request): JsonResponse
    {
        $base = Entry::published()
            ->when($request->filled('type'), fn ($q) => $q->ofType($request->string('type')));

        $classifications = (clone $base)
            ->selectRaw("meta->>'classification' as value, count(*) as count")
            ->whereRaw("meta->>'classification' is not null")
            ->whereRaw("meta->>'classification' <> ''")
            ->groupByRaw("meta->>'classification'")
            ->orderByDesc('count')
            ->get()
            ->map(fn ($row) => ['value' => $row->value, 'count' => (int) $row->count]);

        $bosses = (clone $base)->where('meta->rank', 'Boss')->count();

        return response()->json([
            'classifications' => $classifications,
            'bosses' => $bosses,
        ]);
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

        $seenRecently = EntryView::query()
            ->where('entry_id', $entry->id)
            ->where('visitor', $visitor)
            ->where('created_at', '>=', now()->subHours(self::VIEW_DEDUP_HOURS))
            ->exists();

        if ($seenRecently) {
            return;
        }

        EntryView::create(['entry_id' => $entry->id, 'visitor' => $visitor]);

        // Bump the all-time counter without touching the entry's updated_at
        // (a view is not an editorial change).
        Entry::whereKey($entry->id)->update(['view_count' => DB::raw('view_count + 1')]);
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
            ->paginate($request->integer('per_page', 12))
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
        $entries = Entry::query()
            ->published()
            ->with('translations')
            ->when($request->filled('exclude'), fn ($q) => $q->where('slug', '!=', $request->string('exclude')))
            ->inRandomOrder()
            ->limit($request->integer('count', 5))
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

        $items = Entry::published()
            ->with('translations')
            ->get()
            ->map(fn (Entry $e) => [
                'slug' => $e->slug,
                'type' => $e->type->value,
                'name' => $e->translation($locale)?->name,
            ])
            ->filter(fn ($i) => filled($i['name']))
            // Longest names first so multi-word matches win over their substrings.
            ->sortByDesc(fn ($i) => mb_strlen($i['name']))
            ->values();

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
