<?php

namespace App\Console\Commands;

use App\Models\TibiaRace;
use App\Models\TibiaWorld;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * ETL for TibiaData kill statistics.
 *
 * The TibiaData API only exposes rolling windows (last 24h / last 7 days). To
 * build monthly/annual charts we snapshot the *daily* window once per day and
 * accumulate into kill_monthly. Run daily (see the scheduler in routes/console).
 *
 *   php artisan tibia:etl-killstats                 # all worlds, today
 *   php artisan tibia:etl-killstats --worlds=Antica,Secura
 *   php artisan tibia:etl-killstats --date=2026-06-27 --sleep=400
 */
class EtlKillStatistics extends Command
{
    protected $signature = 'tibia:etl-killstats
        {--worlds= : Comma-separated world names to fetch (default: all online)}
        {--date= : Snapshot date YYYY-MM-DD (default: today, server TZ)}
        {--sleep=250 : Delay between world requests in milliseconds}
        {--keep-days=30 : Prune raw daily snapshots older than this many days}
        {--no-prune : Skip pruning of old daily snapshots}
        {--link-only : Only re-link races to lore entries, skip fetching}';

    protected $description = 'Fetch TibiaData kill statistics for every world and accumulate daily/monthly totals';

    private string $base;

    public function handle(): int
    {
        $this->base = rtrim((string) env('TIBIADATA_BASE_URL', 'https://api.tibiadata.com'), '/');
        $date = $this->option('date')
            ? Carbon::parse((string) $this->option('date'))->toDateString()
            : Carbon::today()->toDateString();
        $sleepMs = (int) $this->option('sleep');

        if ($this->option('link-only')) {
            $changed = $this->linkRacesToEntries();
            $this->info("Re-linked races to lore entries. Links changed: {$changed}.");

            return self::SUCCESS;
        }

        $this->info("TibiaData kill-stats ETL — snapshot date {$date}");

        // 1) Worlds dimension ------------------------------------------------
        $worldNames = $this->syncWorlds();
        if ($filter = (string) $this->option('worlds')) {
            $wanted = array_map('trim', explode(',', $filter));
            $worldNames = array_values(array_intersect($worldNames, $wanted));
        }
        if (! $worldNames) {
            $this->error('No worlds to process.');

            return self::FAILURE;
        }
        $this->info(count($worldNames).' worlds to fetch.');

        // Preload race name → id so we only insert genuinely new races.
        $raceIds = TibiaRace::pluck('id', 'name')->all();

        // 2) Per-world kill statistics → kill_daily --------------------------
        $bar = $this->output->createProgressBar(count($worldNames));
        $bar->start();
        $totalRows = $failed = 0;

        foreach ($worldNames as $name) {
            $entries = $this->fetchKillStatistics($name);
            if ($entries === null) {
                $failed++;
                $bar->advance();
                if ($sleepMs > 0) {
                    usleep($sleepMs * 1000);
                }
                continue;
            }

            $worldId = TibiaWorld::where('name', $name)->value('id');
            $raceIds = $this->ensureRaces($entries, $raceIds);

            $rows = [];
            $now = now();
            foreach ($entries as $e) {
                $race = $e['race'] ?? null;
                if (! $race || ! isset($raceIds[$race])) {
                    continue;
                }
                $rows[] = [
                    'world_id' => $worldId,
                    'race_id' => $raceIds[$race],
                    'snapshot_date' => $date,
                    'day_players_killed' => (int) ($e['last_day_players_killed'] ?? 0),
                    'day_killed' => (int) ($e['last_day_killed'] ?? 0),
                    'week_players_killed' => (int) ($e['last_week_players_killed'] ?? 0),
                    'week_killed' => (int) ($e['last_week_killed'] ?? 0),
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }

            foreach (array_chunk($rows, 1000) as $chunk) {
                DB::table('kill_daily')->upsert(
                    $chunk,
                    ['world_id', 'race_id', 'snapshot_date'],
                    ['day_players_killed', 'day_killed', 'week_players_killed', 'week_killed', 'updated_at'],
                );
            }
            $totalRows += count($rows);

            $bar->advance();
            if ($sleepMs > 0) {
                usleep($sleepMs * 1000);
            }
        }

        $bar->finish();
        $this->newLine(2);
        $this->info("Inserted/updated {$totalRows} daily rows. Failed worlds: {$failed}.");

        // 3) Roll up daily → monthly (max-preserving, prune-safe) ------------
        $this->rollupMonthly();
        $this->info('Monthly rollup updated.');

        // 4) Link races to lore entries (by EN name) ------------------------
        $linked = $this->linkRacesToEntries();
        $this->info("Race↔entry links updated: {$linked}.");

        // 5) Prune old daily snapshots --------------------------------------
        if (! $this->option('no-prune')) {
            $cutoff = Carbon::today()->subDays((int) $this->option('keep-days'))->toDateString();
            $deleted = DB::table('kill_daily')->where('snapshot_date', '<', $cutoff)->delete();
            $this->info("Pruned {$deleted} daily rows older than {$cutoff}.");
        }

        return self::SUCCESS;
    }

    /** Fetch /v4/worlds, upsert the dimension, return online world names. */
    private function syncWorlds(): array
    {
        $resp = Http::timeout(20)->retry(3, 1000)
            ->withHeaders(['User-Agent' => 'TibiaAtlas-ETL'])
            ->get("{$this->base}/v4/worlds");

        if (! $resp->ok()) {
            $this->error('Failed to fetch /v4/worlds: HTTP '.$resp->status());

            return [];
        }

        $payload = $resp->json('worlds') ?? [];
        $list = array_merge(
            $payload['regular_worlds'] ?? [],
            $payload['tournament_worlds'] ?? [],
        );

        $names = [];
        $now = now();
        $rows = [];
        foreach ($list as $w) {
            if (empty($w['name'])) {
                continue;
            }
            $names[] = $w['name'];
            $rows[] = [
                'name' => $w['name'],
                'location' => $w['location'] ?? null,
                'pvp_type' => $w['pvp_type'] ?? null,
                'game_world_type' => $w['game_world_type'] ?? null,
                'status' => $w['status'] ?? null,
                'players_online' => (int) ($w['players_online'] ?? 0),
                'last_synced_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        if ($rows) {
            DB::table('tibia_worlds')->upsert(
                $rows,
                ['name'],
                ['location', 'pvp_type', 'game_world_type', 'status', 'players_online', 'last_synced_at', 'updated_at'],
            );
        }

        return $names;
    }

    /** Fetch killstatistics for one world; null on failure. */
    private function fetchKillStatistics(string $world): ?array
    {
        try {
            $resp = Http::timeout(25)->retry(2, 1500)
                ->withHeaders(['User-Agent' => 'TibiaAtlas-ETL'])
                ->get("{$this->base}/v4/killstatistics/".rawurlencode($world));

            if (! $resp->ok()) {
                return null;
            }

            return $resp->json('killstatistics.entries') ?? [];
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Make sure every race name in $entries has a row; insert the new ones in
     * bulk and return the updated name → id map.
     */
    private function ensureRaces(array $entries, array $raceIds): array
    {
        $new = [];
        foreach ($entries as $e) {
            $race = $e['race'] ?? null;
            if ($race && ! isset($raceIds[$race]) && ! isset($new[$race])) {
                $new[$race] = true;
            }
        }
        if (! $new) {
            return $raceIds;
        }

        $now = now();
        $rows = array_map(
            fn ($name) => ['name' => $name, 'created_at' => $now, 'updated_at' => $now],
            array_keys($new),
        );
        DB::table('tibia_races')->insertOrIgnore($rows);

        // Re-read just the ids we need.
        $added = TibiaRace::whereIn('name', array_keys($new))->pluck('id', 'name')->all();

        return $raceIds + $added;
    }

    /**
     * Recompute every month present in kill_daily and upsert into kill_monthly.
     * Uses GREATEST so a later partial recompute (after old daily rows are
     * pruned) can never lower an already-sealed month total — within a month the
     * sum only grows as more days fold in, so the running max is the truth.
     */
    private function rollupMonthly(): void
    {
        DB::statement(<<<'SQL'
            INSERT INTO kill_monthly
                (world_id, race_id, period, players_killed, killed, days_counted, created_at, updated_at)
            SELECT world_id, race_id,
                   date_trunc('month', snapshot_date)::date AS period,
                   SUM(day_players_killed) AS players_killed,
                   SUM(day_killed)         AS killed,
                   COUNT(*)                AS days_counted,
                   now(), now()
            FROM kill_daily
            GROUP BY world_id, race_id, date_trunc('month', snapshot_date)
            ON CONFLICT (world_id, race_id, period) DO UPDATE SET
                players_killed = GREATEST(kill_monthly.players_killed, EXCLUDED.players_killed),
                killed         = GREATEST(kill_monthly.killed, EXCLUDED.killed),
                days_counted   = GREATEST(kill_monthly.days_counted, EXCLUDED.days_counted),
                updated_at     = now()
        SQL);
    }

    /**
     * Link races to lore entries by EN name, self-healing on every run.
     *
     * Killstatistics names common creatures in lowercase plural ("behemoths",
     * "mummies", "wolves") while lore entries are singular ("Behemoth", "Mummy",
     * "Wolf"), so we singularise the race name with Laravel's inflector (handles
     * irregulars: men, ies→y, ves→f…). Two subtleties this fixes:
     *  - Some plural-named CONCEPT articles exist alongside the creature
     *    ("Orcs"/concept vs "Orc"/creature) — we PREFER type=creature entries so
     *    the race links to the huntable creature, not the lore concept.
     *  - Entry names carry disambiguators ("Monk (Creature)") — we also index a
     *    parenthetical-stripped variant.
     *
     * Re-evaluates all races each run (cheap) so links stay correct as creatures
     * are imported later. Returns the number of links it changed.
     */
    private function linkRacesToEntries(): int
    {
        // Four maps in descending priority. Exact full names beat
        // parenthetical-stripped ones ("Demon" must beat "Demon (Goblin)"→demon),
        // and creature-type entries beat other types ("Orc" creature beats "Orcs"
        // concept).
        $creatureExact = $creatureStripped = $anyExact = $anyStripped = [];

        $rows = DB::table('entries as e')
            ->join('entry_translations as t', 't.entry_id', '=', 'e.id')
            ->where('t.locale', 'en')
            ->whereNull('e.deleted_at')
            ->get(['e.id', 'e.type', 't.name']);

        foreach ($rows as $r) {
            $exact = mb_strtolower(trim($r->name));
            $stripped = trim((string) preg_replace('/\s*\(.*?\)\s*/', ' ', $exact));
            $isCreature = $r->type === 'creature';

            $anyExact[$exact] ??= $r->id;
            if ($isCreature) {
                $creatureExact[$exact] ??= $r->id;
            }
            if ($stripped !== '' && $stripped !== $exact) {
                $anyStripped[$stripped] ??= $r->id;
                if ($isCreature) {
                    $creatureStripped[$stripped] ??= $r->id;
                }
            }
        }

        $maps = [$creatureExact, $creatureStripped, $anyExact, $anyStripped];

        $resolve = function (string $raceName) use ($maps): ?int {
            $l = mb_strtolower(trim($raceName));
            // Singular FIRST: killstats race names are plural ("demons"), and a
            // plural-named duplicate entry ("Demons") must not beat the real
            // singular creature ("Demon"). Exact is the fallback for proper-noun
            // bosses whose name the inflector would mangle ("Cyclops").
            $candidates = [mb_strtolower(Str::singular($l)), $l];
            if (str_ends_with($l, 'ae')) {
                $candidates[] = substr($l, 0, -2).'a';   // medusae → medusa (Latin)
            }
            foreach ($maps as $map) {
                foreach ($candidates as $c) {
                    if (isset($map[$c])) {
                        return $map[$c];
                    }
                }
            }

            return null;
        };

        $changed = 0;
        DB::table('tibia_races')->orderBy('id')->chunkById(500, function ($races) use ($resolve, &$changed) {
            $byEntry = [];
            foreach ($races as $race) {
                $eid = $resolve($race->name);
                if ($eid !== null && $eid !== $race->entry_id) {
                    $byEntry[$eid][] = $race->id;
                }
            }
            foreach ($byEntry as $eid => $ids) {
                $changed += DB::table('tibia_races')->whereIn('id', $ids)->update(['entry_id' => $eid, 'updated_at' => now()]);
            }
        });

        return $changed;
    }
}
