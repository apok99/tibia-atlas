<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Support\BossRule;
use Illuminate\Console\Command;
use Symfony\Component\Finder\Finder;

/**
 * Most bosses never appear in the OT world spawn file (they are summoned by
 * lever/portal/raid scripts), so tibia:import-spawns leaves them with no map
 * point and the map shows "0/0" spawn areas. This command harvests their real
 * coordinates from the OT data tree itself:
 *
 *  - world/ spawn XMLs (quest, annual_events, world_changes, custom) — the
 *    centerx/centery + offset format, exact tiles;
 *  - raids/ XMLs — <singlespawn x y z> and <areaspawn> (centre of the area);
 *  - scripts/ luas — BossLever configs (boss = { name, position }), bossName +
 *    bossPosition pairs, createMonster("X", Position(...)), and the Raid lib
 *    (Zone:addArea centre + addSpawnMonsters names);
 *  - loose fallback (bosses only): a quoted boss name followed by the next
 *    Position(...) in the same script — encounter scripts almost always place
 *    the boss right where the fight happens.
 *
 * Only creatures whose meta.spawns is EMPTY are touched, so the exact world
 * spawn data and the curated boss locations always win.
 *
 *   php artisan tibia:import-ot-boss-spawns {--ot=path/to/data-otservbr-global}
 */
class ImportOtBossSpawns extends Command
{
    protected $signature = 'tibia:import-ot-boss-spawns
        {--ot= : Path to the OT data dir (data-otservbr-global)}
        {--dry : Report matches without saving}';

    protected $description = 'Fill boss spawn coordinates from OT quest/raid scripts for the map';

    /** Coordinates outside the real game map are script artefacts (test rooms etc.). */
    private const X_MIN = 30000, X_MAX = 34500, Y_MIN = 30500, Y_MAX = 33500, Z_MAX = 15;

    /** Max points stored per creature — bosses have a handful of arenas at most. */
    private const CAP = 25;

    /** @var array<string, list<array{int,int,int}>> */
    private array $strict = [];

    /** @var array<string, list<array{int,int,int}>> */
    private array $loose = [];

    public function handle(): int
    {
        $root = $this->resolveRoot();
        if ($root === null) {
            $this->error('OT data dir not found — pass --ot=path/to/data-otservbr-global');

            return self::FAILURE;
        }
        $this->info("Harvesting boss spawns from {$root}…");

        $this->harvestWorldXml($root.'/world');
        $this->harvestRaidXml($root.'/raids');
        $this->harvestLua($root.'/scripts');

        $this->info(count($this->strict).' names (strict) / '.count($this->loose).' names (loose) harvested.');

        // Lowercased EN name -> entry, creatures only.
        $entries = Entry::where('type', 'creature')
            ->with(['translations' => fn ($q) => $q->where('locale', 'en')])
            ->get()
            ->keyBy(fn (Entry $e) => mb_strtolower((string) $e->translations->first()?->name));

        $filled = 0;
        $looseFilled = 0;

        foreach ($entries as $name => $entry) {
            if (! empty($entry->meta['spawns'])) {
                continue; // exact/curated data always wins
            }

            // TibiaWiki disambiguators ("Pythius the Rotten (Creature)") never
            // appear in OT names.
            $key = trim((string) preg_replace('/\s*\([^)]*\)\s*$/', '', $name));

            $coords = $this->strict[$key] ?? null;
            $fromLoose = false;

            if ($coords === null) {
                // The loose heuristic is only trusted for bosses: encounter
                // scripts mention the boss where they spawn it, but a regular
                // creature quoted in some script proves nothing.
                $meta = $entry->meta ?? [];
                $spawnType = is_array($meta['spawn_type'] ?? null)
                    ? implode(',', $meta['spawn_type'])
                    : (string) ($meta['spawn_type'] ?? '');
                if (BossRule::matches($meta['rank'] ?? null, $spawnType)) {
                    $coords = $this->loose[$key] ?? null;
                    $fromLoose = $coords !== null;
                }
            }

            if ($coords === null) {
                continue;
            }

            $coords = array_slice($this->dedupe($coords), 0, self::CAP);

            if ($this->option('dry')) {
                $tag = $fromLoose ? 'loose' : 'strict';
                $this->line("  [{$tag}] {$name} → ".count($coords).' pts ('.implode(',', $coords[0]).')');
            } else {
                $meta = $entry->meta ?? [];
                $meta['spawns'] = $coords;
                $meta['spawn_count'] = count($coords);
                $entry->meta = $meta;
                $entry->save();
            }

            $filled++;
            if ($fromLoose) {
                $looseFilled++;
            }
        }

        $verb = $this->option('dry') ? 'would fill' : 'filled';
        $this->info("Done. {$verb} {$filled} creatures (".($filled - $looseFilled).' strict, '.$looseFilled.' loose).');

        return self::SUCCESS;
    }

    private function resolveRoot(): ?string
    {
        $candidates = array_filter([
            $this->option('ot'),
            base_path('../ot/data-otservbr-global'),
            '/home/ubuntu/ot-data/data-otservbr-global',
        ]);
        foreach ($candidates as $c) {
            if (is_dir($c)) {
                return rtrim($c, '/\\');
            }
        }

        return null;
    }

    private function add(array &$map, string $name, int $x, int $y, int $z): void
    {
        $name = mb_strtolower(trim($name));
        if ($name === ''
            || $x < self::X_MIN || $x > self::X_MAX
            || $y < self::Y_MIN || $y > self::Y_MAX
            || $z < 0 || $z > self::Z_MAX) {
            return;
        }
        $map[$name][] = [$x, $y, $z];
    }

    /** @param list<array{int,int,int}> $coords @return list<array{int,int,int}> */
    private function dedupe(array $coords): array
    {
        $seen = [];
        $out = [];
        foreach ($coords as $c) {
            $k = implode(',', $c);
            if (! isset($seen[$k])) {
                $seen[$k] = true;
                $out[] = $c;
            }
        }

        return $out;
    }

    /** Quest/event spawn XMLs: centerx/centery groups with inner monster offsets. */
    private function harvestWorldXml(string $dir): void
    {
        foreach ($this->files($dir, '*.xml') as $txt) {
            if (! str_contains($txt, '<spawn')) {
                continue;
            }
            $cx = $cy = 0;
            preg_match_all('/<(spawn|monster)\b([^>]*)>/', $txt, $ms, PREG_SET_ORDER);
            foreach ($ms as $m) {
                $a = $this->attrs($m[2]);
                if ($m[1] === 'spawn') {
                    $cx = (int) ($a['centerx'] ?? 0);
                    $cy = (int) ($a['centery'] ?? 0);

                    continue;
                }
                if (isset($a['name'])) {
                    $this->add($this->strict, $a['name'], $cx + (int) ($a['x'] ?? 0), $cy + (int) ($a['y'] ?? 0), (int) ($a['z'] ?? 7));
                }
            }
        }
    }

    /** Raid XMLs: <singlespawn x y z> / <areaspawn from-to> with <monster name> children. */
    private function harvestRaidXml(string $dir): void
    {
        foreach ($this->files($dir, '*.xml') as $txt) {
            preg_match_all(
                '/<(singlespawn|areaspawn)\b([^>]*)>(.*?)<\/\1>|<(?:singlespawn|areaspawn)\b([^>]*)\/>/s',
                $txt,
                $ms,
                PREG_SET_ORDER,
            );
            foreach ($ms as $m) {
                $a = $this->attrs($m[2] ?? ($m[4] ?? ''));
                if ($a === []) {
                    $a = $this->attrs($m[4] ?? '');
                }
                if (isset($a['x'])) {
                    $x = (int) $a['x'];
                    $y = (int) $a['y'];
                    $z = (int) ($a['z'] ?? 7);
                } elseif (isset($a['fromx'])) {
                    $x = (int) round(((int) $a['fromx'] + (int) $a['tox']) / 2);
                    $y = (int) round(((int) $a['fromy'] + (int) $a['toy']) / 2);
                    $z = (int) $a['fromz'];
                } else {
                    continue;
                }

                preg_match_all('/<monster[^>]*\bname="([^"]+)"/', $m[3] ?? '', $names);
                foreach ($names[1] as $n) {
                    $this->add($this->strict, $n, $x, $y, $z);
                }
                if (isset($a['name'])) {
                    $this->add($this->strict, $a['name'], $x, $y, $z);
                }
            }
        }
    }

    /** Lua scripts: lever configs, createMonster calls, Raid lib zones, loose name+Position. */
    private function harvestLua(string $dir): void
    {
        foreach ($this->files($dir, '*.lua') as $txt) {
            // BossLever-style: boss = { name = "X", ... position = Position(x, y, z) }
            preg_match_all('/boss\s*=\s*\{\s*name\s*=\s*"([^"]+)"[^{}]*?position\s*=\s*Position\((\d+),\s*(\d+),\s*(\d+)\)/s', $txt, $ms, PREG_SET_ORDER);
            foreach ($ms as $m) {
                $this->add($this->strict, $m[1], (int) $m[2], (int) $m[3], (int) $m[4]);
            }

            // bossName = "X" … bossPosition = Position(x,y,z) in the same file.
            if (preg_match('/bossName\s*=\s*"([^"]+)"/', $txt, $bn)
                && preg_match('/bossPosition\s*=\s*Position\((\d+),\s*(\d+),\s*(\d+)\)/', $txt, $bp)) {
                $this->add($this->strict, $bn[1], (int) $bp[1], (int) $bp[2], (int) $bp[3]);
            }

            // createMonster / addMonster with inline coords or Position(...).
            preg_match_all('/(?:createMonster|addMonster)\(\s*"([^"]+)"\s*,\s*(?:Position\()?(\d{4,5}),\s*(\d{4,5}),\s*(\d{1,2})\)?/', $txt, $ms, PREG_SET_ORDER);
            foreach ($ms as $m) {
                $this->add($this->strict, $m[1], (int) $m[2], (int) $m[3], (int) $m[4]);
            }

            // Raid lib: Zone:addArea(Position(a), Position(b)) + addSpawnMonsters names.
            if (str_contains($txt, 'addSpawnMonsters')
                && preg_match('/addArea\(\s*Position\((\d+),\s*(\d+),\s*(\d+)\),\s*Position\((\d+),\s*(\d+),\s*(\d+)\)/', $txt, $za)) {
                $cx = (int) round(((int) $za[1] + (int) $za[4]) / 2);
                $cy = (int) round(((int) $za[2] + (int) $za[5]) / 2);
                preg_match_all('/\{\s*name\s*=\s*"([^"]+)"/', $txt, $names);
                foreach ($names[1] as $n) {
                    $this->add($this->strict, $n, $cx, $cy, (int) $za[3]);
                }
            }

            // Loose: a quoted capitalised name followed by the next Position(...)
            // in the same script.
            preg_match_all('/Position\((\d{4,5}),\s*(\d{4,5}),\s*(\d{1,2})\)/', $txt, $pos, PREG_OFFSET_CAPTURE | PREG_SET_ORDER);
            if ($pos === []) {
                continue;
            }
            preg_match_all('/"([A-Z][^"\n]{2,40})"/', $txt, $quoted, PREG_OFFSET_CAPTURE | PREG_SET_ORDER);
            foreach ($quoted as $q) {
                $at = $q[0][1];
                $after = null;
                foreach ($pos as $p) {
                    if ($p[0][1] > $at) {
                        $after = $p;
                        break;
                    }
                }
                $after ??= $pos[count($pos) - 1];
                $this->add($this->loose, $q[1][0], (int) $after[1][0], (int) $after[2][0], (int) $after[3][0]);
            }
        }
    }

    /** @return iterable<string> file contents */
    private function files(string $dir, string $pattern): iterable
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach ((new Finder)->files()->in($dir)->name($pattern) as $file) {
            yield (string) file_get_contents($file->getRealPath());
        }
    }

    /** @return array<string, string> */
    private function attrs(string $raw): array
    {
        preg_match_all('/(\w+)="([^"]*)"/', $raw, $ms, PREG_SET_ORDER);

        return array_combine(array_column($ms, 1), array_column($ms, 2));
    }
}
