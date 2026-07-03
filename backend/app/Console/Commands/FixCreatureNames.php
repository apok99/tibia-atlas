<?php

namespace App\Console\Commands;

use App\Models\Entry;
use Illuminate\Console\Command;

/**
 * Forces every creature's Spanish (es) translation name to match its English
 * (en) name. Tibia creature/boss names are proper nouns and must NEVER be shown
 * translated (e.g. "Hydra" not "Hidra", "Jellyfish" not "Medusa"); only the
 * article BODY stays in Spanish. Run this whenever an import or manual edit
 * re-introduces translated creature names.
 *
 *   php artisan tibia:fix-creature-names
 *   php artisan tibia:fix-creature-names --dry-run
 */
class FixCreatureNames extends Command
{
    protected $signature = 'tibia:fix-creature-names {--dry-run : List what would change without writing}';

    protected $description = 'Force every creature ES name to equal its EN name (names are always English)';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $entries = Entry::where('type', 'creature')
            ->with('translations')
            ->get();

        $changed = [];

        foreach ($entries as $entry) {
            $en = $entry->translations->firstWhere('locale', 'en');
            $es = $entry->translations->firstWhere('locale', 'es');

            if (! $en || ! $es || $en->name === null) {
                continue;
            }

            if ($es->name !== $en->name) {
                $changed[] = [$entry->slug, $es->name, $en->name];

                if (! $dryRun) {
                    $es->forceFill(['name' => $en->name])->save();
                }
            }
        }

        if (empty($changed)) {
            $this->info('All creature names already match English. Nothing to do.');

            return self::SUCCESS;
        }

        $this->table(['slug', 'es (was)', 'en (now)'], $changed);
        $this->info(($dryRun ? 'Would update ' : 'Updated ').count($changed).' creature name(s).');

        return self::SUCCESS;
    }
}
