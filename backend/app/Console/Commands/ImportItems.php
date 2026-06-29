<?php

namespace App\Console\Commands;

use App\Services\Import\ItemImporter;
use Illuminate\Console\Command;

/**
 * Bulk-imports TibiaWiki objects ({{Infobox Object}}) as draft `item` entries.
 * Resumable: each run pre-filters already-imported slugs and imports the next
 * --limit new items, so it can be driven in polite batches (e.g. via /loop)
 * until the whole catalogue is in.
 *
 *   php artisan tibia:import-items --limit=80
 *   php artisan tibia:import-items --limit=0   # import everything found
 */
class ImportItems extends Command
{
    protected $signature = 'tibia:import-items
        {--limit=80 : Import this many NEW items then stop (0 = all)}';

    protected $description = 'Import TibiaWiki items/objects as draft item entries (resumable)';

    public function handle(ItemImporter $importer): int
    {
        $limit = (int) $this->option('limit');

        $this->info($limit > 0
            ? "Importing up to {$limit} new item(s)…"
            : 'Importing all remaining items…');

        $result = $importer->scrapeItems($limit, userId: null);

        $this->info("Done. Imported {$result['imported']}, skipped {$result['skipped']}, failed {$result['failed']}.");

        return self::SUCCESS;
    }
}
