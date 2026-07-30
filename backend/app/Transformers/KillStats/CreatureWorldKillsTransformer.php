<?php

namespace App\Transformers\KillStats;

use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Shapes the map's "kill pulse" for one creature on ONE world: yesterday's
 * tally, the rolling 30-day window, and the daily bars in between.
 *
 * Two things make this different from the entry page's panel:
 *  - It is world-scoped, so every figure also carries the share of the
 *    network-wide total that happened on the chosen world.
 *  - It never reads TODAY. The ETL rewrites today's row every hour, so today is
 *    a partial 24h window; "yesterday" means the newest SEALED snapshot, and
 *    the 30-day window ends there too.
 */
class CreatureWorldKillsTransformer
{
    /** How many sealed days the rolling window spans (kill_daily retains ~30). */
    public const WINDOW_DAYS = 30;

    public function __construct(private KillPointTransformer $points) {}

    /**
     * @param  Collection<int, \stdClass>  $rows  world-scoped daily rows
     * @param  Collection<int, \stdClass>  $globalRows  the same race across every world
     * @param  bool  $scoped  false when the caller asked for "all worlds" (no share)
     * @return array<string, mixed>
     */
    public function build(Collection $rows, Collection $globalRows, Carbon $today, bool $scoped = true): array
    {
        $series = $this->points->collection($rows, KillPointTransformer::DAY);
        $global = $this->points->collection($globalRows, KillPointTransformer::DAY);
        $todayStr = $today->toDateString();

        // The ETL's calendar, not the world's: a world where this race is never
        // hunted has no rows at all, and must still report a dated zero.
        $sealed = $global->filter(fn ($p) => $p['period'] < $todayStr)->values();
        $date = $sealed->last()['period'] ?? $global->last()['period'] ?? null;

        if ($date === null) {
            return ['yesterday' => null, 'month' => null, 'best' => null, 'series' => []];
        }

        $from = Carbon::parse($date)->subDays(self::WINDOW_DAYS - 1)->toDateString();
        $inWindow = fn (Collection $c) => $c->filter(fn ($p) => $p['period'] >= $from && $p['period'] <= $date)->values();

        $window = $inWindow($series);
        $globalWindow = $inWindow($global);

        $day = $series->firstWhere('period', $date);
        $globalDay = $global->firstWhere('period', $date);

        $killed = (int) $window->sum('killed');
        $globalKilled = (int) $globalWindow->sum('killed');
        // Snapshots actually on disk for the window — the honest divisor for a
        // daily average (a fresh install has fewer than 30).
        $days = max(1, $globalWindow->count());

        $best = $window->sortByDesc('killed')->first();

        return [
            'yesterday' => [
                'date' => $date,
                'killed' => (int) ($day['killed'] ?? 0),
                'players_killed' => (int) ($day['players_killed'] ?? 0),
                'share' => $scoped ? $this->share((int) ($day['killed'] ?? 0), (int) ($globalDay['killed'] ?? 0)) : null,
                'all_worlds' => (int) ($globalDay['killed'] ?? 0),
            ],
            'month' => [
                'from' => $from,
                'to' => $date,
                'days' => $days,
                'killed' => $killed,
                'players_killed' => (int) $window->sum('players_killed'),
                'per_day' => (int) round($killed / $days),
                'share' => $scoped ? $this->share($killed, $globalKilled) : null,
                'all_worlds' => $globalKilled,
            ],
            'best' => $best && $best['killed'] > 0
                ? ['date' => $best['period'], 'killed' => (int) $best['killed']]
                : null,
            'series' => $window,
        ];
    }

    /** Percent of the network-wide total that happened on this world (1-100). */
    private function share(int $part, int $total): ?int
    {
        if ($total <= 0 || $part <= 0) {
            return null;
        }

        return max(1, (int) round($part / $total * 100));
    }
}
