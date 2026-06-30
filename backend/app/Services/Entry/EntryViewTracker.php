<?php

namespace App\Services\Entry;

use App\Jobs\RecordEntryView;
use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Counts one view of an entry, deduplicated per visitor. A visitor (a hash of
 * IP + user agent, so no raw PII is stored) only counts once within the dedup
 * window — keeps reloads from inflating popularity figures. The durable write
 * happens off the request path via {@see RecordEntryView}.
 */
class EntryViewTracker
{
    /** A visitor's repeat views of the same entry within this window count once. */
    private const DEDUP_HOURS = 6;

    public function record(Request $request, Entry $entry): void
    {
        $visitor = hash('sha256', ($request->ip() ?? '').'|'.($request->userAgent() ?? ''));

        // Atomic dedup in the cache: Cache::add only succeeds the first time the
        // key is set, so a repeat view within the window is a single cache op and
        // never touches the database — no SELECT on the hot path.
        $isFreshView = Cache::add(
            "view:{$entry->id}:{$visitor}",
            1,
            now()->addHours(self::DEDUP_HOURS),
        );

        if (! $isFreshView) {
            return;
        }

        // Persist off the request path (queued in production).
        RecordEntryView::dispatch($entry->id, $visitor);
    }
}
