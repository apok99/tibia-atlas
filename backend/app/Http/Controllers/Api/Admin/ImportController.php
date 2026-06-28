<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\EntryType;
use App\Http\Controllers\Controller;
use App\Jobs\ScrapeCreaturesJob;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ImportController extends Controller
{
    public function __construct(private readonly TibiaWikiImporter $importer) {}

    /**
     * Import a TibiaWiki page as a draft entry for editorial review.
     */
    public function tibiawiki(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'type' => ['nullable', Rule::in(EntryType::values())],
        ]);

        $type = isset($data['type']) ? EntryType::from($data['type']) : EntryType::Creature;

        $run = $this->importer->import($data['title'], $type, $request->user()->id);

        return response()->json([
            'status' => $run->status,
            'message' => $run->message,
            'entry_id' => $run->entry_id,
        ], $run->status === 'success' ? 201 : 422);
    }

    /**
     * Bulk-import a batch of creatures from TibiaWiki as drafts. Bounded per
     * request (this runs synchronously); call repeatedly to keep going, or use
     * the `tibia:scrape-creatures` command for a full unattended run.
     */
    public function scrapeCreatures(Request $request): JsonResponse
    {
        // 0 = fill the whole roster. Runs in the background (queue worker) so the
        // many slow TibiaWiki calls never block the single-process dev server.
        $limit = max(0, $request->integer('limit', 0));

        ScrapeCreaturesJob::dispatch($limit, $request->user()->id);

        $what = $limit > 0 ? "{$limit} creatures" : 'the full roster';
        return response()->json([
            'queued' => true,
            'message' => "Importing {$what} from TibiaWiki in the background. Refresh periodically to see new drafts appear.",
        ], 202);
    }
}
