<?php

namespace App\Services\Hunt;

use App\Models\Entry;
use App\Support\GearRules;
use App\Support\HuntZones;

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
    /** The elements a player can realistically deal / take, for offense + danger. */
    private const ELEMENTS = ['physical', 'fire', 'energy', 'ice', 'earth', 'death', 'holy'];

    /**
     * Spell schools each vocation can exploit regardless of weapon (runes/spells
     * a real hunter carries). The weapon's own element is added on top. This is
     * why a druid is credited for ice/earth even holding a plain rod.
     */
    private const VOCATION_ELEMENTS = [
        'knight' => ['physical'],
        'paladin' => ['physical', 'holy'],
        'sorcerer' => ['energy', 'fire', 'death'],
        'druid' => ['ice', 'earth', 'energy'],
        'monk' => ['physical', 'holy'],
    ];

    /** Rough HP gained per level, per vocation — the danger model's denominator. */
    private const HP_PER_LEVEL = [
        'knight' => 15, 'paladin' => 12, 'monk' => 13, 'sorcerer' => 6, 'druid' => 6, '' => 10,
    ];

    /** Combined elemental resistance a full set can realistically reach (game-ish cap). */
    private const RESIST_CAP = 60;

    /** Clustering: spawns within this many tiles (same floor) form one hunting area. */
    private const CLUSTER_THRESHOLD = 40;

    /** Drop clusters smaller than this — stray spawns aren't a hunting spot. */
    private const MIN_CLUSTER_POINTS = 3;

    /** Team hunts share tanking/healing: effective incoming damage is divided by this. */
    private const TEAM_DANGER_RELIEF = 2.4;

    public function find(int $level, string $vocation, string $mode, string $locale): array
    {
        $level = max(1, $level);
        $vocation = GearRules::baseVocation($vocation);
        $team = $mode === 'team';

        $set = $this->deriveSet($level, $vocation);
        $creatures = $this->scoreCreatures($set, $level, $vocation, $team, $locale);
        $zones = $this->buildZones($creatures, $team);

        return [
            'level' => $level,
            'vocation' => $vocation,
            'mode' => $team ? 'team' : 'solo',
            'set' => [
                'damage_elements' => $set['elements'],
                'resists' => $set['resists'],
                'armor' => $set['armor'],
                'weapon' => $set['weapon'],
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
     * @return array{elements: list<string>, resists: array<string,int>, armor: int, weapon: ?string}
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

        $resists = [];
        $armor = 0;
        foreach ($bestPerSlot as $slot => $meta) {
            $armor += (int) ($meta['armor'] ?? 0);
            foreach ((array) ($meta['resists'] ?? []) as $el => $pct) {
                $resists[$el] = ($resists[$el] ?? 0) + (int) $pct;
            }
        }
        foreach ($resists as $el => $pct) {
            $resists[$el] = min(self::RESIST_CAP, $pct);
        }

        // Damage elements: vocation spell schools + the weapon's element + physical
        // if the weapon swings for physical damage.
        $elements = self::VOCATION_ELEMENTS[$vocation] ?? ['physical'];
        $weapon = $bestPerSlot['weapon'] ?? null;
        $weaponName = null;
        if ($weapon !== null) {
            // Names live on translations, not meta — resolve the winning weapon's.
            $weaponName = isset($bestId['weapon'])
                ? Entry::find($bestId['weapon'])?->translation('en')?->name
                : null;
            if ((float) ($weapon['element_attack'] ?? 0) > 0 && ! empty($weapon['element_attack_type'])) {
                $elements[] = strtolower((string) $weapon['element_attack_type']);
            }
            if ((float) ($weapon['attack'] ?? 0) > 0) {
                $elements[] = 'physical';
            }
        }
        $elements = array_values(array_unique(array_filter($elements, fn ($e) => in_array($e, self::ELEMENTS, true))));

        return ['elements' => $elements, 'resists' => $resists, 'armor' => $armor, 'weapon' => $weaponName];
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
            // the HP you can burst down each cycle, which scales with your level
            // (and affinity). The crux of level-awareness: a low-level player is
            // throttled by a creature's HP (fast trash wins), but a high-level
            // one chews through anything so exp-PER-KILL dominates — that's why a
            // lvl 480 should rank the 13k-exp endgame spot over a 4k-exp trash one.
            $effBurst = max(200.0, $level * 20 * $off);
            $killTime = max(1.0, $hp / $effBurst);
            $expEff = $exp / $killTime;
            $profitEff = $gold / $killTime;

            // Danger = a big hit as a fraction of your HP, SCALED BY FIGHT LENGTH:
            // a high-HP spawn for your level takes forever to drop and pounds you
            // the whole time, so it's far deadlier than the same hit on something
            // you one-shot. Healing/shielding relieve it, but only modestly — a
            // mid-level char can't solo an endgame spawn, it just dies slower.
            $hitFrac = $this->danger($meta, $set, $ehp, $team);
            $danger = $hitFrac * $killTime / (1 + $level / 500.0);

            $expEffVals[] = $expEff;
            $profitVals[] = $profitEff;
            $stats[$c->id] = compact('meta', 'hp', 'exp', 'gold', 'off', 'offElement', 'expEff', 'profitEff', 'danger') + [
                'slug' => $c->slug,
                'name' => $c->translation('en')?->name ?? $c->translation($locale)?->name ?? $c->slug,
                'image' => $c->primary_image,
                'boss' => ($meta['rank'] ?? null) === 'Boss',
                'spawns' => (array) ($meta['spawns'] ?? []),
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

            // Danger is a fraction of your effective HP a single big hit removes.
            // Solo it bites hard and a lethal creature is dropped from advice;
            // team hunts already divided it and tolerate more.
            $tooDangerous = $s['danger'] >= ($team ? 1.1 : 0.85);
            $dangerMult = $tooDangerous ? 0.12 : max(0.15, 1 - 0.9 * $s['danger']);

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
                'hp' => $s['hp'],
                'danger' => round($s['danger'], 2),
                'too_dangerous' => $tooDangerous,
                'spawns' => $s['spawns'],
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
     * How dangerous the creature is to this set: its biggest hit, scaled by how
     * poorly the set resists the element it can best exploit, as a fraction of
     * the player's effective HP. Team hunts divide the incoming damage (shared
     * tanking + healing).
     *
     * @param  array{resists: array<string,int>, armor: int}  $set
     */
    private function danger(array $meta, array $set, float $ehp, bool $team): float
    {
        // Biggest hit. `max_damage` is missing for ~25% of creatures and a bogus
        // "1" for some endgame ones, so we never trust it alone: estimate a hit
        // from HP (fit to real creatures: ~3.1·hp^0.71 — a dragon's 430 at 1k HP,
        // a rotten golem's 4600 at 28k) and take the larger. Real spellcasters
        // that punch above their HP keep their higher recorded figure.
        $hp = (int) ($meta['hitpoints'] ?? 0);
        $estHit = 3.1 * ($hp > 0 ? $hp ** 0.71 : 0);
        $maxDamage = max((float) ($meta['max_damage'] ?? 0), 0.7 * $estHit);

        // Which elements can it hurt you with? Its attack abilities' elements,
        // plus physical (nearly everything melees).
        $elements = ['physical'];
        foreach ((array) ($meta['abilities'] ?? []) as $ab) {
            $el = strtolower((string) ($ab['element'] ?? ''));
            if ($el !== '' && in_array($el, self::ELEMENTS, true)) {
                $elements[] = $el;
            }
        }
        $elements = array_unique($elements);

        // Worst case: the element your set stops the least.
        $armorRelief = min(0.45, $set['armor'] / 400);
        $worst = 0.0;
        foreach ($elements as $el) {
            $resist = (int) ($set['resists'][$el] ?? 0);
            $incoming = max(0.0, 1 - $resist / 100);
            if ($el === 'physical') {
                $incoming *= (1 - $armorRelief);
            }
            $worst = max($worst, $incoming);
        }

        $effective = $maxDamage * $worst;
        if ($team) {
            $effective /= self::TEAM_DANGER_RELIEF;
        }

        return $effective / max(1, $ehp);
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
            if (! in_array($el, self::ELEMENTS, true)) {
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
    private function buildZones(array $creatures, bool $team): array
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

        // Cap the list and give each a stable id + a 0-100 "match" relative to
        // the best zone for this profile (the raw score is unbounded once the
        // density multiplier applies, so it's not display-friendly on its own).
        $zones = array_slice($zones, 0, 24);
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
        $bestScore = 0.0;
        $zoneDanger = 0.0;

        foreach ($cluster['members'] as $id => $count) {
            $c = $creatures[$id] ?? null;
            if ($c === null) {
                continue;
            }
            $totalCount += $count;
            $weightedScore += $c['score'] * $count;
            $weightedExp += $c['experience'] * $count;
            $weightedGold += $c['gold'] * $count;
            $bestScore = max($bestScore, $c['score']);
            if (! $c['too_dangerous']) {
                $zoneDanger = max($zoneDanger, $c['danger']);
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

        // Solo: a spot whose common creatures are near-lethal is demoted.
        $safeMult = (! $team && $zoneDanger > 0.6) ? max(0.5, 1 - ($zoneDanger - 0.6)) : 1.0;

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

        return [
            'name' => HuntZones::nearest($cluster['x'], $cluster['y']),
            'x' => $cluster['x'],
            'y' => $cluster['y'],
            'z' => $z,
            'score' => $score,
            'danger' => round($zoneDanger, 2),
            'exp_avg' => (int) round($weightedExp / $totalCount),
            'profit_avg' => (int) round($weightedGold / $totalCount),
            'spawn_count' => $cluster['count'],
            'creatures' => $members,
        ];
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
