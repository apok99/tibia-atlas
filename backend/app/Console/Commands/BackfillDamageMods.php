<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;

/**
 * Re-fetches the TibiaWiki *DmgMod infobox fields for existing creatures and
 * backfills `meta.damage_mods` (the raw % each element does to the creature)
 * plus the immune_to / weak_to labels. Surgical: it ONLY rewrites the damage
 * keys and never touches lore, translations, status or images — so it is safe
 * to run over published, hand-edited creatures.
 *
 *   php artisan tibia:backfill-damage --only=demon --dry-run
 *   php artisan tibia:backfill-damage            # all creatures
 *   php artisan tibia:backfill-damage --limit=50 --sleep=400
 */
class BackfillDamageMods extends Command
{
    protected $signature = 'tibia:backfill-damage
        {--limit=0 : Max creatures to process (0 = all)}
        {--sleep=300 : Milliseconds to wait between wiki requests}
        {--only= : Only this creature slug}
        {--dry-run : Show what would change without writing}';

    protected $description = 'Backfill meta.damage_mods (element damage %) from TibiaWiki without touching lore/translations';

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

            $fresh = $data['meta']['damage_mods'] ?? null;
            $meta = $entry->meta ?? [];
            $before = $meta['damage_mods'] ?? null;

            // Write (or clear) the three damage keys; leave everything else alone.
            $this->setOrUnset($meta, 'damage_mods', $fresh);
            $this->setOrUnset($meta, 'immune_to', $data['meta']['immune_to'] ?? null);
            $this->setOrUnset($meta, 'weak_to', $data['meta']['weak_to'] ?? null);

            if (($before ?? []) != ($fresh ?? [])) {
                $updated++;
                $rows[] = [$entry->slug, json_encode($before), json_encode($fresh)];
                if (! $dryRun) {
                    $entry->forceFill(['meta' => $meta])->save();
                }
            }

            $this->wait($sleep);
        }

        if ($rows) {
            $this->newLine();
            $this->table(['slug', 'before', 'after'], array_slice($rows, 0, 60));
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

    /** @param array<string,mixed> $meta */
    private function setOrUnset(array &$meta, string $key, mixed $value): void
    {
        if ($value !== null && $value !== [] && $value !== '') {
            $meta[$key] = $value;
        } else {
            unset($meta[$key]);
        }
    }

    private function wait(int $ms): void
    {
        if ($ms > 0) {
            usleep($ms * 1000);
        }
    }
}
