<?php

namespace App\Console\Commands;

use App\Services\Import\StubFiller;
use Illuminate\Console\Command;

/**
 * Fills empty entries (auto-created concept stubs) with their real lore from
 * TibiaWiki. Idempotent — only entries still lacking overview & canon are
 * touched, so it can be re-run to finish off any that were rate-limited.
 *
 *   php artisan tibia:fill-stubs                 (published empties only)
 *   php artisan tibia:fill-stubs --all           (drafts too)
 *   php artisan tibia:fill-stubs --limit=50
 */
class FillStubs extends Command
{
    protected $signature = 'tibia:fill-stubs
        {--all : Include draft entries, not just published}
        {--limit=0 : Max entries to process (0 = all)}
        {--sleep=120 : Delay between requests in milliseconds}';

    protected $description = 'Fill empty stub entries with lore from TibiaWiki';

    public function handle(StubFiller $filler): int
    {
        $publishedOnly = ! $this->option('all');
        $limit = (int) $this->option('limit');
        $sleep = (int) $this->option('sleep');

        $this->info('Filling empty stubs from TibiaWiki'.($publishedOnly ? ' (published only)…' : ' (incl. drafts)…'));

        $stats = $filler->fillEmpty(
            $publishedOnly,
            $limit,
            $sleep,
            fn (string $line) => $this->line('  '.$line),
        );

        $this->newLine();
        $this->info(sprintf(
            'Done. Filled %d, no-content %d, missing %d, failed %d (of %d).',
            $stats['filled'], $stats['nocontent'], $stats['missing'], $stats['failed'], $stats['total']
        ));

        return self::SUCCESS;
    }
}
