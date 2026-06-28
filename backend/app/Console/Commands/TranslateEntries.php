<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Services\Import\BookTranslator;
use Illuminate\Console\Command;

/**
 * Machine-translates entry lore (overview + canon) to Spanish for entries that
 * have English content but no Spanish yet — e.g. the concept stubs just filled
 * from TibiaWiki. Creatures are excluded (handled separately / huge). Names are
 * kept as-is (proper nouns). Idempotent; re-runnable.
 *
 *   php artisan tibia:translate-entries
 *   php artisan tibia:translate-entries --limit=50
 */
class TranslateEntries extends Command
{
    protected $signature = 'tibia:translate-entries
        {--limit=0 : Max entries (0 = all)}
        {--sleep=120 : Delay between entries in milliseconds}
        {--with-creatures : Include creatures too}';

    protected $description = 'Translate entry lore to Spanish (filled stubs etc.)';

    public function handle(BookTranslator $tr): int
    {
        $limit = (int) $this->option('limit');
        $sleep = (int) $this->option('sleep');

        $targets = Entry::with('translations')
            ->when(! $this->option('with-creatures'), fn ($q) => $q->where('type', '!=', 'creature'))
            ->get()
            ->filter(function (Entry $e) {
                $en = $e->translation('en');
                $es = $e->translations->firstWhere('locale', 'es');

                // EN has lore, ES has none yet.
                return ($en?->overview || $en?->canon) && ! ($es?->overview) && ! ($es?->canon);
            })
            ->values();

        if ($limit > 0) {
            $targets = $targets->take($limit);
        }

        $this->info('Translating '.$targets->count().' entries to Spanish…');
        $done = $failed = 0;

        foreach ($targets as $i => $e) {
            $en = $e->translation('en');
            try {
                $overview = $en->overview ? $tr->translate($en->overview) : null;
                $canon = $en->canon ? $tr->translate($en->canon) : null;
                $esName = $e->translations->firstWhere('locale', 'es')?->name ?? $en->name;

                $e->translations()->updateOrCreate(
                    ['locale' => 'es'],
                    ['name' => $esName, 'overview' => $overview, 'canon' => $canon],
                );
                $done++;
            } catch (\Throwable $ex) {
                $failed++;
            }

            if (($i + 1) % 25 === 0) {
                $this->line("  {$done} done · {$failed} failed / ".$targets->count());
            }
            if ($sleep > 0) {
                usleep($sleep * 1000);
            }
        }

        $this->newLine();
        $this->info("Done. Translated {$done}, failed {$failed}.");

        return self::SUCCESS;
    }
}
