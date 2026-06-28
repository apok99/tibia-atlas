<?php

namespace App\Jobs;

use App\Services\Import\TibiaWikiImporter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Runs a creature scrape in the background so the admin request returns
 * immediately and the (single-process) dev web server is never blocked by the
 * many slow TibiaWiki API calls.
 */
class ScrapeCreaturesJob implements ShouldQueue
{
    use Queueable;

    /** Generous timeout — a large batch makes hundreds of external calls. */
    public int $timeout = 3600;

    public function __construct(
        public int $limit,
        public ?int $userId = null,
    ) {}

    public function handle(TibiaWikiImporter $importer): void
    {
        // Fill from the curated roster (real creatures), 0 = the whole list.
        $importer->scrapeRoster($this->limit, $this->userId);
    }
}
