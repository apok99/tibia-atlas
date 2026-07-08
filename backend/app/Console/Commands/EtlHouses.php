<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Telescope\Telescope;

/**
 * ETL for TibiaData house rent status.
 *
 * TibiaData's houses API gives no coordinates, so the map plots houses from a
 * static file baked off the world files (tools/otbm/bake-houses.mjs); this
 * command layers the CHANGING bit — rented / on-auction / free, per world — into
 * house_status, joined to those pins by the real Tibia house id. One request per
 * town per world; upsert-only (a fresh snapshot each run, no history).
 *
 *   php artisan tibia:etl-houses                      # ALL regular worlds
 *   php artisan tibia:etl-houses --worlds=Antica,Secura
 */
class EtlHouses extends Command
{
    protected $signature = 'tibia:etl-houses
        {--worlds= : Comma-separated world names (default: all regular worlds from /v4/worlds)}
        {--sleep=200 : Delay between town requests in milliseconds}';

    protected $description = 'Fetch TibiaData house rent status per world into house_status';

    /**
     * Towns that actually contain rentable houses/guildhalls (matches the towns
     * present in houses.json). TibiaData 404s on townless towns, so we only ask
     * for these.
     */
    private const TOWNS = [
        'Ab\'Dendriel', 'Ankrahmun', 'Candia', 'Carlin', 'Darashia', 'Edron',
        'Farmine', 'Gray Beach', 'Issavi', 'Kazordoon', 'Krailos', 'Liberty Bay',
        'Moonfall', 'Port Hope', 'Rathleton', 'Silvertides', 'Svargrond', 'Thais',
        'Venore', 'Yalahar',
    ];

    private string $base;

    public function handle(): int
    {
        // ~90 worlds × 20 towns = ~1800 HTTP calls + upserts in one process. Telescope
        // buffers every query/request in memory and only flushes at the end, so on a
        // run this long it exhausts PHP's memory limit (~57 worlds in). Stop it
        // recording; this is a background ETL, not a request worth inspecting.
        if (class_exists(Telescope::class)) {
            Telescope::stopRecording();
        }
        DB::connection()->disableQueryLog();

        $this->base = rtrim((string) env('TIBIADATA_BASE_URL', 'https://api.tibiadata.com'), '/');
        $sleepMs = (int) $this->option('sleep');

        $worlds = ($opt = (string) $this->option('worlds'))
            ? array_filter(array_map('trim', explode(',', $opt)))
            : $this->allWorlds();
        if (! $worlds) {
            $this->error('No worlds to fetch.');

            return self::FAILURE;
        }
        $this->info(count($worlds).' world(s) × '.count(self::TOWNS).' towns to fetch.');

        $now = now();
        $total = $failed = 0;

        foreach ($worlds as $world) {
            $this->line("World {$world} …");
            $rows = [];

            foreach (self::TOWNS as $town) {
                $houses = $this->fetchTown($world, $town);
                if ($houses === null) {
                    $failed++;
                    $this->warn("  {$town}: fetch failed");
                    if ($sleepMs > 0) {
                        usleep($sleepMs * 1000);
                    }

                    continue;
                }

                foreach ($houses as $h) {
                    $id = (int) ($h['house_id'] ?? 0);
                    if (! $id) {
                        continue;
                    }
                    $rented = (bool) ($h['rented'] ?? false);
                    $auctioned = (bool) ($h['auctioned'] ?? false);
                    $rows[] = [
                        'world' => $world,
                        'house_id' => $id,
                        'status' => $rented ? 'rented' : ($auctioned ? 'auctioned' : 'free'),
                        'bid' => (int) ($h['auction']['current_bid'] ?? 0),
                        'synced_at' => $now,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }

                if ($sleepMs > 0) {
                    usleep($sleepMs * 1000);
                }
            }

            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('house_status')->upsert(
                    $chunk,
                    ['world', 'house_id'],
                    ['status', 'bid', 'synced_at', 'updated_at'],
                );
            }
            $total += count($rows);
            $this->info("  {$world}: ".count($rows).' houses upserted.');
        }

        $this->info("Done. {$total} rows across ".count($worlds)." world(s). Failed towns: {$failed}.");

        return self::SUCCESS;
    }

    /** Every regular world name from /v4/worlds (tournament worlds skipped). */
    private function allWorlds(): array
    {
        try {
            $resp = Http::timeout(20)->retry(3, 1000)
                ->withHeaders(['User-Agent' => 'TibiaAtlas-ETL'])
                ->get("{$this->base}/v4/worlds");

            if (! $resp->ok()) {
                $this->error('Failed to fetch /v4/worlds: HTTP '.$resp->status());

                return [];
            }

            $list = $resp->json('worlds.regular_worlds') ?? [];

            return array_values(array_filter(array_map(fn ($w) => $w['name'] ?? null, $list)));
        } catch (\Throwable $e) {
            $this->error('Failed to fetch /v4/worlds: '.$e->getMessage());

            return [];
        }
    }

    /** GET /v4/houses/{world}/{town}, merged house + guildhall lists; null on failure. */
    private function fetchTown(string $world, string $town): ?array
    {
        try {
            $resp = Http::timeout(25)->retry(2, 1200)
                ->withHeaders(['User-Agent' => 'TibiaAtlas-ETL'])
                ->get("{$this->base}/v4/houses/".rawurlencode($world).'/'.rawurlencode($town));

            if (! $resp->ok()) {
                return null;
            }

            return array_merge(
                $resp->json('houses.house_list') ?? [],
                $resp->json('houses.guildhall_list') ?? [],
            );
        } catch (\Throwable $e) {
            return null;
        }
    }
}
