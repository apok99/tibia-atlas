<?php

namespace App\Transformers\KillStats;

use Illuminate\Support\Collection;

/**
 * Turns raw raid-boss roster rows into the Raid Boss Watch payload: derives the
 * spawn "temperature" (heat 0-100), buckets each boss's worlds, and orders
 * iconic bosses (by fame) first, then the rest by heat.
 */
class BossWatchTransformer
{
    /**
     * @param  Collection<int, \stdClass>  $rows
     * @param  list<string>  $iconic  lowercased iconic boss names (order = fame rank)
     * @param  string|null  $world  when given, heat/status is scoped to this single
     *                              world (see {@see BossWatchQuery::rows()}).
     * @return Collection<int, array<string, mixed>>
     */
    public function collection(Collection $rows, array $iconic, int $limit, string $type = 'raid', ?string $world = null): Collection
    {
        $mapped = $rows
            // Raid bosses are proper nouns ("Orshabaal"); killstats names common
            // summoned adds in lowercase plural ("glooth bombs") — drop those.
            ->filter(fn ($r) => mb_strtolower($r->race) !== $r->race)
            ->map(fn ($r) => $this->shape($r, $iconic, $world));

        if ($type === 'daily') {
            // Daily bosses: killed (<24h) in most of the worlds they appear in,
            // ordered by how many were defeated today.
            return $mapped
                ->filter(fn ($b) => $b['worlds_active'] >= 10 && $b['cooldown'] / max(1, $b['worlds_active']) >= 0.6)
                ->sortByDesc('day_killed')
                ->take($limit)
                ->values();
        }

        return $mapped
            // Iconic world bosses by fame (Orshabaal, Morgaroth, Ghazbaran,
            // Ferumbras…) first so they always surface; then the rest by heat.
            ->sortBy(fn ($b) => [$b['rank'], -$b['heat'], -$b['week_killed']])
            ->take($limit)
            ->values();
    }

    /**
     * @param  list<string>  $iconic
     * @return array<string, mixed>
     */
    private function shape(\stdClass $r, array $iconic, ?string $world = null): array
    {
        $worlds = max(1, (int) $r->worlds_active);
        $cooldown = (int) $r->cooldown;          // killed in last 24h
        $weekWorlds = (int) $r->week_worlds;     // killed in last 7d
        // Spawn "temperature": worlds where it wasn't killed in 24h.
        $heat = (int) round(100 * ($worlds - $cooldown) / $worlds);

        // Worlds shown under the boss: where it just died (cold) or where it's
        // quiet today and so likely up (hot).
        $list = $cooldown > 0
            ? array_filter(explode(',', (string) $r->cooldown_worlds))
            : array_filter(explode(',', (string) $r->open_worlds));

        // Scoped to a single world: heat = respawn progress there. Days since
        // the last recorded kill on that world, against the boss's estimated
        // per-world respawn cycle (from its real global kill rate: a boss killed
        // 15×/week across 22 worlds respawns every ~10 days per world). A rare
        // boss killed 2 days ago reads ~20 ("just killed"), NOT "likely up";
        // a daily boss is back to 100 the next day. Never killed there → null:
        // no anchor, no fabricated probability (the UI says "no data").
        if ($world !== null) {
            $days = $r->world_days_since ?? null;
            if ($days === null) {
                $heat = null;
            } else {
                $cycle = max(1.0, min(30.0, 7.0 * $worlds / max(1, (int) $r->week_killed)));
                $heat = (int) min(100, round(100 * max(0, (int) $days) / $cycle));
            }
            $list = [$world];
        }

        // Fame rank (position in the iconic list) so the famous ones come first
        // in their squad regardless of how (in)active they are.
        $rank = array_search(mb_strtolower($r->race), $iconic, true);

        return [
            'race' => $r->race,
            'slug' => $r->slug,
            'image' => $r->image,
            'worlds_active' => (int) $r->worlds_active,
            'cooldown' => $cooldown,                       // killed <24h (cold)
            'recent' => max(0, $weekWorlds - $cooldown),   // killed 2-7d ago
            'due' => max(0, (int) $r->worlds_active - $weekWorlds), // not killed in 7d → likely up
            'day_killed' => (int) $r->day_killed,
            'week_killed' => (int) $r->week_killed,
            'heat' => $heat,
            'worlds' => array_values($list),
            'iconic' => $rank !== false,
            'rank' => $rank === false ? 999 : $rank,
        ];
    }
}
