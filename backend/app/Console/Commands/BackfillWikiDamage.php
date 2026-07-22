<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;

/**
 * Last-resort damage backfill for creatures no other source covers.
 *
 * Damage on a creature page comes from `meta.ot` (real numbers parsed from the
 * OT server monster luas) and falls back to `meta.max_damage` (TibiaWiki's
 * `maxdmg` infobox field). Recent content — Book World / Inkborn, 2025 — is in
 * neither: it has no lua yet, and the wiki entries were auto-created here from
 * TibiaData, which carries no combat numbers, so their `maxdmg` was never read.
 *
 * This walks exactly those creatures and merges the wiki's damage fields — and
 * nothing else — so a re-run never touches lore, status or translations. Most
 * pages still have `maxdmg` blank; that is the wiki's gap, not ours, and the
 * point of a re-runnable command is to pick the values up as it fills in.
 *
 *   php artisan tibia:backfill-wiki-damage [--dry] [--all]
 */
class BackfillWikiDamage extends Command
{
    protected $signature = 'tibia:backfill-wiki-damage
        {--dry : Report what would change, write nothing}
        {--all : Also revisit creatures that already have a damage figure}';

    protected $description = 'Backfill max_damage/abilities from TibiaWiki for creatures no other source covers';

    public function handle(TibiaWikiImporter $importer): int
    {
        $targets = Entry::where('type', 'creature')
            ->with(['translations' => fn ($q) => $q->where('locale', 'en')])
            ->get()
            ->filter(function (Entry $e) {
                if ($this->option('all')) {
                    return true;
                }

                return empty($e->meta['max_damage']) && empty($e->meta['ot']['burst']);
            });

        $this->info($targets->count().' creatures without a damage figure. Querying TibiaWiki…');

        $filled = 0;
        $blank = 0;
        foreach ($targets as $entry) {
            $name = (string) ($entry->translations->first()?->name ?? '');
            if ($name === '') {
                continue;
            }

            try {
                $wiki = $importer->fetchCreatureData($name)['meta'] ?? [];
            } catch (\Throwable $e) {
                $this->warn("  {$entry->slug}: {$e->getMessage()}");

                continue;
            }

            // Only the combat fields, and only when the wiki actually has them —
            // never overwrite something we already know with a blank.
            $patch = [];
            foreach (['max_damage', 'abilities'] as $key) {
                if (! empty($wiki[$key]) && empty($entry->meta[$key])) {
                    $patch[$key] = $wiki[$key];
                }
            }

            if ($patch === []) {
                $blank++;

                continue;
            }

            $this->line("  {$entry->slug}: ".json_encode(array_map(
                fn ($v) => is_array($v) ? count($v).' abilities' : $v,
                $patch
            )));

            if (! $this->option('dry')) {
                $entry->meta = array_merge($entry->meta ?? [], $patch);
                $entry->save();
            }
            $filled++;
        }

        $verb = $this->option('dry') ? 'would fill' : 'filled';
        $this->info("Done: {$verb} {$filled} creatures; {$blank} have nothing on the wiki either.");

        return self::SUCCESS;
    }
}
