<?php

namespace App\Console\Commands;

use App\Models\Entry;
use Illuminate\Console\Command;

/**
 * Enriches creature entries with REAL combat data parsed from the OpenTibiaBR
 * monster lua files (the `ot/` clone): per-turn burst damage and expected DPS
 * broken down by element (from `monster.attacks`), armor/defense/mitigation
 * (from `monster.defenses`), the official bestiary difficulty stars, and the
 * quest area the monster belongs to (its folder under `monster/quests/`).
 *
 * This is what lets the Hunt Finder judge danger honestly: TibiaWiki's
 * `max_damage` is missing or bogus for ~35% of huntable creatures — exactly
 * the endgame ones — while the server files carry every attack's actual
 * min/max damage.
 *
 *   php artisan tibia:etl-monster-combat [--path=…] [--dry]
 *
 * Everything lands under `meta.ot` (single namespaced key, so wiki-sourced
 * fields are never clobbered). Also backfills `meta.damage_mods` from
 * `monster.elements` for entries that lack it (mod = 100 - resist percent).
 */
class EtlMonsterCombat extends Command
{
    protected $signature = 'tibia:etl-monster-combat
        {--path= : Monster lua root (defaults to <repo>/ot/data-otservbr-global/monster)}
        {--dry : Parse and report, write nothing}';

    protected $description = 'Enrich creatures with real combat data from the OT server monster luas';

    /** COMBAT_* / CONDITION_* constants → our element vocabulary. */
    private const TYPE_ELEMENTS = [
        'COMBAT_PHYSICALDAMAGE' => 'physical',
        'COMBAT_ENERGYDAMAGE' => 'energy',
        'COMBAT_EARTHDAMAGE' => 'earth',
        'COMBAT_FIREDAMAGE' => 'fire',
        'COMBAT_ICEDAMAGE' => 'ice',
        'COMBAT_HOLYDAMAGE' => 'holy',
        'COMBAT_DEATHDAMAGE' => 'death',
        'COMBAT_LIFEDRAIN' => 'life_drain',
        'COMBAT_DROWNDAMAGE' => 'drown',
        'CONDITION_POISON' => 'earth',
        'CONDITION_FIRE' => 'fire',
        'CONDITION_ENERGY' => 'energy',
        'CONDITION_BLEEDING' => 'physical',
        'CONDITION_DROWN' => 'drown',
    ];

    /** Named monster spells ("death chain", "icicle rain"…) → element by keyword. */
    private const NAME_ELEMENTS = [
        'death' => 'death', 'soul' => 'death', 'mort' => 'death', 'curse' => 'death',
        'energy' => 'energy', 'electrif' => 'energy', 'lightning' => 'energy', 'thunder' => 'energy',
        'fire' => 'fire', 'flame' => 'fire', 'lava' => 'fire', 'inferno' => 'fire',
        'ice' => 'ice', 'frost' => 'ice', 'freez' => 'ice', 'icicle' => 'ice',
        'earth' => 'earth', 'poison' => 'earth', 'terra' => 'earth', 'root' => 'earth',
        'holy' => 'holy', 'divine' => 'holy',
        'drown' => 'drown',
    ];

    /** When two luas declare the same monster, prefer the mainline one. */
    private const DEPRIORITISED_DIRS = ['dawnport', 'nostalgia', 'event_creatures', 'familiars', 'trainers', 'traps', 'svargrond_arena'];

    public function handle(): int
    {
        $root = (string) ($this->option('path') ?: base_path('../ot/data-otservbr-global/monster'));
        if (! is_dir($root)) {
            $this->error("Monster lua root not found: {$root}");

            return self::FAILURE;
        }

        $parsed = [];
        $collisions = 0;
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            if ($file->getExtension() !== 'lua') {
                continue;
            }
            $mon = $this->parseLua((string) $file, $root);
            if ($mon === null) {
                continue;
            }
            $key = mb_strtolower($mon['name']);
            if (isset($parsed[$key])) {
                $collisions++;
                if (! $this->preferOver($mon, $parsed[$key])) {
                    continue;
                }
            }
            $parsed[$key] = $mon;
        }
        $this->info(count($parsed).' monsters parsed ('.$collisions.' name collisions resolved).');

        // Map lowercased English entry name -> entry (same matching as ImportSpawns).
        $entries = Entry::where('type', 'creature')
            ->with(['translations' => fn ($q) => $q->where('locale', 'en')])
            ->get()
            ->keyBy(fn (Entry $e) => mb_strtolower((string) $e->translations->first()?->name));

        $updated = 0;
        $modsBackfilled = 0;
        foreach ($parsed as $key => $mon) {
            $entry = $entries->get($key);
            if (! $entry) {
                continue;
            }

            $meta = $entry->meta ?? [];
            $meta['ot'] = [
                'burst' => $mon['burst'],
                'dps' => $mon['dps'],
                'burst_by_element' => $mon['burst_by_element'],
                'ranged' => $mon['ranged'],
                'armor' => $mon['armor'],
                'defense' => $mon['defense'],
                'mitigation' => $mon['mitigation'],
                'stars' => $mon['stars'],
                'quest_area' => $mon['quest_area'],
                'place' => $mon['place'],
            ];
            if (empty($meta['damage_mods']) && $mon['damage_mods'] !== []) {
                $meta['damage_mods'] = $mon['damage_mods'];
                $modsBackfilled++;
            }

            if (! $this->option('dry')) {
                $entry->meta = $meta;
                $entry->save();
            }
            $updated++;
        }

        $verb = $this->option('dry') ? 'would update' : 'updated';
        $this->info("Done: {$verb} {$updated} creatures (damage_mods backfilled on {$modsBackfilled}).");

        return self::SUCCESS;
    }

    /**
     * Parse one monster lua into the fields we store. Returns null when the
     * file doesn't declare a monster (libs, helpers).
     *
     * @return ?array<string, mixed>
     */
    private function parseLua(string $path, string $root): ?array
    {
        $src = (string) file_get_contents($path);
        if (! preg_match('/Game\.createMonsterType\(\s*["\']([^"\']+)["\']\s*\)/', $src, $m)) {
            return null;
        }
        $name = $m[1];

        $burstByEl = [];
        $dps = 0.0;
        $ranged = false;
        foreach ($this->tableEntries($this->block($src, 'monster.attacks')) as $entry) {
            $kv = $this->pairs($entry);
            [$min, $max] = $this->attackDamage($kv);
            if ($max <= 0) {
                continue;
            }
            $el = $this->attackElement($kv);
            if ($el === null) {
                continue;
            }
            $ranged = $ranged || $this->attackIsRanged($kv);
            $burstByEl[$el] = ($burstByEl[$el] ?? 0) + $max;
            $chance = min(100, (int) ($kv['chance'] ?? 100));
            $interval = max(1000, (int) ($kv['interval'] ?? 2000));
            $dps += ($chance / 100) * (($min + $max) / 2) / ($interval / 1000);
        }
        arsort($burstByEl);

        $defenses = $this->pairs($this->block($src, 'monster.defenses'));

        $mods = [];
        foreach ($this->tableEntries($this->block($src, 'monster.elements')) as $entry) {
            $kv = $this->pairs($entry);
            $el = self::TYPE_ELEMENTS[$kv['type'] ?? ''] ?? null;
            if ($el !== null && isset($kv['percent'])) {
                $mods[$el] = 100 - (int) $kv['percent'];
            }
        }

        $rel = str_replace('\\', '/', substr($path, strlen($root)));

        return [
            'name' => $name,
            'path' => $rel,
            'burst' => (int) round(array_sum($burstByEl)),
            'dps' => round($dps, 1),
            'burst_by_element' => array_map(fn ($v) => (int) round($v), $burstByEl),
            'ranged' => $ranged,
            'armor' => (int) ($defenses['armor'] ?? 0),
            'defense' => (int) ($defenses['defense'] ?? 0),
            'mitigation' => (float) ($defenses['mitigation'] ?? 0),
            'stars' => preg_match('/Stars\s*=\s*(\d+)/', $src, $s) ? (int) $s[1] : null,
            'quest_area' => preg_match('#/quests/([^/]+)/#', $rel, $q) ? $q[1] : null,
            'place' => $this->place($src),
            'damage_mods' => $mods,
            'health' => preg_match('/monster\.health\s*=\s*(\d+)/', $src, $h) ? (int) $h[1] : 0,
        ];
    }

    /**
     * The creature's home place per the bestiary `Locations` field — the first
     * comma-separated segment ("Iksupan", "Court of Winter"). Null when absent
     * or too wordy to be a place name (some entries are full sentences).
     */
    private function place(string $src): ?string
    {
        if (! preg_match('/Locations\s*=\s*"([^"]*)"/', $src, $m)) {
            return null;
        }
        $first = trim(explode(',', $m[1])[0], ' .');
        $len = mb_strlen($first);

        return ($len >= 3 && $len <= 35) ? $first : null;
    }

    /** Extract the balanced `{ … }` body of `monster.<key> = { … }`, or '' if absent. */
    private function block(string $src, string $key): string
    {
        $pos = strpos($src, $key.' = {');
        if ($pos === false) {
            return '';
        }
        $start = $pos + strlen($key.' = {');
        $depth = 1;
        for ($i = $start, $n = strlen($src); $i < $n; $i++) {
            $ch = $src[$i];
            if ($ch === '{') {
                $depth++;
            } elseif ($ch === '}' && --$depth === 0) {
                return substr($src, $start, $i - $start);
            }
        }

        return '';
    }

    /**
     * Split a lua table body into its depth-1 `{ … }` sub-tables (one per
     * attack/element entry). Nested tables (inline conditions) stay inside
     * their parent entry.
     *
     * @return list<string>
     */
    private function tableEntries(string $body): array
    {
        $out = [];
        $depth = 0;
        $start = -1;
        for ($i = 0, $n = strlen($body); $i < $n; $i++) {
            $ch = $body[$i];
            if ($ch === '{') {
                if ($depth === 0) {
                    $start = $i + 1;
                }
                $depth++;
            } elseif ($ch === '}') {
                $depth--;
                if ($depth === 0 && $start >= 0) {
                    $out[] = substr($body, $start, $i - $start);
                    $start = -1;
                }
            }
        }

        return $out;
    }

    /**
     * key = value pairs of a lua table body (scalars only — nested tables are
     * skipped, so an inline `condition = { … }` never shadows the entry's own
     * keys). Values keep quotes stripped.
     *
     * @return array<string, string>
     */
    private function pairs(string $body): array
    {
        // Blank out nested tables so their keys don't leak into the parent.
        $flat = '';
        $depth = 0;
        for ($i = 0, $n = strlen($body); $i < $n; $i++) {
            $ch = $body[$i];
            if ($ch === '{') {
                $depth++;

                continue;
            }
            if ($ch === '}') {
                $depth--;

                continue;
            }
            $flat .= $depth === 0 ? $ch : ' ';
        }

        $kv = [];
        foreach (preg_split('/,(?=(?:[^"]*"[^"]*")*[^"]*$)/', $flat) ?: [] as $chunk) {
            if (preg_match('/^\s*(\w+)\s*=\s*(.+?)\s*$/s', $chunk, $m)) {
                $kv[$m[1]] = trim($m[2], '"\' ');
            }
        }

        return $kv;
    }

    /**
     * An attack's [min, max] damage as positive numbers. Old-style melee
     * declares `skill` + `attack` instead of min/max — approximate its max hit
     * with the standard OT melee formula (skill·attack·0.05).
     *
     * @param  array<string, string>  $kv
     * @return array{0: float, 1: float}
     */
    private function attackDamage(array $kv): array
    {
        $min = abs((float) ($kv['minDamage'] ?? 0));
        $max = abs((float) ($kv['maxDamage'] ?? 0));
        if ($max <= 0 && isset($kv['skill'], $kv['attack'])) {
            $max = (float) $kv['skill'] * (float) $kv['attack'] * 0.05;
            $min = 0.0;
        }

        return [min($min, $max), max($min, $max)];
    }

    /**
     * Whether a damaging attack can hit from afar: a real projectile range
     * (range >= 2) or a beam (length >= 3). A shootEffect with range = 1
     * (demon's energy strike) still requires melee distance, so it doesn't
     * count; self-centered AoEs (radius only) don't either.
     *
     * @param  array<string, string>  $kv
     */
    private function attackIsRanged(array $kv): bool
    {
        return (int) ($kv['range'] ?? 0) >= 2 || (int) ($kv['length'] ?? 0) >= 3;
    }

    /**
     * Which element an attack deals: explicit COMBAT_/CONDITION_ type first,
     * then keywords in named spells, melee → physical. Unknown named spells
     * fall back to 'special' (treated as unresistable by consumers — the safe
     * assumption for danger). Non-damage entries (speed, outfit…) are filtered
     * earlier by their lack of damage.
     *
     * @param  array<string, string>  $kv
     */
    private function attackElement(array $kv): ?string
    {
        $type = $kv['type'] ?? '';
        if ($type === 'COMBAT_MANADRAIN') {
            return null;
        }
        if (isset(self::TYPE_ELEMENTS[$type])) {
            return self::TYPE_ELEMENTS[$type];
        }

        $name = mb_strtolower($kv['name'] ?? '');
        if ($name === 'melee') {
            return 'physical';
        }
        foreach (self::NAME_ELEMENTS as $kw => $el) {
            if (str_contains($name, $kw)) {
                return $el;
            }
        }

        return 'special';
    }

    /** Prefer mainline luas over event/dawnport/… copies; then the beefier one. */
    private function preferOver(array $candidate, array $incumbent): bool
    {
        $depri = fn (array $m) => (bool) preg_match(
            '#/(?:'.implode('|', self::DEPRIORITISED_DIRS).')/#',
            $m['path']
        );
        if ($depri($candidate) !== $depri($incumbent)) {
            return $depri($incumbent);
        }

        return $candidate['health'] > $incumbent['health'];
    }
}
