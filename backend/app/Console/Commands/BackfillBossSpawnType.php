<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;

/**
 * Backfills `meta.spawn_type` (Raid / Unique / Unblockable / Triggered / Regular /
 * Event — TibiaWiki's `spawntype`) on already-imported bosses. This is the field
 * the map's Boss Watch tabs group by. Surgical: it ONLY rewrites the `spawn_type`
 * key and never touches lore, translations, status or images — safe to run over
 * published, hand-edited bosses.
 *
 *   php artisan tibia:backfill-boss-spawntype --only=ferumbras --dry-run
 *   php artisan tibia:backfill-boss-spawntype                 # all bosses
 *   php artisan tibia:backfill-boss-spawntype --missing --sleep=400
 */
class BackfillBossSpawnType extends Command
{
    protected $signature = 'tibia:backfill-boss-spawntype
        {--limit=0 : Max bosses to process (0 = all)}
        {--sleep=300 : Milliseconds to wait between wiki requests}
        {--only= : Only this boss slug}
        {--missing : Only bosses without meta.spawn_type}
        {--dry-run : Show what would change without writing}';

    protected $description = 'Backfill meta.spawn_type (Raid/Unique/Unblockable/…) on bosses from TibiaWiki';

    public function handle(TibiaWikiImporter $importer): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $limit = (int) $this->option('limit');
        $sleep = (int) $this->option('sleep');
        $only = $this->option('only');

        $query = Entry::where('type', 'creature')
            ->whereRaw("meta->>'rank' = 'Boss'")
            ->with('translations');
        if ($only) {
            $query->where('slug', $only);
        }
        if ($this->option('missing')) {
            $query->whereRaw("NOT (meta ?? 'spawn_type')");
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

            $fresh = $data['meta']['spawn_type'] ?? null; // list<string>|null
            $meta = $entry->meta ?? [];
            $before = $meta['spawn_type'] ?? null;        // list<string>|string|null (legacy)

            if ($fresh !== null && $fresh !== []) {
                $meta['spawn_type'] = $fresh;
            } else {
                unset($meta['spawn_type']);
            }

            if ($before !== $fresh) {
                $updated++;
                $rows[] = [$entry->slug, $this->fmt($before), $this->fmt($fresh)];
                if (! $dryRun) {
                    $entry->forceFill(['meta' => $meta])->save();
                }
            }

            $this->wait($sleep);
        }

        if ($rows) {
            $this->newLine();
            $this->table(['slug', 'before', 'after'], array_slice($rows, 0, 80));
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

    /** Render a spawn_type value (list, legacy string, or null) for the diff table. */
    private function fmt(mixed $v): string
    {
        if (is_array($v)) {
            return $v === [] ? '—' : implode(', ', $v);
        }

        return ($v === null || $v === '') ? '—' : (string) $v;
    }

    private function wait(int $ms): void
    {
        if ($ms > 0) {
            usleep($ms * 1000);
        }
    }
}
