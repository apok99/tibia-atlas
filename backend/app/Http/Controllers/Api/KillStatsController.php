<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TibiaWorld;
use App\Support\TibiaExp;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Public, read-only access to the TibiaData kill-statistics warehouse populated
 * by the `tibia:etl-killstats` command. Powers the "Estadísticas" dashboard.
 */
class KillStatsController extends Controller
{
    /** Allowed metric → column suffix, to keep raw input out of SQL. */
    private const METRICS = ['players_killed', 'killed'];

    /** Dashboard header numbers + the latest snapshot date. */
    public function meta(): JsonResponse
    {
        return response()->json([
            'latest_snapshot' => DB::table('kill_daily')->max('snapshot_date'),
            'worlds' => (int) DB::table('tibia_worlds')->count(),
            'races' => (int) DB::table('tibia_races')->count(),
            'months_available' => (int) DB::table('kill_monthly')->distinct()->count('period'),
            'players_online' => (int) DB::table('tibia_worlds')->sum('players_online'),
        ]);
    }

    /** World list for the selector (most populated first). */
    public function worlds(): JsonResponse
    {
        $worlds = TibiaWorld::query()
            ->orderByDesc('players_online')
            ->get(['name', 'location', 'pvp_type', 'status', 'players_online']);

        return response()->json(['data' => $worlds]);
    }

    /**
     * Ranking of the deadliest (or most-killed) races.
     *
     * Query: world=all|<Name>, metric=players_killed|killed,
     *        window=day|week|month|year, limit=20.
     */
    public function ranking(Request $request): JsonResponse
    {
        $metric = $this->metric($request);
        $world = (string) $request->string('world', 'all');
        $window = (string) $request->string('window', 'day');
        $limit = min(max($request->integer('limit', 20), 1), 100);
        $worldId = $world !== 'all' ? TibiaWorld::where('name', $world)->value('id') : null;

        if (in_array($window, ['day', 'week'], true)) {
            $col = $window === 'day' ? 'day_' : 'week_';
            $latest = DB::table('kill_daily')
                ->when($worldId, fn ($q) => $q->where('world_id', $worldId))
                ->max('snapshot_date');

            $rows = DB::table('kill_daily as kd')
                ->join('tibia_races as r', 'r.id', '=', 'kd.race_id')
                ->leftJoin('entries as e', 'e.id', '=', 'r.entry_id')
                ->where('kd.snapshot_date', $latest)
                ->when($worldId, fn ($q) => $q->where('kd.world_id', $worldId))
                ->groupBy('r.name', 'e.slug', 'e.primary_image')
                ->select([
                    'r.name as race',
                    'e.slug',
                    'e.primary_image as image',
                    DB::raw("SUM(kd.{$col}players_killed) as players_killed"),
                    DB::raw("SUM(kd.{$col}killed) as killed"),
                ])
                ->orderByDesc($metric)
                ->limit($limit)
                ->get();
        } else {
            // month = current calendar month; year = current calendar year.
            $rows = DB::table('kill_monthly as km')
                ->join('tibia_races as r', 'r.id', '=', 'km.race_id')
                ->leftJoin('entries as e', 'e.id', '=', 'r.entry_id')
                ->when($worldId, fn ($q) => $q->where('km.world_id', $worldId))
                ->when($window === 'month',
                    fn ($q) => $q->whereRaw("km.period = date_trunc('month', current_date)::date"),
                    fn ($q) => $q->whereRaw("km.period >= date_trunc('year', current_date)::date"),
                )
                ->groupBy('r.name', 'e.slug', 'e.primary_image')
                ->select([
                    'r.name as race',
                    'e.slug',
                    'e.primary_image as image',
                    DB::raw('SUM(km.players_killed) as players_killed'),
                    DB::raw('SUM(km.killed) as killed'),
                ])
                ->orderByDesc($metric)
                ->limit($limit)
                ->get();
        }

        return response()->json([
            'window' => $window,
            'metric' => $metric,
            'world' => $world,
            'data' => $rows->map(fn ($r) => [
                'race' => $r->race,
                'slug' => $r->slug,
                'image' => $r->image,
                'players_killed' => (int) $r->players_killed,
                'killed' => (int) $r->killed,
            ]),
        ]);
    }

    /**
     * Time series for a single race.
     *
     * Query: race=<Name> (required), world=all|<Name>,
     *        granularity=month|day.
     */
    public function series(Request $request): JsonResponse
    {
        $race = (string) $request->string('race');
        if ($race === '') {
            return response()->json(['message' => 'race is required'], 422);
        }
        $world = (string) $request->string('world', 'all');
        $granularity = (string) $request->string('granularity', 'month') === 'day' ? 'day' : 'month';
        $worldId = $world !== 'all' ? TibiaWorld::where('name', $world)->value('id') : null;
        $raceId = DB::table('tibia_races')->whereRaw('lower(name) = lower(?)', [$race])->value('id');

        if (! $raceId) {
            return response()->json(['race' => $race, 'world' => $world, 'granularity' => $granularity, 'data' => []]);
        }

        if ($granularity === 'month') {
            $rows = DB::table('kill_monthly')
                ->where('race_id', $raceId)
                ->when($worldId, fn ($q) => $q->where('world_id', $worldId))
                ->groupBy('period')
                ->select([
                    DB::raw('period'),
                    DB::raw('SUM(players_killed) as players_killed'),
                    DB::raw('SUM(killed) as killed'),
                ])
                ->orderBy('period')
                ->get()
                ->map(fn ($r) => [
                    'period' => substr((string) $r->period, 0, 7), // YYYY-MM
                    'players_killed' => (int) $r->players_killed,
                    'killed' => (int) $r->killed,
                ]);
        } else {
            $rows = DB::table('kill_daily')
                ->where('race_id', $raceId)
                ->when($worldId, fn ($q) => $q->where('world_id', $worldId))
                ->groupBy('snapshot_date')
                ->select([
                    DB::raw('snapshot_date'),
                    DB::raw('SUM(day_players_killed) as players_killed'),
                    DB::raw('SUM(day_killed) as killed'),
                ])
                ->orderBy('snapshot_date')
                ->get()
                ->map(fn ($r) => [
                    'period' => substr((string) $r->snapshot_date, 0, 10), // YYYY-MM-DD
                    'players_killed' => (int) $r->players_killed,
                    'killed' => (int) $r->killed,
                ]);
        }

        return response()->json([
            'race' => $race,
            'world' => $world,
            'granularity' => $granularity,
            'data' => $rows,
        ]);
    }

    /**
     * Kill stats for a single lore entry (creature), resolved via the race it
     * is linked to. Powers the mini kill-stats panel on the entry page:
     * the latest 24h / 7d totals plus a daily trend (last ~30 days).
     */
    public function entry(string $slug): JsonResponse
    {
        $race = DB::table('tibia_races as r')
            ->join('entries as e', 'e.id', '=', 'r.entry_id')
            ->where('e.slug', $slug)
            ->select('r.id', 'r.name', DB::raw("(e.meta->>'experience') AS exp_each"))
            ->first();

        if (! $race) {
            return response()->json(['linked' => false, 'race' => null, 'latest' => null, 'series' => []]);
        }

        $expEach = is_numeric($race->exp_each) ? (int) $race->exp_each : null;

        $latestDate = DB::table('kill_daily')->where('race_id', $race->id)->max('snapshot_date');
        $latest = null;
        if ($latestDate) {
            $row = DB::table('kill_daily')
                ->where('race_id', $race->id)
                ->where('snapshot_date', $latestDate)
                ->selectRaw('SUM(day_players_killed) AS day_players_killed, SUM(day_killed) AS day_killed,
                             SUM(week_players_killed) AS week_players_killed, SUM(week_killed) AS week_killed')
                ->first();
            $latest = [
                'date' => $latestDate,
                'players_killed' => (int) $row->day_players_killed,
                'killed' => (int) $row->day_killed,
                'week_players_killed' => (int) $row->week_players_killed,
                'week_killed' => (int) $row->week_killed,
                'exp_each' => $expEach,
                'exp_24h' => $expEach ? $expEach * (int) $row->day_killed : null,
                'exp_7d' => $expEach ? $expEach * (int) $row->week_killed : null,
                'level_24h' => $expEach ? TibiaExp::levelForExp($expEach * (int) $row->day_killed) : null,
                'level_7d' => $expEach ? TibiaExp::levelForExp($expEach * (int) $row->week_killed) : null,
            ];
        }

        // Daily trend across all worlds (kill_daily retains ~30 days).
        $series = DB::table('kill_daily')
            ->where('race_id', $race->id)
            ->groupBy('snapshot_date')
            ->select([
                DB::raw('snapshot_date'),
                DB::raw('SUM(day_players_killed) AS players_killed'),
                DB::raw('SUM(day_killed) AS killed'),
            ])
            ->orderBy('snapshot_date')
            ->get()
            ->map(fn ($r) => [
                'period' => substr((string) $r->snapshot_date, 0, 10),
                'players_killed' => (int) $r->players_killed,
                'killed' => (int) $r->killed,
            ]);

        return response()->json([
            'linked' => true,
            'race' => $race->name,
            'latest' => $latest,
            'series' => $series,
        ]);
    }

    /**
     * Ranking of creatures by EXPERIENCE handed out (killed × exp-per-kill).
     * Also reports the level a fresh character would reach from that XP.
     *
     * Query: world=all|<Name>, window=day|week, limit=20.
     */
    public function experience(Request $request): JsonResponse
    {
        $world = (string) $request->string('world', 'all');
        $window = (string) $request->string('window', 'week') === 'day' ? 'day' : 'week';
        $limit = min(max($request->integer('limit', 20), 1), 100);
        $worldId = $world !== 'all' ? TibiaWorld::where('name', $world)->value('id') : null;
        $killCol = $window === 'day' ? 'day_killed' : 'week_killed';

        $latest = DB::table('kill_daily')
            ->when($worldId, fn ($q) => $q->where('world_id', $worldId))
            ->max('snapshot_date');

        $rows = DB::table('kill_daily as kd')
            ->join('tibia_races as r', 'r.id', '=', 'kd.race_id')
            ->join('entries as e', 'e.id', '=', 'r.entry_id')
            ->where('kd.snapshot_date', $latest)
            ->whereNotNull(DB::raw("(e.meta->>'experience')"))
            ->whereRaw("(e.meta->>'experience') ~ '^[0-9]+$'")
            ->when($worldId, fn ($q) => $q->where('kd.world_id', $worldId))
            ->groupBy('r.name', 'e.slug', 'e.primary_image', DB::raw("(e.meta->>'experience')"))
            ->select([
                'r.name as race',
                'e.slug',
                'e.primary_image as image',
                DB::raw("(e.meta->>'experience')::bigint AS exp_each"),
                DB::raw("SUM(kd.{$killCol}) AS killed"),
                DB::raw("(e.meta->>'experience')::bigint * SUM(kd.{$killCol}) AS exp_total"),
            ])
            ->orderByDesc('exp_total')
            ->limit($limit)
            ->get();

        return response()->json([
            'window' => $window,
            'world' => $world,
            'data' => $rows->map(fn ($r) => [
                'race' => $r->race,
                'slug' => $r->slug,
                'image' => $r->image,
                'exp_each' => (int) $r->exp_each,
                'killed' => (int) $r->killed,
                'exp_total' => (int) $r->exp_total,
                'level' => TibiaExp::levelForExp((float) $r->exp_total),
            ]),
        ]);
    }

    /**
     * Boss respawn tracker. For a boss creature, returns per-world recency of
     * kills and an estimate of when it tends to come back.
     *
     * Honest about data: the API exposes only rolling windows, so exact kill
     * dates accrue from our own daily snapshots. Until enough history exists we
     * bucket each world by "killed in last 24h / 2-7d / 7d+"; the empirical
     * respawn-interval curve fills in as snapshots accumulate.
     */
    public function boss(string $slug): JsonResponse
    {
        $race = DB::table('tibia_races as r')
            ->join('entries as e', 'e.id', '=', 'r.entry_id')
            ->where('e.slug', $slug)
            ->select('r.id', 'r.name', DB::raw("(e.meta->>'rank') AS rank"))
            ->first();

        if (! $race) {
            return response()->json(['linked' => false, 'race' => null]);
        }

        $today = Carbon::today();
        $latestDate = DB::table('kill_daily')->where('race_id', $race->id)->max('snapshot_date');

        // Last-known kill date per world from accumulated history (a past day
        // with day_killed>0). Improves as snapshots pile up.
        $lastKills = DB::table('kill_daily')
            ->where('race_id', $race->id)
            ->where('day_killed', '>', 0)
            ->groupBy('world_id')
            ->select('world_id', DB::raw('MAX(snapshot_date) AS last_kill'))
            ->pluck('last_kill', 'world_id');

        // Current rolling-window status from the latest snapshot.
        $current = DB::table('kill_daily as kd')
            ->join('tibia_worlds as w', 'w.id', '=', 'kd.world_id')
            ->where('kd.race_id', $race->id)
            ->where('kd.snapshot_date', $latestDate)
            ->select('w.id as world_id', 'w.name', 'kd.day_killed', 'kd.week_killed')
            ->get();

        $worlds = $current->map(function ($w) use ($lastKills, $today) {
            $lastKill = $lastKills[$w->world_id] ?? null;
            $daysSince = $lastKill ? $today->diffInDays(Carbon::parse($lastKill)) : null;

            // Status bucket: prefer the precise history date, else infer from the
            // rolling windows of the latest snapshot.
            if ($w->day_killed > 0) {
                $status = 'cooldown';        // killed within last 24h
            } elseif ($w->week_killed > 0) {
                $status = 'recent';          // killed 2-7 days ago
            } else {
                $status = 'due';             // not killed in 7+ days → likely up
            }

            return [
                'world' => $w->name,
                'status' => $status,
                'last_kill' => $lastKill,
                'days_since' => $daysSince,
            ];
        })
        // Most "due" first (long quiet → likely available), then recent, cooldown.
        ->sortBy(fn ($w) => ['due' => 0, 'recent' => 1, 'cooldown' => 2][$w['status']])
        ->values();

        $summary = [
            'worlds_total' => $worlds->count(),
            'cooldown' => $worlds->where('status', 'cooldown')->count(),
            'recent' => $worlds->where('status', 'recent')->count(),
            'due' => $worlds->where('status', 'due')->count(),
        ];

        // Empirical respawn-interval distribution: consecutive kill dates per
        // world, pooled. Needs history; returns method='collecting' until then.
        $respawn = $this->respawnModel($race->id);

        return response()->json([
            'linked' => true,
            'race' => $race->name,
            'is_boss' => $race->rank === 'Boss',
            'latest_date' => $latestDate,
            'summary' => $summary,
            'worlds' => $worlds,
            'respawn' => $respawn,
        ]);
    }

    /**
     * Build the empirical kill-to-kill interval distribution for a race across
     * all worlds and return a CDF (P(reappeared within d days of a kill)).
     */
    private function respawnModel(int $raceId): array
    {
        $events = DB::table('kill_daily')
            ->where('race_id', $raceId)
            ->where('day_killed', '>', 0)
            ->orderBy('world_id')
            ->orderBy('snapshot_date')
            ->get(['world_id', 'snapshot_date']);

        // Group dates per world, diff consecutive ones.
        $byWorld = [];
        foreach ($events as $e) {
            $byWorld[$e->world_id][] = Carbon::parse($e->snapshot_date);
        }
        $intervals = [];
        foreach ($byWorld as $dates) {
            for ($i = 1; $i < count($dates); $i++) {
                $intervals[] = $dates[$i - 1]->diffInDays($dates[$i]);
            }
        }

        if (count($intervals) < 8) {
            return ['method' => 'collecting', 'sample_size' => count($intervals), 'cdf' => []];
        }

        sort($intervals);
        $n = count($intervals);
        $min = $intervals[0];
        $median = $intervals[intdiv($n, 2)];
        $max = end($intervals);

        // CDF over 1..max days.
        $cdf = [];
        for ($d = 1; $d <= $max; $d++) {
            $count = 0;
            foreach ($intervals as $v) {
                if ($v <= $d) {
                    $count++;
                }
            }
            $cdf[] = ['day' => $d, 'prob' => round($count / $n, 3)];
        }

        return [
            'method' => 'empirical',
            'sample_size' => $n,
            'min_days' => $min,
            'median_days' => $median,
            'max_days' => $max,
            'cdf' => $cdf,
        ];
    }

    /** Validate the requested metric against the allow-list. */
    private function metric(Request $request): string
    {
        $m = (string) $request->string('metric', 'players_killed');

        return in_array($m, self::METRICS, true) ? $m : 'players_killed';
    }
}
