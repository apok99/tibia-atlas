<?php

namespace App\Support;

/**
 * Shared gear ranking rules — the "what is good equipment for this vocation"
 * knowledge, extracted so BOTH the loadout configurator (ItemController) and the
 * Hunt Finder (HuntFinder) score gear the same way instead of drifting apart.
 *
 * `score()` ranks an item in "armor points"; the SQL/const tables define the
 * obtainable filter, per-vocation skill values and slot rules the configurator
 * documents at length — see ItemController for the prose behind each.
 */
final class GearRules
{
    /** Canonical equipment slots, in head-to-toe display order. */
    public const SLOTS = ['head', 'neck', 'body', 'weapon', 'offhand', 'legs', 'finger', 'feet', 'ammo'];

    /**
     * What one point of each wiki skill bonus is worth to each vocation, in
     * "armor points" — the common currency of score(). A skill absent from a
     * vocation's map is worth 0 to it.
     */
    public const SKILL_WEIGHTS = [
        'knight' => ['sword fighting' => 5, 'axe fighting' => 5, 'club fighting' => 5, 'shielding' => 3, 'magic level' => 2],
        'paladin' => ['distance fighting' => 6, 'shielding' => 2, 'magic level' => 4],
        'sorcerer' => ['magic level' => 8, 'shielding' => 2],
        'druid' => ['magic level' => 8, 'shielding' => 2],
        'monk' => ['fist fighting' => 6, 'shielding' => 3, 'magic level' => 3],
    ];

    /**
     * Slots only some vocations equip at all; everyone else gets no suggestion
     * for them (ammo = paladin-only; offhand = knights/mages, not ranged/monk).
     */
    public const SLOT_VOCATIONS = [
        'ammo' => ['paladin'],
        'offhand' => ['knight', 'sorcerer', 'druid'],
    ];

    /**
     * The weapon `item_category` each vocation actually fights with — so a knight
     * is never handed a wand or a throwing star (which would also mislabel the
     * set's damage element). Absent vocation → any weapon.
     */
    public const WEAPON_CATEGORIES = [
        'knight' => ['Sword Weapons', 'Club Weapons', 'Axe Weapons'],
        'paladin' => ['Distance Weapons'],
        'sorcerer' => ['Wands'],
        'druid' => ['Rods'],
        'monk' => ['Fist Fighting Weapons'],
    ];

    /**
     * What counts as gear you can realistically go and buy. Two conditions:
     *  1. Purchasable — tradeable on the Market (`marketable`) or NPC-sold; this
     *     drops charged event variants, test-server copies and quest-bound
     *     untradeables.
     *  2. Actually circulating — some creature drops it, an NPC sells it, the
     *     wiki records a CONCRETE price range AND it is requirement-bearing gear
     *     (admits farmed quest rewards like the Yalahari Mask while excluding the
     *     "Negotiable" ghosts and requirement-free collector relics), or it is a
     *     marketable level-250+ piece (the modern boss-token sets).
     * `?obtainable=0` lifts the filter.
     */
    public const OBTAINABLE_SQL =
        "(((meta->>'marketable')::boolean is true".
        " or jsonb_array_length(coalesce(meta->'npc_buy', '[]'::jsonb)) > 0)".
        " and (jsonb_array_length(coalesce(meta->'dropped_by', '[]'::jsonb)) > 0".
        " or jsonb_array_length(coalesce(meta->'npc_buy', '[]'::jsonb)) > 0".
        " or coalesce((meta->>'level')::int, 0) >= 250".
        " or ((meta->>'value') ~ '^[0-9]'".
        " and (coalesce((meta->>'level')::int, 0) > 0".
        " or coalesce(meta->'vocations', '[]'::jsonb) <> '[]'::jsonb))))";

    /**
     * Rank an item (given its `meta` array) for a vocation, in "armor points":
     * core numbers (armor, weapon attack + mods, some defense), per-vocation
     * skill bonuses, elemental resists (physical counts extra, drowning none)
     * and imbuement slots. Identical to the heuristic the configurator uses.
     */
    public static function score(array $meta, string $vocation): float
    {
        $slot = $meta['equip_slot'] ?? null;
        $isWeapon = $slot === 'weapon' || $slot === 'ammo';

        $s = (float) ($meta['armor'] ?? 0);

        if ($isWeapon) {
            $s += (float) ($meta['attack'] ?? 0);
            // Elemental damage counts as attack — the bulk of a modern weapon's hit.
            $s += (float) ($meta['element_attack'] ?? 0);
            $s += (float) ($meta['atk_mod'] ?? 0);
            $s += 0.8 * (float) ($meta['hit_mod'] ?? 0);
            $s += 0.3 * (float) ($meta['defense'] ?? 0);
            $s += 0.6 * (float) ($meta['damage_max'] ?? 0);
        } elseif ($slot === 'offhand') {
            $isSpellbook = str_contains(strtolower((string) ($meta['item_category'] ?? '')), 'spellbook');
            $s += ($isSpellbook ? 0.3 : 1.0) * (float) ($meta['defense'] ?? 0);
        }

        $weights = self::SKILL_WEIGHTS[$vocation] ?? [];
        $skillScale = $isWeapon ? 0.3 : 1.0;
        // Knight gear boosts all three melee skills at once, but a knight fights
        // with ONE — count the best once instead of summing the trio.
        $meleeBest = 0;
        foreach ((array) ($meta['bonuses'] ?? []) as $skill => $points) {
            if (in_array($skill, ['sword fighting', 'axe fighting', 'club fighting'], true)) {
                $meleeBest = max($meleeBest, $points);

                continue;
            }
            $s += ($weights[$skill] ?? 0) * $skillScale * $points;
            if ($skill === 'speed') {
                $s += 0.15 * $points;
            }
        }
        $s += ($weights['sword fighting'] ?? 0) * $skillScale * $meleeBest;

        foreach ((array) ($meta['resists'] ?? []) as $element => $pct) {
            $s += match ($element) {
                'physical' => 0.8,
                'drowning' => 0.0,
                default => 0.5,
            } * $pct;
        }

        $s += 2.5 * (int) ($meta['imbue_slots'] ?? 0);

        return $s;
    }

    /**
     * Normalise a TibiaData / free-text vocation label ("Elite Knight", "Royal
     * Paladin", "Exalted Monk") to a base vocation slug, or '' if unknown.
     */
    public static function baseVocation(string $vocation): string
    {
        $v = strtolower($vocation);
        foreach (['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as $base) {
            if (str_contains($v, $base)) {
                return $base;
            }
        }

        return '';
    }
}
