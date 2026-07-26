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

    /**
     * Post-parse corrections for regions where the upstream OT world file still
     * carries a pre-revamp roster that no longer matches the real game (verified
     * against in-game route reports + TibiaWiki habitat lists). Every parsed
     * point inside a fix's bbox+floors is taken away from its creature; when
     * `becomes` is non-empty the freed points are redistributed round-robin among
     * the real inhabitants, so their pins land on real walkable cave tiles.
     *
     * Carnivora's Rocks (route reports #13/#14): the caves under northern
     * Tiquanda west of Port Hope kept OT's old Gargoyle/Tarantula/Stone Golem
     * population, but since the 12.00 revamp the area is Carnivora's Rocks
     * (TibiaWiki: Lumbering/Spiky/Menacing Carnivor — and Gargoyle/Tarantula
     * habitat lists confirm neither lives there anymore). The z11 level keeps no
     * replacement roster we can source, so its stale points are just dropped.
     */
    private const REGION_FIXES = [
        [
            'bbox' => [32400, 32550, 32540, 32690], // x1, y1, x2, y2 (absolute)
            'floors' => [8, 9, 10],
            'becomes' => ['Spiky Carnivor', 'Menacing Carnivor', 'Lumbering Carnivor'],
        ],
        [
            'bbox' => [32400, 32550, 32540, 32690],
            'floors' => [11],
            'becomes' => [],
        ],
    ];

    public function handle(): int
    {
        $path = storage_path('app/spawns.xml');

        if (! is_file($path) || filesize($path) < 1_000_000) {
            $this->info('Downloading spawn data (~9 MB)…');
            $body = Http::timeout(120)->withHeaders(['User-Agent' => 'TibiaAtlas/1.0'])->get(self::SOURCE)->throw()->body();
            file_put_contents($path, $body);
        }

        $this->info('Parsing spawns…');
        $byName = $this->applyRegionFixes($this->parse($path));
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
     * Apply REGION_FIXES to the parsed name => coords map (see the const doc).
     *
     * @param  array<string, list<array{int,int,int}>>  $byName
     * @return array<string, list<array{int,int,int}>>
     */
    private function applyRegionFixes(array $byName): array
    {
        foreach (self::REGION_FIXES as $fix) {
            [$x1, $y1, $x2, $y2] = $fix['bbox'];
            $freed = [];

            foreach ($byName as $name => $coords) {
                if (in_array($name, $fix['becomes'], true)) {
                    continue; // already the correct inhabitant — keep its points
                }
                $kept = [];
                foreach ($coords as $c) {
                    $inside = $c[0] >= $x1 && $c[0] <= $x2
                        && $c[1] >= $y1 && $c[1] <= $y2
                        && in_array($c[2], $fix['floors'], true);
                    if ($inside) {
                        $freed[] = $c;
                    } else {
                        $kept[] = $c;
                    }
                }
                $byName[$name] = $kept;
            }

            if ($freed !== [] && $fix['becomes'] !== []) {
                foreach ($freed as $i => $c) {
                    $byName[$fix['becomes'][$i % count($fix['becomes'])]][] = $c;
                }
            }
            $this->line(sprintf(
                '  region fix [%d,%d]-[%d,%d] z%s: %d point(s) %s.',
                $x1, $y1, $x2, $y2, implode('/', $fix['floors']), count($freed),
                $fix['becomes'] === [] ? 'dropped' : 'reassigned to '.implode(', ', $fix['becomes'])
            ));
        }

        return $byName;
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
