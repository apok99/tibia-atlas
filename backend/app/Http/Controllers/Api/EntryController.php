<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreEntryRequest;
use App\Http\Requests\UpdateEntryRequest;
use App\Http\Resources\EntryListResource;
use App\Http\Resources\EntryResource;
use App\Models\Entry;
use App\Queries\Entry\EntryListFilters;
use App\Services\Entry\EntryReadService;
use App\Services\EntryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Public, read-only access to published lore plus the authenticated editorial
 * CRUD. Controllers stay thin: they normalise HTTP input and delegate to
 * {@see EntryReadService} (reads) and {@see EntryService} (writes), which work
 * through queries + transformers.
 */
class EntryController extends Controller
{
    public function __construct(
        private EntryReadService $read,
        private EntryService $entries,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $entries = $this->read->listing(
            EntryListFilters::fromRequest($request),
            $this->clamp($request, 'per_page', 24, 1, 60),
        );

        return EntryListResource::collection($entries);
    }

    /** Global autocomplete search (published lore + the item catalogue). */
    public function search(Request $request): JsonResponse
    {
        return response()->json($this->read->search(
            term: (string) $request->string('q'),
            limit: $this->clamp($request, 'limit', 8, 1, 25),
        ));
    }

    /** Most-searched terms (falls back to most-viewed). */
    public function topSearches(Request $request): JsonResponse
    {
        return response()->json($this->read->topSearches(
            limit: $this->clamp($request, 'limit', 8, 1, 20),
            days: $this->clamp($request, 'days', 30, 1, 365),
        ));
    }

    /**
     * Record that a search result was actually opened (search-popularity log).
     * Best-effort and fire-and-forget from the client.
     */
    public function logSearchClick(Request $request): Response
    {
        // `npc` is the map's NPC search: merchants mostly have no lore page, so
        // there is no slug to log — the name is resolved server-side instead.
        $npc = (string) $request->string('npc');
        if ($npc !== '') {
            $this->read->logNpcSearchClick($npc);
        } else {
            $this->read->logSearchClick((string) $request->string('slug'));
        }

        return response()->noContent();
    }

    /** Available filter facets for the bestiary controls. */
    public function facets(Request $request): JsonResponse
    {
        return response()->json($this->read->facets((string) $request->string('type')));
    }

    public function show(Request $request, Entry $entry): EntryResource
    {
        abort_unless($entry->status->value === 'published', 404);

        return new EntryResource($this->read->show($request, $entry));
    }

    /** The home-page "Trending" carousel (trailing 72h, with fallbacks). */
    public function trending(Request $request): AnonymousResourceCollection
    {
        $entries = $this->read->trending($this->clamp($request, 'count', 9, 1, 24));

        return EntryListResource::collection($entries);
    }

    /** Published entries by all-time popularity, optionally filtered by type. */
    public function popular(Request $request): AnonymousResourceCollection
    {
        $entries = $this->read->popular(
            $request->filled('type') ? (string) $request->string('type') : null,
            $this->clamp($request, 'per_page', 12, 1, 48),
        );

        return EntryListResource::collection($entries);
    }

    /** A small random sample of published entries (excludes an optional slug). */
    public function random(Request $request): AnonymousResourceCollection
    {
        $entries = $this->read->random(
            count: $this->clamp($request, 'count', 5, 1, 24),
            exclude: $request->filled('exclude') ? (string) $request->string('exclude') : null,
            preferImages: $request->boolean('images'),
        );

        return EntryListResource::collection($entries);
    }

    /** Auto-linking glossary of every published entry's name in the active locale. */
    public function glossary(): JsonResponse
    {
        return response()->json(['data' => $this->read->glossary()]);
    }

    /** All creature spawn points on a floor (z), for the map overlay. */
    public function spawns(Request $request): JsonResponse
    {
        return response()->json($this->read->spawns((int) $request->query('z', 7)));
    }

    // ---- Editorial CRUD (authenticated) --------------------------------

    public function store(StoreEntryRequest $request): JsonResponse
    {
        $entry = $this->entries->create($request->validated(), $request->user()?->id);

        return (new EntryResource($entry))->response()->setStatusCode(Response::HTTP_CREATED);
    }

    public function update(UpdateEntryRequest $request, Entry $entry): EntryResource
    {
        return new EntryResource($this->entries->update($entry, $request->validated()));
    }

    public function destroy(Entry $entry): Response
    {
        $this->entries->delete($entry);

        return response()->noContent();
    }
}
