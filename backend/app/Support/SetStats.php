<?php

namespace App\Support;

/**
 * Aggregate a worn equipment set (a list of item `meta` arrays) into the
 * combat profile of whoever wears it: total armor, per-element resistances,
 * the damage elements they can deal, summed skill bonuses and the weapon's
 * identity.
 *
 * Extracted so the Hunt Finder's synthesized best-in-slot set and the map's
 * "your character" REAL gear (the set the user picks by hand) go through the
 * exact same math — the stats the character card displays are the stats the
 * zone ranking actually assumes.
 */
final class SetStats
{
    /** The elements a player can realistically deal / take. */
    public const ELEMENTS = ['physical', 'fire', 'energy', 'ice', 'earth', 'death', 'holy'];

    /**
     * Spell schools each vocation can exploit regardless of weapon (runes/spells
     * a real hunter carries). The weapon's own element is added on top. This is
     * why a druid is credited for ice/earth even holding a plain rod.
     */
    public const VOCATION_ELEMENTS = [
        'knight' => ['physical'],
        'paladin' => ['physical', 'holy'],
        'sorcerer' => ['energy', 'fire', 'death'],
        'druid' => ['ice', 'earth', 'energy'],
        'monk' => ['physical', 'holy'],
    ];

    /**
     * Scale the UI draws resist bars against — NOT a cap: protections compound,
     * they are never clamped.
     */
    public const RESIST_SCALE = 60;

    /**
     * Sum what a set of worn items gives its wearer. `$metas` holds one item
     * meta per worn piece (at most one per slot — the caller enforces that).
     *
     * @param  list<array<string, mixed>>  $metas
     * @return array{
     *     elements: list<string>,
     *     resists: array<string, float>,
     *     armor: int,
     *     bonuses: array<string, int>,
     *     weapon_meta: ?array<string, mixed>,
     * }
     */
    public static function aggregate(array $metas, string $vocation): array
    {
        $resistFactors = [];
        $bonuses = [];
        $armor = 0;
        $weaponMeta = null;
        foreach ($metas as $meta) {
            $armor += (int) ($meta['armor'] ?? 0);
            foreach ((array) ($meta['resists'] ?? []) as $el => $pct) {
                // Tibia applies each piece's protection to whatever the previous
                // piece let through — protections do NOT add up. Six pieces of
                // +5% stop 26.5%, not 30%, and the gap widens with every piece.
                $resistFactors[$el] = ($resistFactors[$el] ?? 1.0) * (1 - (int) $pct / 100);
            }
            foreach ((array) ($meta['bonuses'] ?? []) as $skill => $points) {
                $bonuses[$skill] = ($bonuses[$skill] ?? 0) + (int) $points;
            }
            if ($weaponMeta === null && ($meta['equip_slot'] ?? null) === 'weapon') {
                $weaponMeta = $meta;
            }
        }
        // One decimal: compounding rarely lands on a round number, and rounding
        // to int made the card disagree with an in-game check.
        $resists = [];
        foreach ($resistFactors as $el => $factor) {
            $resists[$el] = round(100 * (1 - $factor), 1);
        }

        // Damage elements: vocation spell schools + the weapon's element + physical
        // if the weapon swings for physical damage.
        $elements = self::VOCATION_ELEMENTS[$vocation] ?? ['physical'];
        if ($weaponMeta !== null) {
            if ((float) ($weaponMeta['element_attack'] ?? 0) > 0 && ! empty($weaponMeta['element_attack_type'])) {
                $elements[] = strtolower((string) $weaponMeta['element_attack_type']);
            }
            if ((float) ($weaponMeta['attack'] ?? 0) > 0) {
                $elements[] = 'physical';
            }
        }
        $elements = array_values(array_unique(array_filter($elements, fn ($e) => in_array($e, self::ELEMENTS, true))));

        return [
            'elements' => $elements,
            'resists' => $resists,
            'armor' => $armor,
            'bonuses' => $bonuses,
            'weapon_meta' => $weaponMeta,
        ];
    }

    /**
     * Damage the set's armor swallows from ONE physical hit. Armor in Tibia is
     * a flat subtraction — the hit drops by a random amount between half the
     * armor value and the full value — so the honest single number is the
     * average, 0.75·armor. (The old model expressed armor as a fixed % of any
     * hit, which over-credited it against the big hits the danger score cares
     * about and, shown next to the resist bars, looked like a second, disagreeing
     * physical-resistance figure.) Kept here so the number the character card
     * shows is the exact relief HuntFinder::danger() applies.
     */
    public static function armorAbsorb(int $armor): float
    {
        return 0.75 * max(0, $armor);
    }
}
