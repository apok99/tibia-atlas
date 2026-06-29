<?php

namespace App\Console\Commands;

use App\Enums\EntryType;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;

/**
 * Bulk-imports creatures from a TibiaWiki category as draft entries.
 * Polite by default: a delay between requests and resumable (skips existing).
 *
 *   php artisan tibia:scrape-creatures --limit=25
 *   php artisan tibia:scrape-creatures --category=Demons --limit=0   (0 = all)
 */
class ScrapeCreatures extends Command
{
    protected $signature = 'tibia:scrape-creatures
        {--category= : Enumerate a TibiaWiki category instead of the creature infobox}
        {--limit=25 : Max pages to import (0 = no cap)}
        {--sleep=400 : Delay between requests in milliseconds}';

    protected $description = 'Scrape creatures from TibiaWiki into draft entries';

    public function handle(TibiaWikiImporter $importer): int
    {
        $category = (string) $this->option('category');
        $limit = (int) $this->option('limit');
        $sleepMs = (int) $this->option('sleep');

        // Category mode keeps the explicit per-title loop (with progress + delay).
        if ($category !== '') {
            $titles = $importer->listCategory($category, $limit > 0 ? $limit : 5000);
            $this->info(count($titles)." pages in Category:{$category}. Importing as drafts…");

            $imported = $skipped = $failed = 0;
            $bar = $this->output->createProgressBar(count($titles));
            foreach ($titles as $title) {
                $run = $importer->import($title, EntryType::Creature, null, strict: true);
                match ($run->status) {
                    'success' => $imported++,
                    'skipped' => $skipped++,
                    default => $failed++,
                };
                $bar->advance();
                if ($sleepMs > 0) {
                    usleep($sleepMs * 1000);
                }
            }
            $bar->finish();
            $this->newLine(2);
        } else {
            $this->info('Scraping creatures via {{Infobox Creature}} transclusions…');
            ['imported' => $imported, 'skipped' => $skipped, 'failed' => $failed] =
                $importer->scrapeCreatures($limit);
        }

        $this->info("Done. Imported: {$imported}, skipped: {$skipped}, failed: {$failed}.");
        $this->comment('All imports are drafts — review and publish them when ready.');

        return self::SUCCESS;
    }
}
