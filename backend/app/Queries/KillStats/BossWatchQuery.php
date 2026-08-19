<?php

namespace App\Queries\KillStats;

use App\Support\BossRule;
use App\Support\WorldBossRule;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Raw raid-boss roster for the "Raid Boss Watch": published Boss entries present
 * in at most `raid_max_worlds` worlds on the latest snapshot, with per-boss
 * activity counts and a sample of cooldown/open world names. Heat scoring and
 * filtering live in the transformer.
 */
class BossWatchQuery
{
    /** Latest daily snapshot date. */
    public function latestDate(): ?string
    {
        return DB::table('kill_daily')->max('snapshot_date');
    }

    /**
     * How many worlds the snapshot covers — the denominator for a boss's respawn
     * cycle. It must NOT be the boss's own `worlds_active`: killstats only lists a
     * race in worlds that recorded kills that week, so a rare boss reports from a
     * handful of worlds and dividing by that inverts the estimate (Orshabaal, the
     * rarest of all, looked like a 7-day boss). Every boss exists in every world;
     * the ones missing from its row are worlds where nobody killed it.
     */
    public function worldCount(string $latest): int
    {
        return (int) DB::table('kill_daily')
            ->where('snapshot_date', $latest)
            ->distinct()
            ->count('world_id');
    }

    /**
     * @return Collection<int, \stdClass>
     */
    /**
     * @param  string  $type  'raid' → present in ≤ $maxWorlds worlds (rare world
     *                        bosses); 'daily' → present in ≥10 worlds (per-cooldown
     *                        bosses killed across most worlds every day); 'world' →
     *                        no rarity cut, but only bosses with a real server-side
     *                        respawn ({@see WorldBossRule}); 'all' → no cut at all.
     *
     * 'raid' and 'daily' are DASHBOARD cuts, for KillStatsPage. The map rail must
     * use 'world': the 60-world cap on 'raid' silently starved it (228 of the 401
     * tracked bosses sit above it — Midnight Panther, Lloyd, Scarlett Etzel — so
     * they read "no recent spawn data" forever, even on days kill_daily had them
     * killed), but dropping the cap entirely then let in every lever and quest
     * boss, where a respawn heat is meaningless because the boss is always up and
     * the cooldown is per player. 'world' is the cut that actually matches the
     * question the rail asks.
     * @param  string|null  $world  when given, the roster still qualifies by
     *                              cross-world rarity, but the transformer scopes
     *                              each boss's heat/status to just this world
     *                              (killed there today = cold, else likely up).
     */
    public function rows(string $latest, int $maxWorlds, string $type = 'raid', ?string $world = null): Collection
    {
        $query = DB::table('kill_daily as kd')
            ->join('tibia_races as r', 'r.id', '=', 'kd.race_id')
            ->join('entries as e', 'e.id', '=', 'r.entry_id')
            ->join('tibia_worlds as w', 'w.id', '=', 'kd.world_id')
            ->where('kd.snapshot_date', $latest)
            ->where('e.status', 'published')
            ->whereRaw(BossRule::sql('e'))
            ->when($type === 'world', fn ($q) => $q->whereRaw(WorldBossRule::sql('e')))
            ->groupBy('r.name', 'e.slug', 'e.primary_image', DB::raw("e.meta->'spawn_type'"), DB::raw("e.meta->>'rank'"))
            ->select([
                'r.name as race',
                'e.slug',
                'e.primary_image as image',
                // TibiaWiki spawntype list (e.g. ["Raid"]); a Raid boss appears via a
                // server-wide raid, not a per-world respawn timer, so the transformer
                // caps its world-scoped "likely up" confidence.
                DB::raw("e.meta->'spawn_type' AS spawn_type"),
                // TibiaWiki's isboss flag. The transformer needs it to tell a
                // mis-flagged summoned add from a genuine unique rare spawn.
                DB::raw("e.meta->>'rank' AS rank"),
                DB::raw('COUNT(*) AS worlds_active'),
                DB::raw('COUNT(*) FILTER (WHERE kd.day_killed > 0) AS cooldown'),
                DB::raw('COUNT(*) FILTER (WHERE kd.week_killed > 0) AS week_worlds'),
                DB::raw('SUM(kd.day_killed) AS day_killed'),
                DB::raw('SUM(kd.week_killed) AS week_killed'),
                // Up to 4 world names where it was killed today (cooldown) / where
                // it's quiet today (open → likely up there), most-active first.
                DB::raw("array_to_string((array_agg(w.name ORDER BY kd.week_killed DESC) FILTER (WHERE kd.day_killed > 0))[1:4], ',') AS cooldown_worlds"),
                DB::raw("array_to_string((array_agg(w.name ORDER BY kd.week_killed DESC) FILTER (WHERE kd.day_killed = 0))[1:4], ',') AS open_worlds"),
            ]);

        // Rarity cut — 'world' and 'all' skip it (the rail's cut is by boss KIND,
        // applied above, not by how many worlds report the boss).
        if ($type === 'daily') {
            $query->having(DB::raw('COUNT(*)'), '>=', 10);
        } elseif ($type === 'raid') {
            $query->having(DB::raw('COUNT(*)'), '<=', $maxWorlds);
        }

        // Per-world scope: whether this boss was killed today on the chosen world
        // (so it's on cooldown there) and how many days ago its LAST kill there
        // was (null = never recorded — no anchor to reason from). The roster
        // qualification above stays cross-world so the rare-boss set is
        // unchanged — only the heat/status is re-derived per world.
        if ($world !== null) {
            $query
                ->selectRaw('BOOL_OR(w.name = ? AND kd.day_killed > 0) AS world_killed_today', [$world])
                ->selectRaw('BOOL_OR(w.name = ?) AS world_present', [$world])
                // Kill counts on THIS world alone. day_killed/week_killed above are
                // network-wide sums, so any consumer that shows "killed today" under
                // a world filter has to read these instead.
                ->selectRaw('COALESCE(SUM(kd.day_killed) FILTER (WHERE w.name = ?), 0) AS world_day_killed', [$world])
                ->selectRaw('COALESCE(SUM(kd.week_killed) FILTER (WHERE w.name = ?), 0) AS world_week_killed', [$world])
                ->selectRaw(
                    '(?::date - (SELECT MAX(kd2.snapshot_date) FROM kill_daily kd2'
                    .' JOIN tibia_worlds w2 ON w2.id = kd2.world_id'
                    .' WHERE kd2.race_id = MIN(kd.race_id) AND w2.name = ? AND kd2.day_killed > 0)) AS world_days_since',
                    [$latest, $world]
                )
                // How much history we hold at all. A boss with no kill on the chosen
                // world hasn't got "no data" — it has "not killed here in the whole
                // window", which is a LOWER BOUND on its days-since, and that is a
                // reading for this world. The transformer uses it instead of falling
                // back to the network-wide number.
                ->selectRaw('(?::date - (SELECT MIN(kd3.snapshot_date) FROM kill_daily kd3)) AS window_days', [$latest]);
        }

        return $query->get();
    }
}
