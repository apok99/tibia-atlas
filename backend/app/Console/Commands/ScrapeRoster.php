<?php

namespace App\Console\Commands;

use App\Enums\EntryType;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;

/**
 * Fills the creature "skeleton" (database/data/creatures.txt) from TibiaWiki.
 * Each bestiary name is resolved to its canonical article (handling plural →
 * singular) and imported as a draft with real lore + stats. Run once with
 * --limit=0 for the full roster; it skips creatures already imported.
 *
 *   php artisan tibia:scrape-roster --limit=0 --sleep=300
 */
class ScrapeRoster extends Command
{
    protected $signature = 'tibia:scrape-roster
        {--limit=0 : Max NEW creatures to import (0 = whole roster)}
        {--offset=0 : Skip this many roster entries first}
        {--sleep=300 : Delay between requests in milliseconds}';

    protected $description = 'Fill the creature roster (skeleton) from TibiaWiki';

    public function handle(TibiaWikiImporter $importer): int
    {
        $path = database_path('data/creatures.txt');
        if (! is_file($path)) {
            $this->error("Roster file not found: {$path}");

            return self::FAILURE;
        }

        $names = array_values(array_filter(array_map('trim', file($path, FILE_IGNORE_NEW_LINES))));
        $names = array_slice($names, (int) $this->option('offset'));

        $limit = (int) $this->option('limit');
        $sleepMs = (int) $this->option('sleep');

        $this->info(count($names).' creatures in the roster. Filling drafts from TibiaWiki…');
        $bar = $this->output->createProgressBar(count($names));
        $bar->start();

        $imported = $skipped = $failed = 0;
        foreach ($names as $name) {
            if ($limit > 0 && $imported >= $limit) {
                break;
            }

            try {
                $title = $importer->resolveTitle($name);
                if ($title === null) {
                    $skipped++;       // no creature article found for this name
                } else {
                    $run = $importer->import($title, EntryType::Creature, null, strict: true);
                    match ($run->status) {
                        'success' => $imported++,
                        'skipped' => $skipped++,
                        default => $failed++,
                    };
                }
            } catch (\Throwable $e) {
                $failed++;
            }

            $bar->advance();
            if ($sleepMs > 0) {
                usleep($sleepMs * 1000);
            }
        }

        $bar->finish();
        $this->newLine(2);
        $this->info("Done. Imported/filled: {$imported}, skipped: {$skipped}, failed: {$failed}.");
        $this->comment('All imports are drafts — publish from the admin panel when reviewed.');

        return self::SUCCESS;
    }
}
