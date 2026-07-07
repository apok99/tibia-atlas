<?php

namespace App\Transformers\KillStats;

use Illuminate\Support\Collection;

/**
 * Shapes a time-series point {period, players_killed, killed}. Reused by every
 * kill chart; the period is truncated to the requested precision (YYYY-MM for
 * monthly, YYYY-MM-DD for daily, YYYY-MM-DD HH:MM for hourly).
 */
class KillPointTransformer
{
    public const MONTH = 7;

    public const DAY = 10;

    /**
     * @param  Collection<int, \stdClass>  $rows
     * @return Collection<int, array<string, mixed>>
     */
    public function collection(Collection $rows, int $precision = self::DAY): Collection
    {
        return $rows->map(fn ($r) => [
            'period' => substr((string) $r->period, 0, $precision),
            'players_killed' => (int) $r->players_killed,
            'killed' => (int) $r->killed,
        ])->values();
    }
}
