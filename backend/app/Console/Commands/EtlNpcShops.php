<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Models\NpcOffer;
use App\Models\TradeNpc;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Builds the NPC trade directory ("¿dónde compro / vendo este objeto?") from
 * the OT server data: every `{ itemName = …, buy/sell = … }` shop row in the
 * npc luas becomes an `npc_offers` row with the real gold prices, and the
 * world spawn XML pins each merchant to its map tiles. Item names match our
 * entries the same way the other OT ETLs do (lowercased English name, slug
 * fallback); NPC names link to their lore entries when we have them, which is
 * also where the display city comes from.
 *
 * Shop rows are scanned from the WHOLE lua, not just `npcConfig.shop = {…}`:
 * several merchants (Alexander, the postmen…) build their shop from local
 * tables at runtime. Requiring a buy/sell price inside the row keeps travel
 * fares and quest tables out.
 *
 * Both tables are derived data, so the run wipes and rebuilds them (--dry to
 * only report). Re-run after creature/item imports or an OT data update.
 *
 *   php artisan tibia:etl-npc-shops [--ot=…] [--dry]
 */
class EtlNpcShops extends Command
{
    protected $signature = 'tibia:etl-npc-shops
        {--ot= : OT clone root (defaults to <repo>/ot)}
        {--dry : Parse and report, write nothing}';

    protected $description = 'Rebuild the NPC trade directory (shop offers + map spawns) from the OT npc luas';

    // Bounds of the exported minimap region (mirror of ImportBossLocations /
    // the frontend MapPage). Spawns outside are dropped — they'd render off-map.
    private const X_MIN = 31744;

    private const X_MAX = 34304; // exclusive

    private const Y_MIN = 30976;

    private const Y_MAX = 33024; // exclusive

    /** OT-only testing/helper NPCs that don't exist in real Tibia (lowercased). */
    private const SKIP_NPCS = [
        'archery' => true,
        'archery rook' => true,
        'test server' => true,
        'imbuement assistant' => true,
        'rashid of island' => true,
    ];

    public function handle(): int
    {
        $ot = rtrim((string) ($this->option('ot') ?: base_path('../ot')), '/\\');
        $npcDir = $ot.'/data-otservbr-global/npc';
        $spawnXml = $ot.'/data-otservbr-global/world/otservbr-npc.xml';
        if (! is_dir($npcDir) || ! is_file($spawnXml)) {
            $this->error("OT npc data not found under: {$ot}");

            return self::FAILURE;
        }

        $spawns = $this->parseSpawns($spawnXml);
        $this->info(count($spawns).' NPCs with map spawns in the world XML.');

        // lowercased EN item name -> entry id (the same matching every OT ETL uses).
        $items = Entry::ofType('item')
            ->join('entry_translations as t', fn ($j) => $j->on('t.entry_id', 'entries.id')->where('t.locale', 'en'))
            ->pluck('entries.id', 't.name')
            ->mapWithKeys(fn ($id, $name) => [mb_strtolower((string) $name) => (int) $id])
            ->all();

        // lowercased EN npc name -> lore entry (link-through + display city).
        $npcEntries = [];
        Entry::ofType('npc')
            ->with(['translations' => fn ($q) => $q->where('locale', 'en')])
            ->get()
            ->each(function (Entry $e) use (&$npcEntries) {
                $name = $e->translations->first()?->name;
                if ($name !== null) {
                    $npcEntries[mb_strtolower($name)] = $e;
                }
            });

        // Currency item names (npcConfig.currency = <server id>) resolve lazily
        // against items.xml — only a couple of merchants use token currencies.
        $currencyNames = null;

        $merchants = [];       // name -> [entry_id, city, spawns, currency, offers: item_id -> [buy, sell]]
        $unmatched = [];       // OT item name -> times seen (diagnostics)
        $shopless = 0;

        foreach (glob($npcDir.'/*.lua') ?: [] as $file) {
            $src = (string) file_get_contents($file);
            // Canary convention: `local internalNpcName = "Rashid"` fed into
            // Game.createNpcType(internalNpcName); older luas inline the string.
            // Quote types matched separately — names carry apostrophes (Lee'Delle).
            if (! preg_match('/internalNpcName\s*=\s*(?:"([^"]+)"|\'([^\']+)\')/', $src, $m)
                && ! preg_match('/Game\.createNpcType\(\s*(?:"([^"]+)"|\'([^\']+)\')\s*\)/', $src, $m)) {
                continue;
            }
            $name = trim($m[1] !== '' ? $m[1] : ($m[2] ?? ''));
            if ($name === '' || isset(self::SKIP_NPCS[mb_strtolower($name)]) || str_ends_with($file, '_custom.lua')) {
                continue;
            }

            $offers = [];
            // One shop row: { itemName = "abyss hammer", clientId = 7414, sell = 20000 }.
            // `count` (exercise-weapon charges, fluid subtypes) is irrelevant here.
            if (preg_match_all('/\{\s*itemName\s*=\s*"([^"]+)"\s*,([^{}]*?)\}/', $src, $rows, PREG_SET_ORDER)) {
                foreach ($rows as $row) {
                    $itemName = mb_strtolower(trim($row[1]));
                    $buy = preg_match('/\bbuy\s*=\s*(\d+)/', $row[2], $b) ? (int) $b[1] : null;
                    $sell = preg_match('/\bsell\s*=\s*(\d+)/', $row[2], $s) ? (int) $s[1] : null;
                    if ($buy === null && $sell === null) {
                        continue; // travel fare / quest table lookalike
                    }

                    $itemId = $items[$itemName] ?? null;
                    if ($itemId === null) {
                        $unmatched[$itemName] = ($unmatched[$itemName] ?? 0) + 1;

                        continue;
                    }

                    // Duplicate rows (fluid subtypes share one item): keep the
                    // cheapest buy and the best-paying sell.
                    $prev = $offers[$itemId] ?? [null, null];
                    $offers[$itemId] = [
                        $buy === null ? $prev[0] : min($buy, $prev[0] ?? PHP_INT_MAX),
                        $sell === null ? $prev[1] : max($sell, $prev[1] ?? 0),
                    ];
                }
            }

            if ($offers === []) {
                $shopless++;

                continue;
            }

            $currency = null;
            if (preg_match('/npcConfig\.currency\s*=\s*(\d+)/', $src, $c)) {
                $currencyNames ??= $this->itemNamesById($ot.'/data/items/items.xml');
                $currency = $currencyNames[(int) $c[1]] ?? 'special currency';
            }

            $entry = $npcEntries[mb_strtolower($name)] ?? null;
            $merchants[$name] = [
                'entry_id' => $entry?->id,
                'city' => $entry->meta['city'] ?? null,
                'spawns' => $spawns[mb_strtolower($name)] ?? null,
                'currency' => $currency,
                'offers' => $offers,
            ];
        }

        $offerCount = array_sum(array_map(fn ($m) => count($m['offers']), $merchants));
        $noSpawn = count(array_filter($merchants, fn ($m) => $m['spawns'] === null));
        $linked = count(array_filter($merchants, fn ($m) => $m['entry_id'] !== null));

        $this->info(count($merchants)." merchants with offers ({$shopless} NPCs without a shop).");
        $this->info("{$offerCount} offers matched to items; ".count($unmatched).' OT item names unmatched.');
        $this->info("{$linked} merchants linked to lore entries; {$noSpawn} without map spawns (travelling/scripted).");

        if ($unmatched !== []) {
            arsort($unmatched);
            $this->line('  Top unmatched item names: '.implode(', ', array_slice(array_keys($unmatched), 0, 12)));
        }

        if ($this->option('dry')) {
            return self::SUCCESS;
        }

        DB::transaction(function () use ($merchants) {
            NpcOffer::query()->delete();
            TradeNpc::query()->delete();

            foreach ($merchants as $name => $m) {
                $npc = TradeNpc::create([
                    'name' => $name,
                    'entry_id' => $m['entry_id'],
                    'city' => $m['city'],
                    'spawns' => $m['spawns'],
                    'currency' => $m['currency'],
                ]);

                $now = now();
                $rows = [];
                foreach ($m['offers'] as $itemId => [$buy, $sell]) {
                    $rows[] = [
                        'trade_npc_id' => $npc->id,
                        'item_entry_id' => $itemId,
                        'buy' => $buy,
                        'sell' => $sell,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }
                foreach (array_chunk($rows, 500) as $chunk) {
                    NpcOffer::insert($chunk);
                }
            }
        });

        $this->info('Trade directory rebuilt.');

        return self::SUCCESS;
    }

    /**
     * NPC spawn tiles from the world XML: lowercased name -> [[x,y,z], …],
     * limited to the exported minimap region and deduplicated.
     *
     * @return array<string, list<array{int, int, int}>>
     */
    private function parseSpawns(string $xmlPath): array
    {
        $spawns = [];
        $reader = new \XMLReader;
        $reader->open($xmlPath);
        $center = null;
        while ($reader->read()) {
            if ($reader->nodeType !== \XMLReader::ELEMENT || $reader->name !== 'npc') {
                continue;
            }
            // Outer <npc centerx…> wraps inner <npc name…> placements.
            if ($reader->getAttribute('centerx') !== null) {
                $center = [
                    (int) $reader->getAttribute('centerx'),
                    (int) $reader->getAttribute('centery'),
                    (int) $reader->getAttribute('centerz'),
                ];

                continue;
            }
            $name = trim((string) $reader->getAttribute('name'));
            if ($name === '' || $center === null) {
                continue;
            }
            $x = $center[0] + (int) $reader->getAttribute('x');
            $y = $center[1] + (int) $reader->getAttribute('y');
            $z = (int) ($reader->getAttribute('z') ?? $center[2]);
            if ($x < self::X_MIN || $x >= self::X_MAX || $y < self::Y_MIN || $y >= self::Y_MAX) {
                continue;
            }
            $key = mb_strtolower($name);
            $spawns[$key] ??= [];
            if (! in_array([$x, $y, $z], $spawns[$key], true)) {
                $spawns[$key][] = [$x, $y, $z];
            }
        }
        $reader->close();

        return $spawns;
    }

    /**
     * Server item id -> name from items.xml (for resolving token currencies).
     *
     * @return array<int, string>
     */
    private function itemNamesById(string $xmlPath): array
    {
        $names = [];
        if (! is_file($xmlPath)) {
            return $names;
        }
        $reader = new \XMLReader;
        $reader->open($xmlPath);
        while ($reader->read()) {
            if ($reader->nodeType === \XMLReader::ELEMENT && $reader->name === 'item') {
                $id = (int) $reader->getAttribute('id');
                $name = trim((string) $reader->getAttribute('name'));
                if ($id > 0 && $name !== '') {
                    $names[$id] = mb_strtolower($name);
                }
                // Ranged declarations (fromid/toid) are walls/fields — not currencies.
            }
        }
        $reader->close();

        return $names;
    }
}
