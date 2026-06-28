<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreEntryRequest;
use App\Http\Requests\UpdateEntryRequest;
use App\Http\Resources\EntryListResource;
use App\Http\Resources\EntryResource;
use App\Models\Entry;
use App\Services\EntryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Editorial CRUD over all entries (including drafts). Auth required.
 */
class EntryController extends Controller
{
    public function __construct(private readonly EntryService $entries) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $entries = Entry::query()
            ->with('translations')
            ->when($request->filled('type'), fn ($q) => $q->ofType($request->string('type')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.$request->string('q').'%';
                $q->whereHas('translations', fn ($t) => $t->where('name', 'ilike', $term));
            })
            ->latest('updated_at')
            ->paginate($request->integer('per_page', 30))
            ->withQueryString();

        return EntryListResource::collection($entries);
    }

    public function show(Entry $entry): EntryResource
    {
        $entry->load(['translations', 'sources', 'relatedEntries.translations']);

        return new EntryResource($entry);
    }

    public function store(StoreEntryRequest $request): JsonResponse
    {
        $entry = $this->entries->create($request->validated(), $request->user()->id);

        return (new EntryResource($entry))->response()->setStatusCode(201);
    }

    public function update(UpdateEntryRequest $request, Entry $entry): EntryResource
    {
        $entry = $this->entries->update($entry, $request->validated());

        return new EntryResource($entry);
    }

    public function destroy(Entry $entry): JsonResponse
    {
        $entry->delete();

        return response()->json(null, 204);
    }

    /**
     * Publish every draft at once (optionally only a given type), stamping
     * publish time. Handy after a bulk scrape.
     */
    public function publishDrafts(Request $request): JsonResponse
    {
        $query = Entry::where('status', 'draft')
            ->when($request->filled('type'), fn ($q) => $q->where('type', $request->string('type')));

        $count = $query->update([
            'status' => 'published',
            'published_at' => now(),
        ]);

        return response()->json(['published' => $count, 'message' => "Published {$count} entr(y/ies)."]);
    }
}
