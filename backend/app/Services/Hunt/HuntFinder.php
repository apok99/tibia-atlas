<?php

namespace App\Services\Hunt;

use App\Models\Entry;
use App\Support\GearRules;
use App\Support\HuntZones;
use App\Support\SetStats;

/**
 * The Hunt Finder engine. Given a player profile (level + vocation + solo/team),
 * it derives the best obtainable gear set, works out that set's damage elements
 * and elemental resistances, then scores every documented creature for how good
 * a hunt it is for THAT player — folding in offensive affinity (does your damage
 * penetrate its resistances?), reward (experience + loot, adjusted by kill
 * speed) and danger (can it hit through your resists for a big chunk of your
 * HP?). Finally it clusters the winners' spawn points into named hunting zones
 * and ranks those.
 *
 * All world-agnostic: creature stats and spawn coordinates are identical on
 * every game world, so the ranking is valid for any of them.
 */
class HuntFinder
{
    /** Rough HP gained per level, per vocation — the danger model's denominator. */
    private const HP_PER_LEVEL = [
        'knight' => 15, 'paladin' => 12, 'monk' => 13, 'sorcerer' => 6, 'druid' => 6, '' => 10,
    ];

    /**
     * Sustained single-target DPS per level, per vocation — the kill-time
     * model's numerator. Calibrated to real hunts (an EK 500 sustains ~3k
     * DPS, a same-level sorcerer ~4k), NOT to burst spells.
     */
    private const DPS_PER_LEVEL = [
        'knight' => 6.0, 'paladin' => 7.0, 'monk' => 6.5, 'sorcerer' => 8.0, 'druid' => 7.5, '' => 7.0,
    ];

    /** Clustering: spawns within this many tiles (same floor) form one hunting area. */
    private const CLUSTER_THRESHOLD = 40;

    /** Drop clusters smaller than this — stray spawns aren't a hunting spot. */
    private const MIN_CLUSTER_POINTS = 3;

    /** Team hunts share tanking/healing: effective incoming damage is divided by this. */
    private const TEAM_DANGER_RELIEF = 2.4;

    /**
     * How much of a creature's MELEE (the physical component of its attack
     * table) actually lands on you, by vocation. A knight fights toe-to-toe and
     * eats all of it; a mage or paladin hunts at distance and mostly doesn't.
     *
     * Without this the danger model treated every vocation as a tank, and since
     * mages get less than half a knight's HP per level, a sorcerer 500 read as
     * exactly as fragile as a knight 200 — so tightening the danger cutoff to
     * stop sending level-200 knights to the Pits of Inferno also wiped the
     * entire endgame off the mage's list. Ranged vocations dodge the melee;
     * they still take the spells in full.
     */
    private const MELEE_EXPOSURE = [
        'knight' => 1.0, 'monk' => 0.95, 'paladin' => 0.45, 'sorcerer' => 0.40, 'druid' => 0.40, '' => 0.7,
    ];

    /** Fraction of a creature's full attack table that lands in a bad turn. */
    private const BAD_TURN = 0.65;

    /** Seconds of per-kill overhead (targeting, walking, looting) besides the fight. */
    private const KILL_OVERHEAD = 3.0;

    /**
     * Zones returned to the UI. `tibia:hunt-calibrate` passes a huge limit
     * instead: it has to tell "this zone isn't in our data" apart from "it's in
     * our data but ranks 40th", and a truncated list makes both look identical.
     */
    private const DEFAULT_LIMIT = 24;

    /**
     * Hunting complexes gated behind a quest line, keyed by zone name (the
     * creatures' shared bestiary place). The OT data can't express access
     * requirements, so this is curated — same approach as the boss locations.
     * 'quest_team' complexes are built for parties: solo advice drops them
     * outright (the Secret Library reading "88% match" for a solo knight was
     * nonsense), team advice keeps them with the access badge.
     */
    private const GATED_PLACES = [
        'Secret Library' => 'quest_team',
        'Zarganash' => 'quest_team',
        'Jaded Roots' => 'quest_team',
        'Putrefactory' => 'quest_team',
        'Darklight Core' => 'quest_team',
        'Falcon Bastion' => 'quest',
        'Pits of Inferno' => 'quest',
        'Court of Winter' => 'quest',
        'Court of Summer' => 'quest',
        'Dream Labyrinth' => 'quest',
        'Buried Cathedral' => 'quest',
    ];

    /**
     * Bestiary "Locations" strings that describe a DISTRIBUTION, not a place:
     * "Almost everywhere", "In many dungeons around Tibia", "Various locations".
     * They named real clusters in the ranking ("Almost everywhere in tibia" was
     * the 6th best spot for a level-20 knight), which is both useless advice and
     * unmatchable against any hunting guide. Rejected as names so the cluster
     * falls through to its quest area or nearest landmark.
     */
    private const VAGUE_PLACE = '/\b(almost )?every(where|thing)|many (dungeons|parts)|various locations|all (over|around|grass)|most grass|several spawns|throughout the|it raids\b/i';

    /**
     * @param  list<int>  $gearIds  entry ids of the player's REAL equipment (the
     *                              map's character gear); when they resolve to
     *                              wearable items the ranking runs against that
     *                              set instead of the synthesized best-in-slot one.
     */
    public function find(int $level, string $vocation, string $mode, string $locale, array $gearIds = [], int $limit = self::DEFAULT_LIMIT): array
    {
        $level = max(1, $level);
        $vocation = GearRules::baseVocation($vocation);
        $team = $mode === 'team';

        $set = $gearIds !== [] ? $this->setFromGear($gearIds, $vocation) : null;
        $set ??= $this->deriveSet($level, $vocation);
        $creatures = $this->scoreCreatures($set, $level, $vocation, $team, $locale);
        $zones = $this->buildZones($creatures, $team, $limit);

        return [
            'level' => $level,
            'vocation' => $vocation,
            'mode' => $team ? 'team' : 'solo',
            'set' => [
                'damage_elements' => $set['elements'],
                'resists' => $set['resists'],
                'armor' => $set['armor'],
                'weapon' => $set['weapon'],
                'weapon_type' => $set['weapon_type'],
                'source' => $set['source'],
            ],
            'zones' => $zones,
            'count' => count($zones),
        ];
    }

    // --- 1. Gear set ---------------------------------------------------------

    /**
     * Build the best obtainable set for this level+vocation (best-scoring item
     * per canonical slot, using the shared GearRules), then aggregate what the
     * hunter carries out of it: the damage elements they can deal and the
     * elemental resistances they wear.
     *
     * @return array{elements: list<string>, resists: array<string,int>, armor: int, weapon: ?string, weapon_type: ?string, source: string}
     */
    private function deriveSet(int $level, string $vocation): array
    {
        $query = Entry::query()
            ->ofType('item')
            ->whereRaw("jsonb_exists(meta, 'equip_slot')")
            ->whereRaw("coalesce((meta->>'level')::int, 0) <= ?", [$level])
            ->whereRaw(GearRules::OBTAINABLE_SQL);

        if ($vocation !== '') {
            $query->whereRaw(
                "(meta->'vocations' = '[]'::jsonb or meta->'vocations' @> ?::jsonb)",
                [json_encode([$vocation])]
            );
        }

        // Best item per slot by the shared vocation-aware score.
        $bestPerSlot = [];
        $bestScore = [];
        $bestId = [];
        foreach ($query->get(['id', 'meta']) as $item) {
            $meta = $item->meta ?? [];
            $slot = $meta['equip_slot'] ?? null;
            if ($slot === null) {
                continue;
            }
            // Skip few-charge consumable jewellery (its per-charge resists would
            // crown every ring/neck) — same rule the configurator uses.
            $charges = (int) ($meta['charges'] ?? 0);
            if ($charges > 0 && $charges < 100) {
                continue;
            }
            // A vocation fights with its own weapon class: don't hand a knight a
            // wand or a mage an axe. This also keeps the set's damage element
            // honest (a sorcerer's wand element, not a stray melee's physical).
            if ($slot === 'weapon' && isset(GearRules::WEAPON_CATEGORIES[$vocation])
                && ! in_array($meta['item_category'] ?? '', GearRules::WEAPON_CATEGORIES[$vocation], true)) {
                continue;
            }
            $s = GearRules::score($meta, $vocation);
            if (! isset($bestScore[$slot]) || $s > $bestScore[$slot]) {
                $bestScore[$slot] = $s;
                $bestPerSlot[$slot] = $meta;
                $bestId[$slot] = $item->id;
            }
        }

        $agg = SetStats::aggregate(array_values($bestPerSlot), $vocation);
        // Names live on translations, not meta — resolve the winning weapon's.
        $weaponName = isset($bestId['weapon'])
            ? Entry::find($bestId['weapon'])?->translation('en')?->name
            : null;

        return [
            'elements' => $agg['elements'],
            'resists' => $agg['resists'],
            'armor' => $agg['armor'],
            'weapon' => $weaponName,
            'weapon_type' => $agg['weapon_meta']['weapon_type'] ?? null,
            'source' => 'derived',
        ];
    }

    /**
     * Aggregate the player's REAL equipment (entry ids picked on the character
     * card) into the same set shape deriveSet() produces, so the whole scoring
     * pipeline runs against what they actually wear. No level/vocation/obtainable
     * filtering here — it's their gear, they own it. Returns null when none of
     * the ids resolves to a wearable item (caller falls back to deriveSet).
     *
     * @param  list<int>  $gearIds
     * @return ?array{elements: list<string>, resists: array<string,int>, armor: int, weapon: ?string, weapon_type: ?string, source: string}
     */
    private function setFromGear(array $gearIds, string $vocation): ?array
    {
        $items = Entry::query()
            ->ofType('item')
            ->whereIn('id', $gearIds)
            ->whereRaw("jsonb_exists(meta, 'equip_slot')")
            ->get(['id', 'meta']);
        if ($items->isEmpty()) {
            return null;
        }

        // One piece per slot — a worn set can't double up.
        $metas = [];
        $weaponId = null;
        foreach ($items as $item) {
            $meta = $item->meta ?? [];
            $slot = $meta['equip_slot'] ?? null;
            if ($slot === null || isset($metas[$slot])) {
                continue;
            }
            $metas[$slot] = $meta;
            if ($slot === 'weapon') {
                $weaponId = $item->id;
            }
        }

        $agg = SetStats::aggregate(array_values($metas), $vocation);
        $weaponName = $weaponId !== null
            ? Entry::find($weaponId)?->translation('en')?->name
            : null;

        return [
            'elements' => $agg['elements'],
            'resists' => $agg['resists'],
            'armor' => $agg['armor'],
            'weapon' => $weaponName,
            'weapon_type' => $agg['weapon_meta']['weapon_type'] ?? null,
            'source' => 'gear',
        ];
    }

    // --- 2. Per-creature scoring --------------------------------------------

    /**
     * Score every creature with spawn data against the set. Returns a map keyed
     * by creature id, each holding the display fields, the composite hunt score
     * and its spawn points.
     *
     * @param  array{elements: list<string>, resists: array<string,int>, armor: int, weapon: ?string}  $set
     */
    private function scoreCreatures(array $set, int $level, string $vocation, bool $team, string $locale): array
    {
        $rows = Entry::query()
            ->where('type', 'creature')
            ->whereNotNull('meta->spawn_count')
            ->with(['translations' => fn ($t) => $t->whereIn('locale', ['en', $locale])])
            ->get(['id', 'slug', 'meta', 'primary_image']);

        $hpPerLevel = self::HP_PER_LEVEL[$vocation] ?? self::HP_PER_LEVEL[''];
        $ehp = $level * $hpPerLevel + 185;

        // First pass: raw offense, kill-speed-adjusted reward and danger.
        $stats = [];
        $expEffVals = [];
        $profitVals = [];
        foreach ($rows as $c) {
            $meta = $c->meta ?? [];
            // Bosses are event kills, not a sustained hunt; skip them (the map
            // has its own boss layer). Skip statless creatures too — without HP
            // we can't judge kill speed or danger honestly.
            if (($meta['rank'] ?? null) === 'Boss') {
                continue;
            }
            $hp = (int) ($meta['hitpoints'] ?? 0);
            if ($hp <= 0) {
                continue;
            }
            $exp = (int) ($meta['experience'] ?? 0);
            $gold = (int) ($meta['gold_per_kill'] ?? 0);

            [$off, $offElement] = $this->offense($set['elements'], $meta);
            // Immune to everything you can throw → not a hunt for you at all.
            if ($off <= 0.001) {
                continue;
            }

            // Reward-per-hour = reward-per-kill ÷ kill-time. Kill-time is HP over
            // a realistic sustained player DPS (per-vocation, scaled by level and
            // element affinity), cut down by the creature's real armor and
            // mitigation from the OT server data. The crux of level-awareness: a
            // low-level player is throttled by a creature's HP (fast trash wins),
            // but a high-level one chews through anything so exp-PER-KILL
            // dominates — without pretending a solo EK melts a 28k-HP endgame
            // creature in four seconds (the bug that crowned Rotten Blood).
            $ot = (array) ($meta['ot'] ?? []);
            $dps = $level * (self::DPS_PER_LEVEL[$vocation] ?? self::DPS_PER_LEVEL['']) * $off;
            $dps *= 1 - min(0.5, ((float) ($ot['mitigation'] ?? 0)) / 100);
            $cArmor = (int) ($ot['armor'] ?? 0);
            $dps *= 1 - min(0.4, $cArmor / max(1, $cArmor + 12 * $level));
            $killTime = max(1.5, $hp / max(30.0, $dps));
            // Reward divides by the kill CYCLE — fight plus the fixed per-kill
            // overhead (targeting, walking, looting). Without it, low-HP trash
            // reads as good as the meaty high-exp creature a high level should
            // be farming: 40 one-second kills of 5k exp are NOT 4× better than
            // 10 four-second kills of 13k, because you don't chain-kill at 1/s.
            $cycle = $killTime + self::KILL_OVERHEAD;
            $expEff = $exp / $cycle;
            $profitEff = $gold / $cycle;

            // Danger = a bad TURN as a fraction of your HP, scaled up (gently,
            // log) by fight length: a high-HP spawn for your level takes forever
            // to drop and pounds you the whole time. The bad turn comes from the
            // creature's real per-attack damage table (meta.ot) against the
            // element your set resists worst; the old HP-based estimate remains
            // only as fallback for the few creatures without server data.
            $hitFrac = $this->danger($meta, $set, $ehp, $team, $vocation);
            $danger = $hitFrac * (1 + log(1 + $killTime / 6));

            $expEffVals[] = $expEff;
            $profitVals[] = $profitEff;
            $stats[$c->id] = compact('meta', 'hp', 'exp', 'gold', 'off', 'offElement', 'expEff', 'profitEff', 'danger', 'cycle') + [
                'slug' => $c->slug,
                'name' => $c->translation('en')?->name ?? $c->translation($locale)?->name ?? $c->slug,
                'image' => $c->primary_image,
                'boss' => ($meta['rank'] ?? null) === 'Boss',
                'spawns' => (array) ($meta['spawns'] ?? []),
                'quest_area' => $ot['quest_area'] ?? null,
                'place' => $ot['place'] ?? null,
                'stars' => $ot['stars'] ?? null,
            ];
        }

        sort($expEffVals);
        sort($profitVals);
        // Reference = a HIGH benchmark (top-decile) of reward-per-hour for this
        // player. Scoring each creature as a ratio to it (not a percentile) keeps
        // the top end spread out — a 13k-exp/h spot must read far better than a
        // 4k one, which a percentile flattens into "both top-15%". This is what
        // makes the ranking level-aware: at high level the best exp/h zones win.
        $refExp = $this->highRef($expEffVals);
        $refProfit = $this->highRef($profitVals);

        // Second pass: reward-ratio → composite score.
        $wExp = $team ? 0.46 : 0.50;
        $wProfit = $team ? 0.36 : 0.32;
        $wOff = 1 - $wExp - $wProfit;

        $out = [];
        foreach ($stats as $id => $s) {
            $expPct = min(1.25, $s['expEff'] / $refExp);
            $profitPct = min(1.25, $s['profitEff'] / $refProfit);
            $offNorm = min(1, $s['off'] / 1.4);

            $reward = $wExp * $expPct + $wProfit * $profitPct + $wOff * $offNorm;

            // Danger tolerance is NOT linear: routine damage (a bad turn eating
            // a quarter of your HP) barely matters — every real hunt does that —
            // but past ~0.65 the curve dives, and a lethal creature is dropped
            // from solo advice outright. Team hunts tolerate more.
            $tooDangerous = $s['danger'] >= ($team ? 0.60 : 0.45);
            $dangerMult = $tooDangerous ? 0.12 : max(0.12, 1 / (1 + ($s['danger'] / 0.34) ** 3));

            $score = round(100 * $reward * $dangerMult, 1);

            $out[$id] = [
                'slug' => $s['slug'],
                'name' => $s['name'],
                'image' => $s['image'],
                'boss' => $s['boss'],
                'score' => $score,
                'off' => round($s['off'], 2),
                'off_element' => $s['offElement'],
                'hit_with' => $this->bestElements($set['elements'], $s['meta']),
                'resists' => $this->resistHints($s['meta']),
                'experience' => $s['exp'],
                'gold' => $s['gold'],
                // Reward per HOUR at this player's kill speed — the same
                // per-kill figures over the kill cycle. This is the shape the
                // community hunting guides publish, so it's what the
                // tibia:hunt-calibrate report measures us against.
                'exp_h' => (int) round($s['expEff'] * 3600),
                'profit_h' => (int) round($s['profitEff'] * 3600),
                // Seconds this kill costs. Carried so a zone can add up total
                // reward over total TIME instead of averaging per-creature
                // rates — averaging rates answers a question nobody asked
                // ("what if you only ever killed one species?").
                'cycle' => round($s['cycle'], 2),
                'hp' => $s['hp'],
                'danger' => round($s['danger'], 2),
                'too_dangerous' => $tooDangerous,
                'spawns' => $s['spawns'],
                'quest_area' => $s['quest_area'],
                'place' => $s['place'],
                'stars' => $s['stars'],
            ];
        }

        return $out;
    }

    /**
     * Best offensive multiplier over the player's damage elements: a creature's
     * `damage_mods` value is the % of damage it TAKES from that element (100 =
     * normal, >100 weak, 0 immune), so we pick the element that hits hardest.
     * Absent mods default to normal (1.0). Returns [multiplier, elementName].
     *
     * @param  list<string>  $elements
     * @return array{0: float, 1: ?string}
     */
    private function offense(array $elements, array $meta): array
    {
        $mods = (array) ($meta['damage_mods'] ?? []);
        $best = 0.0;
        $bestEl = null;
        $hasMods = $mods !== [];
        foreach ($elements as $el) {
            $m = $hasMods ? ((float) ($mods[$el] ?? 100)) / 100 : 1.0;
            if ($m > $best) {
                $best = $m;
                $bestEl = $el;
            }
        }

        return [min(1.6, $best), $bestEl];
    }

    /**
     * How dangerous a bad turn from this creature is to this set, as a fraction
     * of the player's effective HP. Preferred source: the real per-attack damage
     * table from the OT server data (meta.ot.burst_by_element) — each element's
     * potential damage reduced by the set's resist for it (physical also by
     * armor; elements the set can't resist, like 'special' spells or life
     * drain, land in full). Not every attack procs the same turn, so the sum is
     * scaled by BAD_TURN. Team hunts divide the incoming damage (shared
     * tanking + healing).
     *
     * Fallback without server data: estimate one big hit from HP
     * (~3.1·hp^0.71, fit to real creatures) or the wiki's max_damage — needed
     * for ~20 harmless critters only.
     *
     * @param  array{resists: array<string,int>, armor: int}  $set
     */
    private function danger(array $meta, array $set, float $ehp, bool $team, string $vocation = ''): float
    {
        $armorRelief = SetStats::armorRelief((int) $set['armor']);
        $burstByEl = (array) (($meta['ot'] ?? [])['burst_by_element'] ?? []);
        $melee = self::MELEE_EXPOSURE[$vocation] ?? self::MELEE_EXPOSURE[''];

        $incoming = 0.0;
        foreach ($burstByEl as $el => $dmg) {
            $resist = (int) ($set['resists'][$el] ?? 0);
            $frac = in_array($el, SetStats::ELEMENTS, true) ? max(0.0, 1 - $resist / 100) : 1.0;
            if ($el === 'physical') {
                // Physical is overwhelmingly the melee attack: armour blunts it,
                // and a ranged vocation mostly isn't standing there to receive it.
                $frac *= (1 - $armorRelief) * $melee;
            }
            $incoming += (float) $dmg * $frac;
        }

        // A table with nothing beyond melee declared usually means the
        // monster's real spells live in server scripts the lua doesn't list —
        // Brinebrute Inferniarch has 32k HP and a declared "burst" of 600,
        // which read as a safe hunt for a level 150. Don't trust it: take the
        // HP-based estimate when it's larger. (Genuine pure-melee creatures
        // are mostly low-HP trash, where the overshoot is harmless.)
        if (count($burstByEl) <= 1) {
            $incoming = max($incoming, $this->estimatedIncoming($meta, $set, $armorRelief, $melee));
        }

        $effective = self::BAD_TURN * $incoming;
        if ($team) {
            $effective /= self::TEAM_DANGER_RELIEF;
        }

        return $effective / max(1, $ehp);
    }

    /**
     * The wiki-era danger estimate: one big hit inferred from HP (~3.1·hp^0.71,
     * fit to real creatures) or the recorded max_damage, through the element
     * the set stops the least (its attack abilities' elements plus physical).
     *
     * @param  array{resists: array<string,int>, armor: int}  $set
     */
    private function estimatedIncoming(array $meta, array $set, float $armorRelief, float $melee = 1.0): float
    {
        $hp = (int) ($meta['hitpoints'] ?? 0);
        $estHit = 3.1 * ($hp > 0 ? $hp ** 0.71 : 0);
        $maxDamage = max((float) ($meta['max_damage'] ?? 0), 0.7 * $estHit);

        $elements = ['physical'];
        foreach ((array) ($meta['abilities'] ?? []) as $ab) {
            $el = strtolower((string) ($ab['element'] ?? ''));
            if ($el !== '' && in_array($el, SetStats::ELEMENTS, true)) {
                $elements[] = $el;
            }
        }
        $worst = 0.0;
        foreach (array_unique($elements) as $el) {
            $resist = (int) ($set['resists'][$el] ?? 0);
            $frac = max(0.0, 1 - $resist / 100);
            if ($el === 'physical') {
                $frac *= (1 - $armorRelief) * $melee;
            }
            $worst = max($worst, $frac);
        }

        return $maxDamage * $worst;
    }

    /**
     * The elements the player should attack this creature with: their own damage
     * elements ordered by how much the creature takes, keeping the ones at or
     * above normal (skip elements it resists). Up to three.
     *
     * @param  list<string>  $elements
     * @return list<string>
     */
    private function bestElements(array $elements, array $meta): array
    {
        $mods = (array) ($meta['damage_mods'] ?? []);
        $scored = [];
        foreach ($elements as $el) {
            $scored[$el] = $mods !== [] ? ((float) ($mods[$el] ?? 100)) : 100.0;
        }
        arsort($scored);
        $out = [];
        foreach ($scored as $el => $pct) {
            if ($pct >= 100 || $out === []) {
                $out[] = $el;
            }
            if (count($out) >= 3) {
                break;
            }
        }

        return $out;
    }

    /**
     * Elements this creature resists or is immune to (damage taken < normal),
     * as a warning list. Independent of the player's elements — useful context.
     *
     * @return list<array{element: string, pct: int}>
     */
    private function resistHints(array $meta): array
    {
        $out = [];
        foreach ((array) ($meta['damage_mods'] ?? []) as $el => $pct) {
            if (! in_array($el, SetStats::ELEMENTS, true)) {
                continue;
            }
            if ((float) $pct < 100) {
                $out[] = ['element' => $el, 'pct' => (int) $pct];
            }
        }
        usort($out, fn ($a, $b) => $a['pct'] <=> $b['pct']);

        return $out;
    }

    // --- 3. Zone clustering --------------------------------------------------

    /**
     * Cluster the scored creatures' spawn points into hunting zones and rank the
     * zones. A zone's value is the density-weighted quality of the creatures you
     * actually meet there (common creatures count more), nudged up for spawn
     * density — more so for team hunts, which want packed spots.
     *
     * @param  array<int, array<string, mixed>>  $creatures  keyed by creature id
     * @return list<array<string, mixed>>
     */
    private function buildZones(array $creatures, bool $team, int $limit = self::DEFAULT_LIMIT): array
    {
        // Bucket spawn points by floor, tagged with their creature id.
        $byFloor = [];
        foreach ($creatures as $id => $c) {
            foreach ($c['spawns'] as $sp) {
                if (! is_array($sp) || count($sp) < 3) {
                    continue;
                }
                $z = (int) $sp[2];
                $byFloor[$z][] = ['x' => (int) $sp[0], 'y' => (int) $sp[1], 'id' => $id];
            }
        }

        $zones = [];
        foreach ($byFloor as $z => $points) {
            foreach ($this->clusterFloor($points) as $cluster) {
                if ($cluster['count'] < self::MIN_CLUSTER_POINTS) {
                    continue;
                }
                $zone = $this->scoreZone($cluster, $z, $creatures, $team);
                if ($zone !== null) {
                    $zones[] = $zone;
                }
            }
        }

        usort($zones, fn ($a, $b) => $b['score'] <=> $a['score']);

        // A multi-floor dungeon clusters once per floor and would flood the
        // list with five "Iksupan" rows — keep the two best per name so the
        // advice stays varied.
        $perName = [];
        $zones = array_values(array_filter($zones, function ($z) use (&$perName) {
            $perName[$z['name']] = ($perName[$z['name']] ?? 0) + 1;

            return $perName[$z['name']] <= 2;
        }));

        // Cap the list and give each a stable id + a 0-100 "match" relative to
        // the best zone for this profile (the raw score is unbounded once the
        // density multiplier applies, so it's not display-friendly on its own).
        $zones = array_slice($zones, 0, $limit);
        $top = $zones[0]['score'] ?? 1;
        foreach ($zones as $i => &$zone) {
            $zone['id'] = $i;
            $zone['match'] = $top > 0 ? (int) round(100 * $zone['score'] / $top) : 0;
        }
        unset($zone);

        return $zones;
    }

    /**
     * Greedy single-pass clustering of one floor's spawn points (same approach
     * as the map's clusterSpawns): a point joins the first cluster whose centre
     * is within the threshold, else starts its own.
     *
     * @param  list<array{x:int,y:int,id:int}>  $points
     * @return list<array{x:int,y:int,count:int,spread:int,members:array<int,int>}>
     */
    private function clusterFloor(array $points): array
    {
        $acc = [];
        foreach ($points as $p) {
            $hit = null;
            foreach ($acc as &$c) {
                if (abs($c['x'] - $p['x']) <= self::CLUSTER_THRESHOLD
                    && abs($c['y'] - $p['y']) <= self::CLUSTER_THRESHOLD) {
                    $hit = &$c;
                    break;
                }
            }
            unset($c);
            if ($hit !== null) {
                $hit['sx'] += $p['x'];
                $hit['sy'] += $p['y'];
                $hit['count']++;
                $hit['x'] = intdiv($hit['sx'], $hit['count']);
                $hit['y'] = intdiv($hit['sy'], $hit['count']);
                $hit['minx'] = min($hit['minx'], $p['x']);
                $hit['maxx'] = max($hit['maxx'], $p['x']);
                $hit['miny'] = min($hit['miny'], $p['y']);
                $hit['maxy'] = max($hit['maxy'], $p['y']);
                $hit['members'][$p['id']] = ($hit['members'][$p['id']] ?? 0) + 1;
                unset($hit);
            } else {
                $acc[] = [
                    'sx' => $p['x'], 'sy' => $p['y'], 'x' => $p['x'], 'y' => $p['y'], 'count' => 1,
                    'minx' => $p['x'], 'maxx' => $p['x'], 'miny' => $p['y'], 'maxy' => $p['y'],
                    'members' => [$p['id'] => 1],
                ];
            }
        }

        return array_map(fn ($c) => [
            'x' => $c['x'], 'y' => $c['y'], 'count' => $c['count'],
            'spread' => max($c['maxx'] - $c['minx'], $c['maxy'] - $c['miny']),
            'members' => $c['members'],
        ], $acc);
    }

    /**
     * Turn one spawn cluster into a ranked zone: weight member creatures by how
     * common they are in the cluster, blend the weighted-average quality with the
     * best creature present, apply a density nudge, and attach the top members
     * with their per-creature breakdown.
     *
     * @param  array{x:int,y:int,count:int,spread:int,members:array<int,int>}  $cluster
     * @param  array<int, array<string, mixed>>  $creatures
     */
    private function scoreZone(array $cluster, int $z, array $creatures, bool $team): ?array
    {
        $members = [];
        $totalCount = 0;
        $weightedScore = 0.0;
        $weightedExp = 0.0;
        $weightedGold = 0.0;
        $totalSeconds = 0.0;
        $bestScore = 0.0;
        $zoneDanger = 0.0;
        $weightedDanger = 0.0;
        $dangerCount = 0;

        $areaWeight = [];
        $placeWeight = [];
        foreach ($cluster['members'] as $id => $count) {
            $c = $creatures[$id] ?? null;
            if ($c === null) {
                continue;
            }
            if (! empty($c['quest_area'])) {
                $areaWeight[$c['quest_area']] = ($areaWeight[$c['quest_area']] ?? 0) + $count;
            }
            if (! empty($c['place']) && ! preg_match(self::VAGUE_PLACE, $c['place'])) {
                $place = $this->normalizePlace($c['place']);
                $placeWeight[$place] = ($placeWeight[$place] ?? 0) + $count;
            }
            $totalCount += $count;
            $weightedScore += $c['score'] * $count;
            $weightedExp += $c['experience'] * $count;
            $weightedGold += $c['gold'] * $count;
            $totalSeconds += $c['cycle'] * $count;
            $bestScore = max($bestScore, $c['score']);
            if (! $c['too_dangerous']) {
                $zoneDanger = max($zoneDanger, $c['danger']);
                $weightedDanger += $c['danger'] * $count;
                $dangerCount += $count;
            }
            $members[] = ['count' => $count] + $c;
        }

        if ($totalCount === 0) {
            return null;
        }

        $wavg = $weightedScore / $totalCount;
        // A hunt is mostly the creatures you meet often (weighted avg), with a
        // bonus for a strong creature sharing the spot.
        $base = 0.72 * $wavg + 0.28 * $bestScore;

        // Density: tighter, fuller clusters hunt better. Same shape as the map's
        // cluster score, normalised to a gentle multiplier. Team hunts value it more.
        $density = $cluster['count'] / (1 + $cluster['spread'] / self::CLUSTER_THRESHOLD);
        $densMult = 1 + ($team ? 0.6 : 0.3) * min(1, ($density - self::MIN_CLUSTER_POINTS) / 18);

        // Pack pressure: you rarely fight one creature at a time — the denser
        // the spawn, the more of its TYPICAL residents pound you at once. So a
        // spot full of 0.35-danger casters (the Secret Library) is deadly solo
        // even though each book alone reads survivable, while a palace of
        // 0.15-danger asuras with one scary stray stays fine. Count-weighted
        // danger × a simultaneous-pull estimate; overwhelming packs are dropped,
        // borderline ones demoted.
        $pull = min(3.0, 1 + max(0.0, $density - self::MIN_CLUSTER_POINTS) / 8);
        $avgDanger = $dangerCount > 0 ? $weightedDanger / $dangerCount : 0.0;
        $packDanger = $avgDanger * $pull;
        if ($packDanger >= ($team ? 0.70 : 0.45)) {
            return null;
        }
        $risk = max($zoneDanger, $packDanger);
        $safeMult = (! $team && $risk > 0.6) ? max(0.5, 1 - ($risk - 0.6)) : 1.0;

        $score = round($base * $densMult * $safeMult, 1);
        if ($score <= 0) {
            return null;
        }

        usort($members, fn ($a, $b) => $b['score'] <=> $a['score']);
        $members = array_slice($members, 0, 10);
        // Strip the heavy spawns array from the per-zone creature payload.
        $members = array_map(function ($m) {
            unset($m['spawns']);

            return $m;
        }, $members);

        // Naming: a cluster dominated by creatures that share a home place (the
        // bestiary Locations field) or a quest area IS that dungeon — its own
        // name beats the nearest overland landmark, which is plain wrong for
        // deep-floor dungeons (the Secret Library labelled "Port Hope"). The
        // wide-radius nearest() is the last resort so no zone goes nameless.
        $name = $this->dominant($placeWeight, $totalCount)
            ?? $this->plurality($placeWeight, $totalCount)
            ?? $this->questAreaName($this->dominant($areaWeight, $totalCount))
            ?? HuntZones::nearest($cluster['x'], $cluster['y'])
            ?? HuntZones::nearest($cluster['x'], $cluster['y'], 2000);

        // Quest-gated complexes: team-oriented ones are no solo advice at all;
        // the rest stay but carry the access badge.
        $access = self::GATED_PLACES[$name] ?? null;
        if ($access === 'quest_team' && ! $team) {
            return null;
        }

        return [
            'name' => $name,
            'x' => $cluster['x'],
            'y' => $cluster['y'],
            'z' => $z,
            'score' => $score,
            'danger' => round($risk, 2),
            'access' => $access !== null ? 'quest' : null,
            'exp_avg' => (int) round($weightedExp / $totalCount),
            'profit_avg' => (int) round($weightedGold / $totalCount),
            // What an hour here pays: total reward over total TIME, killing the
            // residents in proportion to how common they are. Not the average
            // of their individual rates — that overweights the fast trash you'd
            // only meet occasionally.
            'exp_h' => $totalSeconds > 0 ? (int) round(3600 * $weightedExp / $totalSeconds) : 0,
            'profit_h' => $totalSeconds > 0 ? (int) round(3600 * $weightedGold / $totalSeconds) : 0,
            'spawn_count' => $cluster['count'],
            'creatures' => $members,
        ];
    }

    /**
     * One dungeon, one vote key. The bestiary Locations strings are messy —
     * "Secret Library (fire section)", "The Secret Library (energy section)",
     * "Secret Library earth", even an unclosed "Secret Library (earth" — and
     * the split vote left those clusters mislabelled with far-away landmarks
     * (and dodging the gated-place rule). Strip the article, anything from an
     * opening paren on, and trailing section qualifiers.
     */
    private function normalizePlace(string $place): string
    {
        $p = (string) preg_replace('/^The\s+/i', '', trim($place));
        $p = (string) preg_replace('/\s*\(.*$/', '', $p);
        $p = (string) preg_replace('/\s+\w+\s+section$/i', '', $p);
        $p = (string) preg_replace('/\s+(fire|energy|ice|earth|holy|death)$/i', '', $p);

        return trim($p);
    }

    /** The key holding ≥60% of the cluster's weight, or null if none dominates. */
    private function dominant(array $weights, int $total): ?string
    {
        arsort($weights);
        $key = array_key_first($weights);

        return ($key !== null && $weights[$key] >= 0.6 * $total) ? (string) $key : null;
    }

    /**
     * Plurality vote: when named places cover most of the cluster but no single
     * one dominates — a dungeon whose bestiary entries name its sub-areas
     * ("Court of Summer" / "Buried Cathedral" / "Haunted Temple" are one Dream
     * Courts cluster) — the most common place is still far more truthful than
     * the nearest overland landmark, which for deep floors is plain wrong
     * (that cluster was labelled "Targuna").
     */
    private function plurality(array $weights, int $total): ?string
    {
        if ($weights === [] || array_sum($weights) < 0.6 * $total) {
            return null;
        }
        arsort($weights);
        $key = array_key_first($weights);

        return $weights[$key] >= $total / 3 ? (string) $key : null;
    }

    /** "rotten_blood" → "Rotten Blood", "primal_ordeal_quest" → "Primal Ordeal". */
    private function questAreaName(?string $area): ?string
    {
        return $area === null ? null : ucwords(str_replace('_', ' ', (string) preg_replace('/_quest$/', '', $area)));
    }

    // --- helpers -------------------------------------------------------------

    /**
     * Fraction (0..1) of the sorted population strictly below $value — a stable,
     * outlier-proof normalisation for reward scores.
     *
     * @param  list<float>  $sorted  ascending
     */
    private function percentile(array $sorted, float $value): float
    {
        $n = count($sorted);
        if ($n === 0) {
            return 0.0;
        }
        // Binary search for the first element >= value.
        $lo = 0;
        $hi = $n;
        while ($lo < $hi) {
            $mid = intdiv($lo + $hi, 2);
            if ($sorted[$mid] < $value) {
                $lo = $mid + 1;
            } else {
                $hi = $mid;
            }
        }

        return $lo / $n;
    }

    /**
     * A high benchmark — the top-decile value — of a sorted-ascending reward
     * population, used to score creatures as a ratio to "a great hunt" rather
     * than a flat percentile (which flattens the high end). Never returns 0.
     *
     * @param  list<float>  $sorted  ascending
     */
    private function highRef(array $sorted): float
    {
        $n = count($sorted);
        if ($n === 0) {
            return 1.0;
        }
        $v = $sorted[(int) floor(0.90 * ($n - 1))];

        return $v > 0 ? $v : 1.0;
    }
}
