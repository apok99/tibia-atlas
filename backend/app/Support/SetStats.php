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

    /** Combined elemental resistance a full set can realistically reach (game-ish cap). */
    public const RESIST_CAP = 60;

    /**
     * Sum what a set of worn items gives its wearer. `$metas` holds one item
     * meta per worn piece (at most one per slot — the caller enforces that).
     *
     * @param  list<array<string, mixed>>  $metas
     * @return array{
     *     elements: list<string>,
     *     resists: array<string, int>,
     *     armor: int,
     *     bonuses: array<string, int>,
     *     weapon_meta: ?array<string, mixed>,
     * }
     */
    public static function aggregate(array $metas, string $vocation): array
    {
        $resists = [];
        $bonuses = [];
        $armor = 0;
        $weaponMeta = null;
        foreach ($metas as $meta) {
            $armor += (int) ($meta['armor'] ?? 0);
            foreach ((array) ($meta['resists'] ?? []) as $el => $pct) {
                $resists[$el] = ($resists[$el] ?? 0) + (int) $pct;
            }
            foreach ((array) ($meta['bonuses'] ?? []) as $skill => $points) {
                $bonuses[$skill] = ($bonuses[$skill] ?? 0) + (int) $points;
            }
            if ($weaponMeta === null && ($meta['equip_slot'] ?? null) === 'weapon') {
                $weaponMeta = $meta;
            }
        }
        foreach ($resists as $el => $pct) {
            $resists[$el] = min(self::RESIST_CAP, $pct);
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
     * Fraction of incoming PHYSICAL damage the set's armor absorbs in the hunt
     * danger model. Kept here so the "physical reduction" the character card
     * shows is the exact relief HuntFinder::danger() applies.
     */
    public static function armorRelief(int $armor): float
    {
        return min(0.45, $armor / 400);
    }
}
