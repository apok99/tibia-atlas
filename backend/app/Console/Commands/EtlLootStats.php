<?php

namespace App\Console\Commands;

use App\Models\Entry;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;

/**
 * Compute a REALISTIC expected gold-per-kill for each creature from TibiaWiki's
 * "Loot Statistics" pages, and store it on the creature as `meta.gold_per_kill`.
 *
 * Why: the map's spawn "money" badge needs believable numbers. Summing a whole
 * loot table (as if every drop landed on every kill, and ignoring drop rates)
 * put snakes at 200k. The wiki instead publishes real sampled drops:
 *
 *   {{Loot2 |kills=14944 |Gold Coin, times:13485, amount:1-104, total:509277
 *           |Dragon Ham, times:9722, amount:1-2, total:14627 | … }}
 *
 * `total` is the total amount looted across `kills` kills, so the expected value
 * per kill is Σ (total / kills) × unit_worth(item). For Dragon that's ~34 gp of
 * gold coins + the ham/shields/etc — i.e. the real ~100 gp/kill, not a fantasy.
 *
 *   php artisan tibia:etl-loot-stats                 # all creatures
 *   php artisan tibia:etl-loot-stats --limit=20      # first 20 (debugging)
 *   php artisan tibia:etl-loot-stats --dry-run       # report, write nothing
 */
class EtlLootStats extends Command
{
    protected $signature = 'tibia:etl-loot-stats
        {--limit=0 : Max creatures to process (0 = all)}
        {--sleep=150 : Delay between wiki requests in milliseconds}
        {--dry-run : Report what would change without writing}';

    protected $description = 'Derive realistic expected gold-per-kill for creatures from TibiaWiki Loot Statistics';

    /** Currencies are worth a fixed gp regardless of the item catalogue. */
    private const CURRENCY = [
        'gold coin' => 1,
        'platinum coin' => 100,
        'crystal coin' => 10000,
    ];

    /** Guard against a mislabelled wiki value range (some read into the millions). */
    private const UNIT_WORTH_CAP = 1_000_000;

    public function handle(): int
    {
        $limit = (int) $this->option('limit');
        $sleepMs = max(0, (int) $this->option('sleep'));
        $dry = (bool) $this->option('dry-run');

        $worth = $this->itemWorthByName();
        $this->info('Loaded worth for '.count($worth).' items.');

        $creatures = Entry::query()
            ->where('type', 'creature')
            ->with('translations')
            ->get(['id', 'slug', 'meta']);
        if ($limit > 0) {
            $creatures = $creatures->take($limit);
        }

        $updated = $missing = $failed = 0;
        foreach ($creatures as $creature) {
            $enName = $creature->translation('en')?->name
                ?? $creature->translation('es')?->name;
            if (! $enName) {
                continue;
            }

            $raw = $this->fetchLootStats($enName);
            if ($raw === null) {
                $missing++;
                if ($sleepMs) {
                    usleep($sleepMs * 1000);
                }

                continue;
            }

            $parsed = $this->parseGoldPerKill($raw, $worth);
            if ($parsed === null) {
                $failed++;
                if ($sleepMs) {
                    usleep($sleepMs * 1000);
                }

                continue;
            }

            [$gpk, $kills] = $parsed;
            $this->line(sprintf('  %-28s %8s gp/kill  (%d kills)', $enName, number_format($gpk), $kills));

            if (! $dry) {
                $meta = $creature->meta ?? [];
                $meta['gold_per_kill'] = $gpk;
                $meta['loot_stats_kills'] = $kills;
                $creature->meta = $meta;
                $creature->save();
            }
            $updated++;

            if ($sleepMs) {
                usleep($sleepMs * 1000);
            }
        }

        $this->info("Done. Updated: {$updated}, no stats page: {$missing}, unparseable: {$failed}.");

        return self::SUCCESS;
    }

    /**
     * English item name (lowercased) → best gp worth. Currencies are forced to
     * their real gp value so a spawn's gold total is dominated by actual coins.
     *
     * @return array<string, int>
     */
    private function itemWorthByName(): array
    {
        $map = [];
        Entry::query()
            ->where('type', 'item')
            ->with('translations')
            ->get(['id', 'meta'])
            ->each(function (Entry $item) use (&$map) {
                $name = $item->translation('en')?->name;
                if (! $name) {
                    return;
                }
                $map[mb_strtolower($name)] = min(self::UNIT_WORTH_CAP, $this->itemWorth($item->meta ?? []));
            });
        foreach (self::CURRENCY as $name => $gp) {
            $map[$name] = $gp;
        }

        return $map;
    }

    /** Best gp estimate for one item: NPC sell price, else top of the wiki range. */
    private function itemWorth(array $meta): int
    {
        $npc = data_get($meta, 'npc_value');
        if (is_numeric($npc)) {
            return (int) $npc;
        }
        $value = data_get($meta, 'value');
        if (is_string($value) && preg_match_all('/\d[\d,]*/', $value, $m)) {
            $nums = array_map(fn ($n) => (int) str_replace(',', '', $n), $m[0]);

            return $nums ? max($nums) : 0;
        }

        return 0;
    }

    /**
     * Fetch the raw wikitext of a creature's Loot Statistics page, or null when
     * there's no such page (many creatures lack sampled stats). Uses system curl
     * with the mirror UA — the same call the image mirror relies on to pass the
     * fandom CDN, which rejects PHP/Guzzle's TLS fingerprint.
     */
    private function fetchLootStats(string $enName): ?string
    {
        $title = 'Loot_Statistics:'.str_replace(' ', '_', $enName);
        $url = 'https://tibia.fandom.com/wiki/'.rawurlencode($title).'?action=raw';

        try {
            $res = Process::timeout(40)->run([
                'curl', '-sS', '-L', '--fail', '--max-time', '30',
                '-A', 'TibiaAtlas-ImageMirror',
                $url,
            ]);
        } catch (\Throwable $e) {
            return null;
        }

        if (! $res->successful()) {
            return null;
        }
        $body = $res->output();

        return str_contains($body, '{{Loot2') ? $body : null;
    }

    /**
     * Parse the FIRST (newest) {{Loot2}} block into an expected gp/kill and the
     * kill sample size. Returns null if it can't find a usable kills count.
     *
     * @param  array<string, int>  $worth
     * @return array{0:int,1:int}|null
     */
    private function parseGoldPerKill(string $raw, array $worth): ?array
    {
        $start = strpos($raw, '{{Loot2');
        if ($start === false) {
            return null;
        }
        $end = strpos($raw, '}}', $start);
        $block = $end === false ? substr($raw, $start) : substr($raw, $start, $end - $start);

        if (! preg_match('/\|\s*kills\s*=\s*(\d+)/', $block, $km)) {
            return null;
        }
        $kills = (int) $km[1];
        if ($kills <= 0) {
            return null;
        }

        $gp = 0.0;
        foreach (preg_split('/\r?\n/', $block) as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] !== '|') {
                continue;
            }
            // Item lines: "|<Name>, times:N[, amount:a-b][, total:T]". Skip the
            // template params (version/kills/name — they carry an '=') and Empty.
            if (! preg_match('/^\|([^,=|]+?),\s*times:(\d+)(?:,\s*amount:[0-9-]+)?(?:,\s*total:(\d+))?/', $line, $m)) {
                continue;
            }
            $name = mb_strtolower(trim($m[1]));
            if ($name === 'empty') {
                continue;
            }
            $times = (int) $m[2];
            // `total` is the summed amount looted (coins, or item count); when the
            // page omits it, fall back to one-per-drop.
            $total = isset($m[3]) && $m[3] !== '' ? (int) $m[3] : $times;
            $unit = $worth[$name] ?? 0;
            if ($unit <= 0) {
                continue;
            }
            $gp += ($total / $kills) * $unit;
        }

        return [(int) round($gp), $kills];
    }
}
