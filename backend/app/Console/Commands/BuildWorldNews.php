<?php

namespace App\Console\Commands;

use App\Models\TibiaWorld;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Daily "yesterday on your world" digest for the map's news ticker. Turns the
 * kill-statistics warehouse (kill_daily, populated hourly by tibia:etl-killstats)
 * into a handful of headline world_events per world:
 *   - digest_total        : how many monsters were slain yesterday
 *   - digest_top_creature : the single most-hunted creature
 *   - digest_boss (×N)     : the bosses that fell, most-killed first
 *
 * These land alongside the house-change events ([[EtlHouses]]) so the ticker has
 * fresh content every day even when no house turned over. Idempotent: it replaces
 * the world's previous digest each run, so exactly one current digest exists.
 *
 *   php artisan tibia:build-world-news                       # Antica
 *   php artisan tibia:build-world-news --worlds=Antica,Secura --bosses=5
 */
class BuildWorldNews extends Command
{
    protected $signature = 'tibia:build-world-news
        {--worlds=Antica : Comma-separated world names}
        {--bosses=3 : How many top bosses to feature}';

    protected $description = 'Build the daily kill-stats digest (top creature, top bosses, total kills) into world_events for the map news ticker';

    public function handle(): int
    {
        $worlds = array_filter(array_map('trim', explode(',', (string) $this->option('worlds'))));
        $bossN = max(1, (int) $this->option('bosses'));
        $today = Carbon::today()->toDateString();
        $now = now();
        $made = 0;

        foreach ($worlds as $world) {
            $wid = TibiaWorld::where('name', $world)->value('id');
            if (! $wid) {
                $this->warn("{$world}: unknown world");

                continue;
            }

            // Prefer the most recent COMPLETE day (strictly before today); fall
            // back to the latest snapshot when we only have today's partial,
            // still-rolling 24h window.
            $date = DB::table('kill_daily')->where('world_id', $wid)->where('snapshot_date', '<', $today)->max('snapshot_date')
                ?? DB::table('kill_daily')->where('world_id', $wid)->max('snapshot_date');
            if (! $date) {
                $this->warn("{$world}: no kill data yet");

                continue;
            }

            // One base query over that day's kills; boss-ness comes from the
            // linked lore entry's meta.rank (unlinked races are never bosses).
            $base = fn () => DB::table('kill_daily as kd')
                ->join('tibia_races as r', 'r.id', '=', 'kd.race_id')
                ->leftJoin('entries as e', 'e.id', '=', 'r.entry_id')
                ->where('kd.world_id', $wid)
                ->where('kd.snapshot_date', $date)
                ->where('kd.day_killed', '>', 0);

            $total = (int) $base()->sum('kd.day_killed');

            $topCreature = $base()
                ->whereRaw("(e.meta->>'rank') IS DISTINCT FROM 'Boss'")
                ->orderByDesc('kd.day_killed')
                ->first(['r.name', 'kd.day_killed', 'e.slug', 'e.primary_image']);

            $topBosses = $base()
                ->whereRaw("(e.meta->>'rank') = 'Boss'")
                ->orderByDesc('kd.day_killed')
                ->limit($bossN)
                ->get(['r.name', 'kd.day_killed', 'e.slug', 'e.primary_image']);

            $events = [];
            if ($total > 0) {
                $events[] = $this->row($world, 'digest_total', null, ['count' => $total], $now);
            }
            if ($topCreature) {
                $events[] = $this->row($world, 'digest_top_creature', Str::title($topCreature->name), [
                    'count' => (int) $topCreature->day_killed,
                    'slug' => $topCreature->slug,
                    'image' => $topCreature->primary_image,
                ], $now);
            }
            foreach ($topBosses as $b) {
                // Boss names come through already proper-cased (they're proper
                // nouns) — unlike the lowercase-plural creature races — so leave
                // them as-is; Str::title would mangle "Herald of Fire" → "Of".
                $events[] = $this->row($world, 'digest_boss', $b->name, [
                    'count' => (int) $b->day_killed,
                    'slug' => $b->slug,
                    'image' => $b->primary_image,
                ], $now);
            }

            // Exactly one current digest per world — drop the previous set first.
            DB::table('world_events')->where('world', $world)->where('type', 'like', 'digest_%')->delete();
            foreach (array_chunk($events, 500) as $chunk) {
                DB::table('world_events')->insert($chunk);
            }
            $made += count($events);
            $this->info("{$world}: {$date} → ".count($events).' digest event(s).');
        }

        $this->info("Done. {$made} digest event(s).");

        return self::SUCCESS;
    }

    /** @param  array<string, mixed>  $meta */
    private function row(string $world, string $type, ?string $title, array $meta, Carbon $now): array
    {
        return [
            'world' => $world,
            'type' => $type,
            'ref_id' => null,
            'title' => $title,
            'town' => null,
            'meta' => json_encode($meta),
            'occurred_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ];
    }
}
