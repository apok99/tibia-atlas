<?php

namespace App\Support;

/**
 * Tibia experience maths. The cumulative experience required to *reach* a level
 * follows CipSoft's closed-form cubic, so we don't need the (3500-row) table:
 *
 *   exp(L) = (50/3) · (L³ − 6L² + 17L − 12)
 *
 * Verified against the official table (L=2 → 100, L=8 → 4 200, …).
 */
final class TibiaExp
{
    /** Cumulative experience needed to be a given level (level 1 = 0). */
    public static function expForLevel(int $level): float
    {
        if ($level <= 1) {
            return 0.0;
        }
        $l = (float) $level;

        return (50.0 / 3.0) * ($l ** 3 - 6 * $l ** 2 + 17 * $l - 12);
    }

    /**
     * Highest level reachable from scratch with the given total experience —
     * i.e. "this much XP would take a character from 0 to level N".
     */
    public static function levelForExp(float $exp): int
    {
        if ($exp < 100) {
            return 1;
        }
        // Binary search; the cubic is monotonic. Upper bound is generous —
        // aggregated weekly XP across 90 worlds can be astronomical.
        $lo = 1;
        $hi = 200_000;
        while ($lo < $hi) {
            $mid = intdiv($lo + $hi + 1, 2);
            if (self::expForLevel($mid) <= $exp) {
                $lo = $mid;
            } else {
                $hi = $mid - 1;
            }
        }

        return $lo;
    }
}
