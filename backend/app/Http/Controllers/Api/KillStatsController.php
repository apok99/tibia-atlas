<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\KillStats\KillStatsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public, read-only access to the TibiaData kill-statistics warehouse populated
 * by the `tibia:etl-killstats` command. Powers the "Estadísticas" dashboard.
 *
 * Controllers stay thin: they validate/normalise the HTTP input and hand off to
 * {@see KillStatsService}, which assembles each payload via queries + transformers.
 */
class KillStatsController extends Controller
{
    public function __construct(private KillStatsService $stats) {}

    /** Dashboard header numbers + the latest snapshot date. */
    public function meta(): JsonResponse
    {
        return response()->json($this->stats->meta());
    }

    /** World list for the selector (most populated first). */
    public function worlds(): JsonResponse
    {
        return response()->json($this->stats->worlds());
    }

    /**
     * Ranking of the deadliest (or most-killed) races.
     *
     * Query: world=all|<Name>, metric=players_killed|killed,
     *        window=day|week|month|year, limit=20.
     */
    public function ranking(Request $request): JsonResponse
    {
        return response()->json($this->stats->ranking(
            window: (string) $request->string('window', 'day'),
            world: (string) $request->string('world', 'all'),
            metric: $this->metric($request),
            limit: $this->clamp($request, 'limit', 20, 1, 100),
        ));
    }

    /**
     * Time series for a single race.
     *
     * Query: race=<Name> (required), world=all|<Name>, granularity=month|day.
     */
    public function series(Request $request): JsonResponse
    {
        $race = trim((string) $request->string('race'));
        if ($race === '') {
            return response()->json(['message' => 'race is required'], 422);
        }

        return response()->json($this->stats->series(
            race: $race,
            world: (string) $request->string('world', 'all'),
            granularity: (string) $request->string('granularity', 'month') === 'day' ? 'day' : 'month',
        ));
    }

    /**
     * Kill stats for a single lore entry (creature), resolved via its linked
     * race. Powers the mini kill-stats panel on the entry page.
     */
    public function entry(string $slug): JsonResponse
    {
        return response()->json($this->stats->entry($slug));
    }

    /**
     * Kill pulse for one creature on ONE world — yesterday + the rolling 30
     * days, with daily bars. Powers the map's per-creature stats popover.
     *
     * Query: world=all|<Name>.
     */
    public function creature(Request $request, string $slug): JsonResponse
    {
        $world = trim((string) $request->string('world', 'all'));

        return response()->json($this->stats->creatureWorld($slug, $world === '' ? 'all' : $world));
    }

    /**
     * Ranking of creatures by EXPERIENCE handed out (killed × exp-per-kill).
     *
     * Query: world=all|<Name>, window=day|week, limit=20.
     */
    public function experience(Request $request): JsonResponse
    {
        return response()->json($this->stats->experience(
            window: (string) $request->string('window', 'week') === 'day' ? 'day' : 'week',
            world: (string) $request->string('world', 'all'),
            limit: $this->clamp($request, 'limit', 20, 1, 100),
        ));
    }

    /** Global overview for the dashboard hero (totals, activity series, population). */
    public function overview(Request $request): JsonResponse
    {
        return response()->json($this->stats->overview(
            world: (string) $request->string('world', 'all'),
        ));
    }

    /**
     * RAID-boss roster for the "Raid Boss Watch" module, with a spawn
     * "temperature" (heat 0-100 = probability it is up / about to spawn).
     *
     * Query: limit (1-600, default 24), type=raid|daily|all, world=all|<Name>.
     * A specific world scopes each boss's heat/status to that world.
     *
     * type=all drops the rarity cut and returns every tracked boss (~400) — what
     * the map's boss rail needs. Both narrower buckets ('raid' ≤60 worlds,
     * 'daily' ≥10) are dashboard cuts, and 'raid' hid 228 tracked bosses from the
     * rail, which then rendered them as "no recent spawn data" permanently.
     */
    public function bosses(Request $request): JsonResponse
    {
        $world = trim((string) $request->string('world', 'all'));
        $type = (string) $request->string('type', 'raid');

        return response()->json($this->stats->bosses(
            limit: $this->clamp($request, 'limit', 24, 1, 600),
            type: in_array($type, ['daily', 'all'], true) ? $type : 'raid',
            world: ($world === '' || $world === 'all') ? null : $world,
        ));
    }

    /** Boss respawn tracker: per-world kill recency + an estimated respawn curve. */
    public function boss(string $slug): JsonResponse
    {
        return response()->json($this->stats->boss($slug));
    }

    /** Validate the requested metric against the allow-list. */
    private function metric(Request $request): string
    {
        $metric = (string) $request->string('metric', 'players_killed');
        $allowed = config('killstats.metrics');

        return in_array($metric, $allowed, true) ? $metric : 'players_killed';
    }
}
