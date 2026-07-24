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

    /**
     * OT spawn name (lowercased) => our EN entry name (lowercased), for creatures
     * whose wiki disambiguation the generic-qualifier strip below can't resolve
     * because the word order or spelling differs from the OT name.
     */
    private const ALIASES = [
        'demon goblin' => 'demon (goblin)',
        'grey horse' => 'horse (grey)',
        'blue butterfly' => 'butterfly (blue)',
        'purple butterfly' => 'butterfly (purple)',
        'red butterfly' => 'butterfly (red)',
        'yellow butterfly' => 'butterfly (yellow)',
        'overcharged energy elemental' => 'overcharged energy element',
        // Anniversary "Nostalgia" creatures (OT calls them "Old X").
        'old wolf' => 'wolf (nostalgia)',
        'old wasp' => 'wasp (nostalgia)',
        'old bug' => 'bug (nostalgia)',
        'old pig' => 'pig (nostalgia)',
        'old spider' => 'spider (nostalgia)',
        'old giant spider' => 'giant spider (nostalgia)',
        'old bear' => 'bear (nostalgia)',
        'old beholder' => 'bonelord (nostalgia)',
        'nomad female' => 'nomad (female)',
        'nomad blue' => 'nomad (blue)',
    ];

    /** Wiki qualifiers that never change the creature's plain name: "X (Creature)" IS "X". */
    private const GENERIC_QUALIFIERS = ['creature', 'basic'];

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

        // Secondary index: plain name of "X (Creature)"/"X (Basic)" entries, so an
        // OT spawn named "Nomad"/"Fish" resolves to our "Nomad (Basic)"/"Fish (Creature)".
        // Colliding bases are dropped (null) so we never guess between two creatures.
        $plain = [];
        foreach ($entries as $key => $entry) {
            if (! preg_match('/^(.*?)\s*\(([^)]+)\)\s*$/', (string) $key, $m)) {
                continue;
            }
            if (! in_array(mb_strtolower(trim($m[2])), self::GENERIC_QUALIFIERS, true)) {
                continue;
            }
            $base = trim($m[1]);
            if ($base === '' || $entries->has($base)) {
                continue; // a real exact entry already owns this name
            }
            $plain[$base] = array_key_exists($base, $plain) ? null : $entry;
        }

        $cap = (int) $this->option('cap');
        $updated = 0;
        $matchedAlias = 0;

        foreach ($byName as $name => $coords) {
            $key = mb_strtolower($name);
            $entry = $entries->get($key)
                ?? $entries->get(self::ALIASES[$key] ?? '@none@')
                ?? ($plain[$key] ?? null);
            if (! $entry) {
                continue;
            }
            if (! $entries->has($key)) {
                $matchedAlias++;
            }

            $meta = $entry->meta ?? [];
            $meta['spawn_count'] = count($coords);
            $meta['spawns'] = array_slice($coords, 0, $cap);
            $entry->meta = $meta;
            $entry->save();
            $updated++;
        }

        $this->info("Done. Updated {$updated} creatures with spawn coordinates ({$matchedAlias} via alias/qualifier match).");

        return self::SUCCESS;
    }

    /**
     * Stream-parse the spawn XML into name => list of [x, y, z] absolute coords.
     *
     * @return array<string, list<array{int,int,int}>>
     */
    private function parse(string $path): array
    {
        $reader = new XMLReader;
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
