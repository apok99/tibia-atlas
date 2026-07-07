<?php

namespace App\Console\Commands;

use App\Models\Entry;
use Illuminate\Console\Command;

/**
 * Many bosses appear neither in the OpenTibia world spawn file (they are raid,
 * quest or instanced spawns) nor in the TibiaMaps community marker set, so the
 * automatic importers ({@see ImportSpawns}, {@see ImportMarkerSpawns}) leave
 * them with no `meta.spawns` and they never show on the map's "Bosses" filter.
 *
 * This command applies a hand-curated coordinate table
 * (database/data/boss_locations.json, slug => {x,y,z,src}) to exactly those
 * bosses. It is idempotent and only fills bosses whose spawn list is still
 * empty, so the automatic importers always win where they have data.
 *
 *   php artisan tibia:import-boss-locations
 *   php artisan tibia:import-boss-locations --force   # overwrite existing spawns too
 *   php artisan tibia:import-boss-locations --dry-run  # report only
 */
class ImportBossLocations extends Command
{
    protected $signature = 'tibia:import-boss-locations {--force : Overwrite spawns even if the boss already has some} {--dry-run : Report what would change without saving}';

    protected $description = 'Apply curated spawn tiles to bosses missing map locations';

    // Bounds of the exported minimap region (mirror of the frontend MapPage).
    private const X_MIN = 31744;

    private const X_MAX = 34304; // exclusive

    private const Y_MIN = 30976;

    private const Y_MAX = 33024; // exclusive

    private const TILE = 256;

    public function handle(): int
    {
        $path = database_path('data/boss_locations.json');
        if (! is_file($path)) {
            $this->error("Missing data file: {$path}");

            return self::FAILURE;
        }

        /** @var array<string, mixed> $data */
        $data = json_decode((string) file_get_contents($path), true) ?: [];
        $force = (bool) $this->option('force');
        $dry = (bool) $this->option('dry-run');
        $tileDir = base_path('../frontend/public/minimap');

        $applied = 0;
        $skipped = 0;
        $missing = 0;
        $offMap = 0;

        foreach ($data as $slug => $loc) {
            if (str_starts_with((string) $slug, '_')) {
                continue; // comment keys
            }
            if (! is_array($loc) || ! isset($loc['x'], $loc['y'], $loc['z'])) {
                $this->warn("  {$slug}: malformed entry, skipped");

                continue;
            }

            $x = (int) $loc['x'];
            $y = (int) $loc['y'];
            $z = (int) $loc['z'];

            // Reject coordinates outside the exported region or without a tile —
            // they would be invisible on the map and signal a bad lookup.
            if ($x < self::X_MIN || $x >= self::X_MAX || $y < self::Y_MIN || $y >= self::Y_MAX) {
                $this->warn("  {$slug}: [{$x},{$y},{$z}] is outside the mapped region — fix the coordinate");
                $offMap++;

                continue;
            }
            $tile = sprintf('%s/Minimap_Color_%d_%d_%d.png', $tileDir, intdiv($x, self::TILE) * self::TILE, intdiv($y, self::TILE) * self::TILE, $z);
            if (! is_file($tile)) {
                $this->warn("  {$slug}: no minimap tile for [{$x},{$y},{$z}] (floor {$z}) — fix the coordinate");
                $offMap++;

                continue;
            }

            $entry = Entry::where('type', 'creature')->where('slug', $slug)->first();
            if (! $entry) {
                $this->warn("  {$slug}: no such creature entry");
                $missing++;

                continue;
            }

            $meta = $entry->meta ?? [];
            $existing = $meta['spawns'] ?? [];
            if (! empty($existing) && ! $force) {
                $skipped++;

                continue;
            }

            $meta['spawns'] = [[$x, $y, $z]];
            $meta['spawn_count'] = 1;
            $meta['spawn_source'] = 'curated';

            if (! $dry) {
                $entry->meta = $meta;
                $entry->save();
            }
            $applied++;
            $this->line("  <info>✓</info> {$slug} -> [{$x},{$y},{$z}] z{$z}");
        }

        $verb = $dry ? 'Would apply' : 'Applied';
        $this->info("{$verb} {$applied} boss locations; {$skipped} already had spawns; {$missing} unknown slugs; {$offMap} off-map/bad coords.");

        return self::SUCCESS;
    }
}
