<?php

namespace App\Support;

/**
 * The one definition of "counts as a boss in the Boss Watch", shared by the
 * glossary (which fills the map's boss rail) and the kill-stats warehouse (which
 * gives each one its heat and respawn curve). The two used to disagree, so the
 * rail listed creatures the tracker then refused to track — they showed up with
 * no status and no respawn panel (Midnight Panther).
 *
 * Two kinds qualify:
 *  - proper bosses — TibiaWiki's `isboss` flag, imported as meta.rank = 'Boss';
 *  - unique rare spawns — no `isboss` flag, but a 'Unique' spawntype means only
 *    one exists at a time (Midnight Panther, Tremor Worm, Undead Cavebear…) and
 *    players hunt them like bosses.
 *
 * Deliberately NOT spawntype 'Raid': that only says a creature can *join* a
 * raid, which is equally true of rabbits, bats and bears — matching on it once
 * put 42 ordinary creatures in the boss rail.
 */
class BossRule
{
    /**
     * SQL predicate over an `entries` alias.
     *
     * The LIKE matches both shapes meta.spawn_type comes in: the normalised list
     * (["Raid","Unique"]) and the legacy comma-string ("Raid, Unique").
     */
    public static function sql(string $alias = 'entries'): string
    {
        return "({$alias}.meta->>'rank' = 'Boss' OR {$alias}.meta->>'spawn_type' LIKE '%Unique%')";
    }

    /** The same rule for a row that already carries `rank` + `spawn_type`. */
    public static function matches(?string $rank, ?string $spawnType): bool
    {
        return $rank === 'Boss' || str_contains((string) $spawnType, 'Unique');
    }
}
