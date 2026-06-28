<?php

namespace App\Console\Commands;

use App\Services\Import\BookTranslator;
use Illuminate\Console\Command;

/**
 * Machine-translates the imported Tibia books to Spanish (free Google Translate
 * endpoint). Idempotent — only books without an `es` translation are processed,
 * so it can be re-run to finish off any that failed or were rate-limited.
 *
 *   php artisan tibia:translate-books               (all missing)
 *   php artisan tibia:translate-books --limit=50
 *   php artisan tibia:translate-books --refresh     (re-translate everything)
 */
class TranslateBooks extends Command
{
    protected $signature = 'tibia:translate-books
        {--limit=0 : Max books to translate (0 = all missing)}
        {--sleep=150 : Delay between books in milliseconds}
        {--refresh : Re-translate books that already have a Spanish version}';

    protected $description = 'Translate the Tibia library books to Spanish';

    public function handle(BookTranslator $translator): int
    {
        $limit = (int) $this->option('limit');
        $sleep = (int) $this->option('sleep');
        $refresh = (bool) $this->option('refresh');

        $this->info('Translating books to Spanish (machine translation)…');

        $stats = $translator->translateMissing(
            $limit,
            $sleep,
            $refresh,
            fn (string $line) => $this->line('  '.$line),
        );

        $this->newLine();
        $this->info(sprintf(
            'Done. Translated %d, skipped %d, failed %d (of %d).',
            $stats['translated'], $stats['skipped'], $stats['failed'], $stats['total']
        ));

        return self::SUCCESS;
    }
}
