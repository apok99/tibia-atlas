<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;

/**
 * Re-fetches the TibiaWiki {{Ability List}} for existing creatures and backfills
 * `meta.abilities` (the melee/spells/self-healing/summons a creature attacks
 * with). Surgical: it ONLY rewrites the `abilities` key and never touches lore,
 * translations, status or images — safe to run over published, hand-edited
 * creatures.
 *
 *   php artisan tibia:backfill-abilities --only=dragon --dry-run
 *   php artisan tibia:backfill-abilities              # all creatures
 *   php artisan tibia:backfill-abilities --missing --sleep=400
 */
class BackfillAbilities extends Command
{
    protected $signature = 'tibia:backfill-abilities
        {--limit=0 : Max creatures to process (0 = all)}
        {--sleep=300 : Milliseconds to wait between wiki requests}
        {--only= : Only this creature slug}
        {--missing : Only creatures without meta.abilities}
        {--dry-run : Show what would change without writing}';

    protected $description = 'Backfill meta.abilities (attacks & abilities) from TibiaWiki without touching lore/translations';

    public function handle(TibiaWikiImporter $importer): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $limit = (int) $this->option('limit');
        $sleep = (int) $this->option('sleep');
        $only = $this->option('only');

        $query = Entry::where('type', 'creature')->with('translations');
        if ($only) {
            $query->where('slug', $only);
        }
        if ($this->option('missing')) {
            $query->whereRaw("NOT (meta ?? 'abilities')");
        }
        $entries = $query->orderBy('id')->get();

        $processed = 0;
        $updated = 0;
        $skipped = 0;
        $rows = [];

        foreach ($entries as $entry) {
            if ($limit > 0 && $processed >= $limit) {
                break;
            }
            $processed++;

            $title = $entry->translations->firstWhere('locale', 'en')?->name ?: $entry->slug;

            $data = $importer->fetchCreatureData($title);
            if ($data['params'] === [] && ($resolved = $importer->resolveTitle($title))) {
                $data = $importer->fetchCreatureData($resolved);
            }

            if ($data['params'] === []) {
                $skipped++;
                $this->line("  <fg=yellow>skip</> {$entry->slug} (no creature infobox)");
                $this->wait($sleep);

                continue;
            }

            $fresh = $data['meta']['abilities'] ?? null;
            $meta = $entry->meta ?? [];
            $before = $meta['abilities'] ?? null;

            if ($fresh !== null && $fresh !== []) {
                $meta['abilities'] = $fresh;
            } else {
                unset($meta['abilities']);
            }

            if (($before ?? []) != ($fresh ?? [])) {
                $updated++;
                $rows[] = [$entry->slug, count($before ?? []), count($fresh ?? [])];
                if (! $dryRun) {
                    $entry->forceFill(['meta' => $meta])->save();
                }
            }

            $this->wait($sleep);
        }

        if ($rows) {
            $this->newLine();
            $this->table(['slug', 'before (#)', 'after (#)'], array_slice($rows, 0, 60));
        }

        $this->info(sprintf(
            '%sProcessed %d · %s %d · skipped %d (no infobox).',
            $dryRun ? '[dry-run] ' : '',
            $processed,
            $dryRun ? 'would update' : 'updated',
            $updated,
            $skipped,
        ));

        return self::SUCCESS;
    }

    private function wait(int $ms): void
    {
        if ($ms > 0) {
            usleep($ms * 1000);
        }
    }
}
