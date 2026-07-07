<?php

namespace App\Transformers\KillStats;

use App\Support\TibiaExp;

/**
 * Shapes the "latest" 24h/7d block for a creature's kill-stats panel, including
 * the experience yield and the level it represents (when the creature's per-kill
 * experience is known).
 */
class CreatureKillStatsTransformer
{
    /**
     * @return array<string, mixed>
     */
    public function latest(string $date, \stdClass $row, ?int $expEach): array
    {
        $dayKilled = (int) $row->day_killed;
        $weekKilled = (int) $row->week_killed;

        return [
            'date' => $date,
            'players_killed' => (int) $row->day_players_killed,
            'killed' => $dayKilled,
            'week_players_killed' => (int) $row->week_players_killed,
            'week_killed' => $weekKilled,
            'exp_each' => $expEach,
            'exp_24h' => $expEach ? $expEach * $dayKilled : null,
            'exp_7d' => $expEach ? $expEach * $weekKilled : null,
            'level_24h' => $expEach ? TibiaExp::levelForExp($expEach * $dayKilled) : null,
            'level_7d' => $expEach ? TibiaExp::levelForExp($expEach * $weekKilled) : null,
        ];
    }

    /**
     * Popularity block: where this creature ranks by creatures slain (7d)
     * among every race hunted on the latest snapshot.
     *
     * @return array<string, mixed>|null
     */
    public function popularity(?\stdClass $row): ?array
    {
        if (! $row || $row->total < 1) {
            return null;
        }

        return [
            'rank' => $row->rank,
            'total' => $row->total,
            'top_percent' => max(1, (int) ceil($row->rank / $row->total * 100)),
        ];
    }
}
