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
     * World-scoped heat ceiling for Raid bosses. They spawn via server-wide raids
     * CipSoft triggers, not a per-world respawn timer, so "days since last kill"
     * can never promise one is up — cap below the frontend's "likely up" threshold
     * (66) so the strongest a raid boss reads is "maybe up", never a flat "alive".
     */
    private const RAID_WORLD_HEAT_CAP = 65;

    /**
     * Longest respawn cycle we will estimate, in days. Orshabaal — killed ~twice a
     * week across all of Tibia — models out to ~325 days, so the old 30-day ceiling
     * silently flattened every truly rare boss into "due next week".
     */
    private const MAX_CYCLE_DAYS = 365.0;

    /**
     * Floor for a world-scoped reading with no recorded kill on that world. All we
     * know is "not killed here in the whole window" — a lower bound on days-since —
     * so the reading may be under-stated but can never mean "just killed". Sits on
     * the frontend's "maybe up" threshold (33).
     */
    private const UNANCHORED_MIN_HEAT = 33;

    /**
     * @param  Collection<int, \stdClass>  $rows
     * @param  list<string>  $iconic  lowercased iconic boss names (order = fame rank)
     * @param  string|null  $world  when given, heat/status is scoped to this single
     *                              world (see {@see BossWatchQuery::rows()}).
     * @param  int  $worldCount  worlds the snapshot covers — the cycle denominator.
     * @return Collection<int, array<string, mixed>>
     */
    public function collection(Collection $rows, array $iconic, int $limit, string $type = 'raid', ?string $world = null, int $worldCount = 1): Collection
    {
        $mapped = $rows
            // Proper bosses are proper nouns ("Orshabaal"); killstats names summoned
            // adds in lowercase plural ("glooth bombs", "dark souls"), and a batch of
            // those carry a wrong `isboss` flag on the wiki — drop them. The
            // heuristic applies ONLY to the isboss path: entries admitted by their
            // Unique spawntype are genuine one-at-a-time spawns that killstats
            // happens to name in lowercase too ("midnight panthers").
            ->reject(fn ($r) => $r->rank === 'Boss' && mb_strtolower($r->race) === $r->race)
            ->map(fn ($r) => $this->shape($r, $iconic, $world, $worldCount));

        // 'all' shares the raid ordering below (fame first, then heat) — it only
        // differs upstream, in which bosses the query lets through.
        if ($type === 'daily') {
            // Daily bosses: killed (<24h) in most of the worlds they appear in,
            // ordered by how many were defeated today.
            return $mapped
                ->filter(fn ($b) => $b['worlds_active'] >= 10 && $b['cooldown'] / max(1, $b['worlds_active']) >= 0.6)
                // Scoped to one world: the "is it a daily boss" test above stays
                // cross-world (that's what makes it a daily boss at all), but the
                // roster only keeps the ones that world actually reports, ordered
                // by kills THERE.
                ->when($world !== null, fn ($c) => $c->filter(fn ($b) => $b['world_present'] || $b['world_anchored']))
                ->sortByDesc($world === null ? 'day_killed' : 'world_day_killed')
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
     * Does this boss enter the world through a raid rather than a per-world
     * respawn timer? True for TibiaWiki spawntype "Raid" and for the iconic world
     * bosses (whose spawntype may not be backfilled yet).
     *
     * `spawn_type` arrives as raw JSON and comes in two shapes: the normalised
     * list (["Raid","Unique"]) and a legacy plain string ("Raid, Unique") still
     * present on most entries — decode both, since a string would otherwise blow
     * up in_array().
     *
     * @param  list<string>  $iconic
     */
    private function isRaidBoss(\stdClass $r, array $iconic): bool
    {
        if (in_array(mb_strtolower($r->race), $iconic, true)) {
            return true;
        }

        $decoded = json_decode((string) ($r->spawn_type ?? ''), true);
        $types = match (true) {
            is_array($decoded) => $decoded,
            is_string($decoded) => preg_split('/[,\/]/', $decoded) ?: [],
            default => [],
        };

        foreach ($types as $type) {
            if (strcasecmp(trim((string) $type), 'Raid') === 0) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  list<string>  $iconic
     * @return array<string, mixed>
     */
    private function shape(\stdClass $r, array $iconic, ?string $world = null, int $worldCount = 1): array
    {
        $worlds = max(1, (int) $r->worlds_active);
        $cooldown = (int) $r->cooldown;          // killed in last 24h
        $weekWorlds = (int) $r->week_worlds;     // killed in last 7d
        // Spawn "temperature": worlds where it wasn't killed in 24h.
        $heat = (int) round(100 * ($worlds - $cooldown) / $worlds);
        // Kept aside as the network-wide reading. It is no longer a fallback for
        // world-scoped rows (those now always answer for their own world, see
        // below) — it stays in the payload for unscoped views and comparisons.
        $globalHeat = $heat;

        // Worlds shown under the boss: where it just died (cold) or where it's
        // quiet today and so likely up (hot).
        $list = $cooldown > 0
            ? array_filter(explode(',', (string) $r->cooldown_worlds))
            : array_filter(explode(',', (string) $r->open_worlds));

        // Scoped to a single world: heat = respawn progress there. Days since the
        // last recorded kill on that world, against the boss's estimated per-world
        // respawn cycle, derived from its real kill rate across ALL of Tibia: a
        // boss killed 9×/week network-wide, on 93 worlds, comes round every ~72
        // days on any one of them. A rare boss killed 2 days ago reads ~3 ("just
        // killed"), NOT "likely up"; a daily boss is back to 100 the next day.
        // Never killed there → the window length is used as a lower bound on
        // days-since (see below), so the row still reads for the selected world.
        //
        // The denominator is the WORLD COUNT, never the boss's own worlds_active
        // ({@see BossWatchQuery::worldCount()}) — that field only counts worlds
        // that reported a kill, so using it made the estimate scale backwards:
        // the rarer the boss, the fewer worlds report it, the shorter its cycle
        // came out. Ferumbras read 7 days (really ~72) and Orshabaal 7 (really
        // ~325), so every rare boss pinned to heat 100 the week after it died.
        $anchored = false;
        if ($world !== null) {
            $days = $r->world_days_since ?? null;
            // Never killed on this world inside our window? That is still a reading
            // FOR THIS WORLD, not a blank: days-since is at least the whole window.
            // We use that lower bound rather than borrowing the network-wide number,
            // so a world-scoped row always speaks about the world the user picked.
            $anchored = $days !== null;
            if (! $anchored) {
                $days = (int) ($r->window_days ?? 0);
            }
            // The chip names THIS world — the reading is about it, anchored or not.
            $list = [$world];
            $cycle = max(1.0, min(self::MAX_CYCLE_DAYS, 7.0 * max(1, $worldCount) / max(1, (int) $r->week_killed)));
            $heat = (int) min(100, round(100 * max(0, (int) $days) / $cycle));
            // A lower bound can only ever push the reading UP. Without a kill here
            // the true days-since is ≥ the window, so the honest floor is "maybe
            // up" — reporting a rare boss as just-killed on a world where we have
            // no kill at all would be the one thing the data rules out.
            if (! $anchored) {
                $heat = max($heat, self::UNANCHORED_MIN_HEAT);
            }
            // Raid bosses (TibiaWiki spawntype "Raid", plus the famous iconic
            // ones whose spawntype may be untagged) don't follow a per-world
            // respawn timer — a week without a recorded kill can't mean "up".
            // Cap their confidence at "maybe" so the strip never fabricates a
            // flat "likely up" from one stale data point.
            if ($this->isRaidBoss($r, $iconic)) {
                $heat = min($heat, self::RAID_WORLD_HEAT_CAP);
            }
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
            'heat_global' => $globalHeat,
            // World-scoped reading, null when the request wasn't scoped. Additive on
            // purpose: the fields above stay cross-world so the map rail (which
            // deliberately falls back to the network-wide reading) is unchanged,
            // while the dashboard can filter and count by the selected world.
            'world' => $world,
            'world_present' => $world === null ? null : (bool) ($r->world_present ?? false),
            // Is the reading backed by a kill recorded on that world, or only by
            // "never killed here in our window"? Consumers that need a strict
            // "this world tracks this boss" test use it — `heat` no longer goes
            // null under a world scope, so it can't answer that question.
            'world_anchored' => $world === null ? null : $anchored,
            'world_day_killed' => $world === null ? null : (int) ($r->world_day_killed ?? 0),
            'world_week_killed' => $world === null ? null : (int) ($r->world_week_killed ?? 0),
            'worlds' => array_values($list),
            'iconic' => $rank !== false,
            'rank' => $rank === false ? 999 : $rank,
        ];
    }
}
