<?php

namespace App\Console\Commands;

use App\Models\Entry;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

/**
 * Many bosses (and rare creatures) have no entry in the OpenTibia world spawn
 * file because they are raid/quest spawns. The TibiaMaps community marker set
 * does record their exact tiles, though: descriptions like
 * "<Name> (exact spawn tile)", "(spawn location)" or "Task boss: <Name>".
 *
 * This command pulls those markers and appends the coordinates to the matching
 * creature's `meta.spawns`, so the map (and its "Bosses" filter) can plot them.
 *
 *   php artisan tibia:import-marker-spawns
 */
class ImportMarkerSpawns extends Command
{
    protected $signature = 'tibia:import-marker-spawns';

    protected $description = 'Import boss/rare spawn tiles from TibiaMaps markers';

    private const SOURCE = 'https://raw.githubusercontent.com/tibiamaps/tibia-map-data/master/data/markers.json';

    public function handle(): int
    {
        $path = storage_path('app/markers.json');

        if (! is_file($path) || filesize($path) < 100_000) {
            $this->info('Downloading TibiaMaps markers (~600 KB)…');
            $body = Http::timeout(120)->withHeaders(['User-Agent' => 'TibiaAtlas/1.0'])->get(self::SOURCE)->throw()->body();
            file_put_contents($path, $body);
        }

        /** @var array<int, array{description?:string,icon?:string,x?:int,y?:int,z?:int}> $markers */
        $markers = json_decode((string) file_get_contents($path), true) ?: [];

        // name (lowercase) => list of [x, y, z]
        $byName = [];
        foreach ($markers as $mk) {
            $desc = trim((string) ($mk['description'] ?? ''));
            if ($desc === '') {
                continue;
            }

            // Name is whatever precedes a parenthetical that mentions a spawn
            // (covers "exact spawn tile", "spawn location", "approximate spawn
            // location", "spawn location N minutes after…"), a "(pirate raid
            // boss)", or "(check surroundings of this mark)". Also "Task boss: X".
            $name = null;
            if (preg_match('/^(.+?)\s*\(([^)]*)\)/', $desc, $m)
                && preg_match('/spawn|raid boss|check surroundings/i', $m[2])) {
                $name = trim($m[1]);
            } elseif (preg_match('/^task boss:\s*(.+)$/i', $desc, $m)) {
                $name = trim($m[1]);
            }
            if ($name === null || $name === '') {
                continue;
            }

            $byName[mb_strtolower($name)][] = [(int) $mk['x'], (int) $mk['y'], (int) $mk['z']];
        }

        $this->info(count($byName).' named spawn markers found.');

        // Map lowercased English entry name -> creature entry.
        $entries = Entry::where('type', 'creature')
            ->with(['translations' => fn ($q) => $q->where('locale', 'en')])
            ->get()
            ->keyBy(fn (Entry $e) => mb_strtolower((string) $e->translations->first()?->name));

        $updated = 0;
        $added = 0;

        foreach ($byName as $name => $coords) {
            $entry = $entries->get($name);
            if (! $entry) {
                continue;
            }

            $meta = $entry->meta ?? [];
            $spawns = $meta['spawns'] ?? [];

            // Dedupe against existing spawns.
            $seen = [];
            foreach ($spawns as $s) {
                $seen[$s[0].','.$s[1].','.$s[2]] = true;
            }

            $changed = false;
            foreach ($coords as $c) {
                $key = $c[0].','.$c[1].','.$c[2];
                if (! isset($seen[$key])) {
                    $spawns[] = $c;
                    $seen[$key] = true;
                    $changed = true;
                    $added++;
                }
            }

            if ($changed) {
                $meta['spawns'] = $spawns;
                $meta['spawn_count'] = count($spawns);
                $entry->meta = $meta;
                $entry->save();
                $updated++;
            }
        }

        // --- Second pass: fill bosses STILL lacking a spawn by finding their
        // name mentioned in any marker (raid bosses are often marked without a
        // "(spawn)" suffix, e.g. "Orshabaal and Morshabaal"). Skip navigation
        // markers so we don't drop them on a teleport/sign.
        $bossFilled = 0;
        $bosses = Entry::where('type', 'creature')
            ->where('meta->rank', 'Boss')
            ->with(['translations' => fn ($q) => $q->where('locale', 'en')])
            ->get()
            ->filter(fn (Entry $e) => empty($e->meta['spawns']));

        foreach ($bosses as $entry) {
            $name = (string) $entry->translations->first()?->name;
            if ($name === '') {
                continue;
            }
            $nameRe = '/\b'.preg_quote($name, '/').'\b/i';

            $best = null;       // [x,y,z] preferring a spawn/location/lair marker
            $fallback = null;
            foreach ($markers as $mk) {
                $desc = trim((string) ($mk['description'] ?? ''));
                if ($desc === '' || ! preg_match($nameRe, $desc)) {
                    continue;
                }
                if (preg_match('/\b(towards?|teleport|portal|way to|exit|entrance|doll|statue|book|lever|painting|shortcut)\b/i', $desc)) {
                    continue;
                }
                $coord = [(int) $mk['x'], (int) $mk['y'], (int) $mk['z']];
                if (preg_match('/spawn|location|lair|boss/i', $desc)) {
                    $best = $coord;
                    break;
                }
                $fallback ??= $coord;
            }

            $coord = $best ?? $fallback;
            if ($coord === null) {
                continue;
            }

            $meta = $entry->meta ?? [];
            $meta['spawns'] = [$coord];
            $meta['spawn_count'] = 1;
            $entry->meta = $meta;
            $entry->save();
            $bossFilled++;
        }

        $this->info("Done. Added {$added} spawn points across {$updated} creatures; filled {$bossFilled} more bosses by name match.");

        return self::SUCCESS;
    }
}
