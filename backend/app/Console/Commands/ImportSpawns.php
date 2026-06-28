<?php

namespace App\Console\Commands;

use App\Models\Entry;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use XMLReader;

/**
 * Imports creature spawn coordinates from the OpenTibiaBR (Canary) world spawn
 * file and stores them per creature in `meta.spawns` (absolute game x/y/z), so
 * the frontend can plot hunting spots on the interactive map.
 *
 *   php artisan tibia:import-spawns
 */
class ImportSpawns extends Command
{
    protected $signature = 'tibia:import-spawns {--cap=1200 : Max spawn points stored per creature}';

    protected $description = 'Import creature spawn coordinates (x/y/z) for the map';

    private const SOURCE = 'https://raw.githubusercontent.com/opentibiabr/canary/main/data-otservbr-global/world/otservbr-monster.xml';

    public function handle(): int
    {
        $path = storage_path('app/spawns.xml');

        if (! is_file($path) || filesize($path) < 1_000_000) {
            $this->info('Downloading spawn data (~9 MB)…');
            $body = Http::timeout(120)->withHeaders(['User-Agent' => 'TibiaAtlas/1.0'])->get(self::SOURCE)->throw()->body();
            file_put_contents($path, $body);
        }

        $this->info('Parsing spawns…');
        $byName = $this->parse($path);
        $this->info(count($byName).' distinct creatures found in spawn data.');

        // Map lowercased English entry name -> entry.
        $entries = Entry::where('type', 'creature')
            ->with(['translations' => fn ($q) => $q->where('locale', 'en')])
            ->get()
            ->keyBy(fn (Entry $e) => mb_strtolower((string) $e->translations->first()?->name));

        $cap = (int) $this->option('cap');
        $updated = 0;

        foreach ($byName as $name => $coords) {
            $entry = $entries->get(mb_strtolower($name));
            if (! $entry) {
                continue;
            }

            $meta = $entry->meta ?? [];
            $meta['spawn_count'] = count($coords);
            $meta['spawns'] = array_slice($coords, 0, $cap);
            $entry->meta = $meta;
            $entry->save();
            $updated++;
        }

        $this->info("Done. Updated {$updated} creatures with spawn coordinates.");

        return self::SUCCESS;
    }

    /**
     * Stream-parse the spawn XML into name => list of [x, y, z] absolute coords.
     *
     * @return array<string, list<array{int,int,int}>>
     */
    private function parse(string $path): array
    {
        $reader = new XMLReader();
        $reader->open($path);

        $byName = [];
        $cx = $cy = 0;

        while (@$reader->read()) {
            if ($reader->nodeType !== XMLReader::ELEMENT || $reader->name !== 'monster') {
                continue;
            }

            $centerx = $reader->getAttribute('centerx');
            if ($centerx !== null) {
                // Outer spawn group: remember its centre.
                $cx = (int) $centerx;
                $cy = (int) $reader->getAttribute('centery');

                continue;
            }

            // Inner monster placement: offset from the current centre; z is absolute.
            $name = $reader->getAttribute('name');
            if ($name === null) {
                continue;
            }
            $x = $cx + (int) $reader->getAttribute('x');
            $y = $cy + (int) $reader->getAttribute('y');
            $z = (int) $reader->getAttribute('z');

            $byName[$name][] = [$x, $y, $z];
        }

        $reader->close();

        return $byName;
    }
}
