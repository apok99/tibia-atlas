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
            $this->perPage($request, 24, 60),
        );

        return EntryListResource::collection($entries);
    }

    /** Global autocomplete search (published lore + the item catalogue). */
    public function search(Request $request): JsonResponse
    {
        return response()->json($this->read->search(
            term: (string) $request->string('q'),
            limit: min(max($request->integer('limit', 8), 1), 25),
        ));
    }

    /** Most-searched terms (falls back to most-viewed). */
    public function topSearches(Request $request): JsonResponse
    {
        return response()->json($this->read->topSearches(
            limit: min(max($request->integer('limit', 8), 1), 20),
            days: min(max($request->integer('days', 30), 1), 365),
        ));
    }

    /**
     * Record that a search result was actually opened (search-popularity log).
     * Best-effort and fire-and-forget from the client.
     */
    public function logSearchClick(Request $request): Response
    {
        $this->read->logSearchClick((string) $request->string('slug'));

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
        $entries = $this->read->trending(min(max($request->integer('count', 9), 1), 24));

        return EntryListResource::collection($entries);
    }

    /** Published entries by all-time popularity, optionally filtered by type. */
    public function popular(Request $request): AnonymousResourceCollection
    {
        $entries = $this->read->popular(
            $request->filled('type') ? (string) $request->string('type') : null,
            $this->perPage($request, 12, 48),
        );

        return EntryListResource::collection($entries);
    }

    /** A small random sample of published entries (excludes an optional slug). */
    public function random(Request $request): AnonymousResourceCollection
    {
        $entries = $this->read->random(
            count: min(max($request->integer('count', 5), 1), 24),
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

    /** Clamp a client-supplied page size to a sane range. */
    private function perPage(Request $request, int $default, int $max): int
    {
        return min(max($request->integer('per_page', $default), 1), $max);
    }
}
