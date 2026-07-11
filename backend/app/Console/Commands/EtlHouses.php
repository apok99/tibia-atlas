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

    /**
     * Destination status → ticker event type. A house arriving at one of these
     * states (from a different prior state) is what the map's news ticker shows.
     */
    private const EVENT_TYPES = [
        'rented' => 'house_rented',
        'free' => 'house_freed',
        'auctioned' => 'house_auctioned',
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
        $total = $failed = $eventsTotal = 0;

        foreach ($worlds as $world) {
            $this->line("World {$world} …");
            $rows = [];
            $events = [];

            // Prior status per house on this world, so we can diff transitions
            // into ticker events. Empty on the first-ever run for a world → we
            // stay silent that run (no phantom "changed" events on a cold table).
            $prior = DB::table('house_status')
                ->where('world', $world)
                ->pluck('status', 'house_id')
                ->all();
            $hadPrior = $prior !== [];

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
                    $bid = (int) ($h['auction']['current_bid'] ?? 0);
                    $status = $rented ? 'rented' : ($auctioned ? 'auctioned' : 'free');
                    $rows[] = [
                        'world' => $world,
                        'house_id' => $id,
                        'status' => $status,
                        'bid' => $bid,
                        'synced_at' => $now,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];

                    // A status change on a house we've seen before = one ticker
                    // event. A brand-new house id (old === null) is skipped —
                    // there's no transition to describe, only noise.
                    $old = $prior[$id] ?? null;
                    if ($hadPrior && $old !== null && $old !== $status
                        && ($type = self::EVENT_TYPES[$status] ?? null) !== null) {
                        $events[] = [
                            'world' => $world,
                            'type' => $type,
                            'ref_id' => $id,
                            'title' => mb_substr((string) ($h['name'] ?? ''), 0, 120) ?: null,
                            'town' => $town,
                            'meta' => json_encode(array_filter([
                                'from' => $old,
                                'to' => $status,
                                'bid' => $bid ?: null,
                            ], fn ($v) => $v !== null)),
                            'occurred_at' => $now,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ];
                    }
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
            foreach (array_chunk($events, 500) as $chunk) {
                DB::table('world_events')->insert($chunk);
            }
            $total += count($rows);
            $eventsTotal += count($events);
            $this->info("  {$world}: ".count($rows).' houses upserted, '.count($events).' event(s).');
        }

        // Keep the feed bounded — a month of history is more than a ticker shows.
        DB::table('world_events')
            ->where('occurred_at', '<', $now->copy()->subDays(30))
            ->delete();

        $this->info("Done. {$total} rows, {$eventsTotal} event(s) across ".count($worlds)." world(s). Failed towns: {$failed}.");

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
