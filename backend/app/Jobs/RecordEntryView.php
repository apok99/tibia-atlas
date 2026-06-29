<?php

namespace App\Jobs;

use App\Models\Entry;
use App\Models\EntryView;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;

/**
 * Persists a single (already-deduplicated) entry view off the request path.
 *
 * On a busy site the read endpoint must not pay for two writes per page view.
 * The controller does the cheap atomic dedup; this job — queued in production
 * (Redis), run inline in local dev (sync driver) — does the durable work.
 */
class RecordEntryView implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public int $entryId,
        public string $visitor,
    ) {}

    public function handle(): void
    {
        EntryView::create(['entry_id' => $this->entryId, 'visitor' => $this->visitor]);

        // Bump the all-time counter without touching updated_at — a view is not
        // an editorial change.
        Entry::whereKey($this->entryId)->update(['view_count' => DB::raw('view_count + 1')]);
    }
}
