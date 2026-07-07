<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;
use Illuminate\Support\Str;
use Throwable;

/**
 * Backfills the textual spawn locations ("where it is found") for creatures from
 * the TibiaWiki {{Infobox Creature}} `location` field, storing the cleaned prose
 * in `meta.location` so the creature page can name where the monster appears
 * (next to the "Open map" button). The interactive map plots the coordinates;
 * this gives the human-readable place names ("Plains of Havoc, Hellgate, …").
 *
 *   php artisan tibia:import-locations
 *   php artisan tibia:import-locations --refresh --sleep=150
 */
class ImportLocations extends Command
{
    protected $signature = 'tibia:import-locations
        {--refresh : Re-fetch even creatures that already have meta.location}
        {--limit=0 : Stop after this many creatures (0 = all)}
        {--sleep=120 : Pause in ms between wiki requests (be polite)}';

    protected $description = 'Backfill creature spawn-location names (meta.location) from TibiaWiki';

    public function handle(TibiaWikiImporter $importer): int
    {
        $refresh = (bool) $this->option('refresh');
        $limit = (int) $this->option('limit');
        $sleep = max(0, (int) $this->option('sleep')) * 1000; // ms → µs

        $query = Entry::where('type', 'creature')
            ->with(['translations' => fn ($q) => $q->where('locale', 'en')]);
        if (! $refresh) {
            $query->whereNull('meta->location');
        }
        $creatures = $query->get();

        $this->info($creatures->count().' creature(s) to process.');

        $updated = $skipped = $failed = 0;

        foreach ($creatures as $entry) {
            if ($limit > 0 && $updated >= $limit) {
                break;
            }

            $name = $entry->translations->first()?->name;
            if (! $name) {
                $skipped++;

                continue;
            }

            try {
                $location = $this->resolveLocation($importer, $name);

                if ($location === null) {
                    $skipped++;

                    continue;
                }

                $meta = $entry->meta ?? [];
                $meta['location'] = $location;
                $entry->meta = $meta;
                $entry->save();
                $updated++;
                $this->line("  <info>✓</info> {$entry->slug}: ".Str::limit($location, 70));
            } catch (Throwable $e) {
                $failed++;
                $this->line("  <error>✗</error> {$entry->slug}: {$e->getMessage()}");
            }

            if ($sleep > 0) {
                usleep($sleep);
            }
        }

        $this->info("Done. Updated {$updated}, skipped {$skipped} (no location), failed {$failed}.");

        return self::SUCCESS;
    }

    /**
     * Fetch the cleaned `location` prose for a creature. Tries the stored name as
     * the page title first; if that page has no creature infobox (e.g. the name
     * is a plural/class page), resolves to the canonical singular article.
     */
    private function resolveLocation(TibiaWikiImporter $importer, string $name): ?string
    {
        $data = $importer->fetchCreatureData($name);

        if ($data['params'] === []) {
            $title = $importer->resolveTitle($name);
            if ($title !== null && $title !== $name) {
                $data = $importer->fetchCreatureData($title);
            }
        }

        $location = $data['location'] ?: null;

        return $location !== null ? ($this->tidyLocation($location) ?: null) : null;
    }

    /**
     * Final clean-up of the location prose for display: multi-line {{Mapper
     * Coords}} blocks get captured only up to the first line, leaving a dangling
     * "({{Mapper Coords|…" fragment — drop it (and its opening paren). Also remove
     * empty parentheticals left after template/link stripping and tidy spacing.
     */
    private function tidyLocation(string $s): string
    {
        $s = preg_replace('/\s*\(?\s*\{\{.*$/s', '', $s) ?? $s;   // dangling template
        $s = preg_replace('/\(\s*\)/', '', $s) ?? $s;            // empty parens
        $s = preg_replace('/\s{2,}/', ' ', $s) ?? $s;
        $s = preg_replace('/\s+([,.;])/', '$1', $s) ?? $s;
        $s = preg_replace('/,\s*,/', ',', $s) ?? $s;

        return trim($s, " \t\n,;");
    }
}
