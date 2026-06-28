<?php

namespace App\Console\Commands;

use App\Services\Import\BookImporter;
use Illuminate\Console\Command;

/**
 * Imports the readable in-game Tibia books from TibiaWiki (Category:Book Texts)
 * into the `books` library. Idempotent — re-run to refresh.
 *
 *   php artisan tibia:import-books            (all books)
 *   php artisan tibia:import-books --limit=50 (first 50, for a quick test)
 */
class ImportBooks extends Command
{
    protected $signature = 'tibia:import-books
        {--limit=0 : Max books to import (0 = all)}';

    protected $description = 'Import readable in-game Tibia books from TibiaWiki';

    public function handle(BookImporter $importer): int
    {
        $limit = (int) $this->option('limit');

        $this->info('Fetching the Tibia library from TibiaWiki (Category:Book Texts)…');

        $stats = $importer->importAll($limit, fn (string $line) => $this->line('  '.$line));

        $this->newLine();
        $this->info(sprintf(
            'Done. Imported %d, updated %d, skipped %d, failed %d (of %d).',
            $stats['imported'], $stats['updated'], $stats['skipped'], $stats['failed'], $stats['total']
        ));

        return self::SUCCESS;
    }
}
