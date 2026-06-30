<?php

namespace App\Services\KillStats;

use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Builds the empirical kill-to-kill respawn-interval distribution for a race
 * across all worlds and returns a CDF (P(reappeared within d days of a kill)).
 * Honest about data: returns method='collecting' until enough history exists.
 */
class RespawnAnalyzer
{
    /** Minimum number of observed intervals before a curve is meaningful. */
    private const MIN_SAMPLE = 8;

    /**
     * @param  Collection<int, \stdClass>  $events  {world_id, snapshot_date}, world+date ordered
     * @return array<string, mixed>
     */
    public function model(Collection $events): array
    {
        $intervals = $this->intervals($events);

        if (count($intervals) < self::MIN_SAMPLE) {
            return ['method' => 'collecting', 'sample_size' => count($intervals), 'cdf' => []];
        }

        sort($intervals);
        $n = count($intervals);
        $max = (int) end($intervals);

        return [
            'method' => 'empirical',
            'sample_size' => $n,
            'min_days' => $intervals[0],
            'median_days' => $intervals[intdiv($n, 2)],
            'max_days' => $max,
            'cdf' => $this->cdf($intervals, $max, $n),
        ];
    }

    /**
     * Consecutive kill-date gaps (in days), pooled across worlds.
     *
     * @param  Collection<int, \stdClass>  $events
     * @return list<int>
     */
    private function intervals(Collection $events): array
    {
        $byWorld = [];
        foreach ($events as $e) {
            $byWorld[$e->world_id][] = Carbon::parse($e->snapshot_date);
        }

        $intervals = [];
        foreach ($byWorld as $dates) {
            for ($i = 1; $i < count($dates); $i++) {
                $intervals[] = (int) $dates[$i - 1]->diffInDays($dates[$i]);
            }
        }

        return $intervals;
    }

    /**
     * CDF over 1..max days: the share of intervals no longer than each day.
     *
     * @param  list<int>  $intervals  pre-sorted ascending
     * @return list<array{day: int, prob: float}>
     */
    private function cdf(array $intervals, int $max, int $n): array
    {
        $cdf = [];
        $cursor = 0;
        // Single pass: intervals are sorted, so advance a running count as the
        // day threshold rises instead of rescanning the whole array each day.
        for ($d = 1; $d <= $max; $d++) {
            while ($cursor < $n && $intervals[$cursor] <= $d) {
                $cursor++;
            }
            $cdf[] = ['day' => $d, 'prob' => round($cursor / $n, 3)];
        }

        return $cdf;
    }
}
