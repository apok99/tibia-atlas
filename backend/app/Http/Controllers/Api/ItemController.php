<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\EntryListResource;
use App\Models\Entry;
use App\Support\ContentCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Cache;

/**
 * The item catalogue: the sticker-album gallery and the loadout configurator.
 *
 * Items are a reference catalogue rather than editorial lore, so — like the
 * hunting map's spawn data — these endpoints include DRAFT entries (publishing
 * thousands of imported items by hand isn't realistic, and the album/configurator
 * need the whole set to be useful).
 */
class ItemController extends Controller
{
    /** Canonical equipment slots, in head-to-toe display order. */
    private const SLOTS = ['head', 'neck', 'body', 'weapon', 'offhand', 'legs', 'finger', 'feet', 'ammo'];

    /**
     * The weapon cards each vocation gets. A single "weapon" card always
     * crowned whichever type happened to carry the biggest number (axes for
     * knights, one bow for paladins), so vocations that master several weapon
     * styles get one card per style instead: knights see their best sword, axe
     * AND club; paladins their best bow AND crossbow. `match` values are
     * case-insensitive substrings of the item's `item_category`; `kind` routes
     * distance weapons through distanceKind() (bow vs crossbow vs throwing).
     * A card whose filter matches nothing is dropped rather than back-filled
     * with off-style gear.
     */
    private const WEAPON_CARDS = [
        'knight' => [
            ['slot' => 'weapon_sword', 'match' => ['sword']],
            ['slot' => 'weapon_axe', 'match' => ['axe']],
            ['slot' => 'weapon_club', 'match' => ['club']],
        ],
        'paladin' => [
            ['slot' => 'weapon_bow', 'kind' => 'bow'],
            ['slot' => 'weapon_crossbow', 'kind' => 'crossbow'],
        ],
        'sorcerer' => [['slot' => 'weapon', 'match' => ['wand']]],
        'druid' => [['slot' => 'weapon', 'match' => ['rod']]],
        'monk' => [['slot' => 'weapon', 'match' => ['fist']]],
    ];

    /**
     * What each vocation holds in the offhand: knights a shield, mages a
     * spellbook. Paladins and monks are handled by SLOT_VOCATIONS below — they
     * get no offhand at all. Matched as case-insensitive substrings of
     * `item_category`, like WEAPON_CARDS.
     */
    private const OFFHAND_STYLES = [
        'knight' => ['shield'],
        'sorcerer' => ['spellbook'],
        'druid' => ['spellbook'],
    ];

    /**
     * Slots only some vocations equip at all; everyone else gets no suggestion
     * for them.
     *  - ammo: arrows/bolts/quivers are paladin-only gear.
     *  - offhand: modern paladins fight at range (bow/crossbow or thrown) and no
     *    longer tank behind a shield, and monks wield two-handed fist weapons, so
     *    neither gets an offhand suggestion. Knights (shield) and mages
     *    (spellbook) keep theirs.
     */
    private const SLOT_VOCATIONS = [
        'ammo' => ['paladin'],
        'offhand' => ['knight', 'sorcerer', 'druid'],
    ];

    /**
     * What one point of each wiki skill bonus is worth to each vocation, in
     * "armor points" — the common currency of score(). This is what lets a
     * Yalahari Mask (armor 5, magic level +2) beat a Demon Helmet (armor 10,
     * nothing else) for a mage, instead of ranking gear by raw armor alone.
     * A skill absent from a vocation's map is worth 0 to it (a knight gains
     * nothing from distance fighting).
     */
    private const SKILL_WEIGHTS = [
        'knight' => ['sword fighting' => 5, 'axe fighting' => 5, 'club fighting' => 5, 'shielding' => 3, 'magic level' => 2],
        'paladin' => ['distance fighting' => 6, 'shielding' => 2, 'magic level' => 4],
        'sorcerer' => ['magic level' => 8, 'shielding' => 2],
        'druid' => ['magic level' => 8, 'shielding' => 2],
        'monk' => ['fist fighting' => 6, 'shielding' => 3, 'magic level' => 3],
    ];

    /**
     * What counts as gear you can realistically go and buy. Two conditions:
     *
     * 1. Purchasable — tradeable on the in-game Market (`marketable`) or sold
     *    by an NPC. This drops the charged event variants ("bow of mayhem
     *    (heavily charged)"), test-server copies and quest-bound untradeables.
     * 2. Actually circulating — a steady market supply exists. Three ways in:
     *    some creature drops it, an NPC sells it, or the wiki records a
     *    CONCRETE price range for it (players tracking real trades — the mark
     *    of a liquid market) AND it is real requirement-bearing equipment.
     *    That clause is what admits the marketable quest rewards everyone
     *    farms (Yalahari Mask: "60,000 - 150,000", level 80, mages) while still
     *    excluding both the "Negotiable"-priced ghosts nobody ever lists
     *    (Magic Longsword, Warlord Sword, Slayer of Mayhem) and the priced
     *    collector relics with no requirements at all (Golden/Winged/Horned
     *    Helmet, Golden Boots, Ring of the Sky). Finally, marketable gear with
     *    a level 250+ requirement is trusted outright: the modern boss-token
     *    sets (Sanguine/Grand Sanguine lvl 500-600, the Soul set lvl 400,
     *    Moonsilver lvl 800+) list as "Negotiable" with no drop yet ARE the
     *    liquid end-game market — while every discontinued relic predates such
     *    requirements (lvl 100-140).
     *
     * `?obtainable=0` lifts the filter.
     */
    private const OBTAINABLE_SQL =
        "(((meta->>'marketable')::boolean is true".
        " or jsonb_array_length(coalesce(meta->'npc_buy', '[]'::jsonb)) > 0)".
        " and (jsonb_array_length(coalesce(meta->'dropped_by', '[]'::jsonb)) > 0".
        " or jsonb_array_length(coalesce(meta->'npc_buy', '[]'::jsonb)) > 0".
        " or coalesce((meta->>'level')::int, 0) >= 250".
        " or ((meta->>'value') ~ '^[0-9]'".
        " and (coalesce((meta->>'level')::int, 0) > 0".
        " or coalesce(meta->'vocations', '[]'::jsonb) <> '[]'::jsonb))))";

    /**
     * Paginated item list for the album, filterable by category / equip slot /
     * vocation / free-text. Ordered alphabetically so each category reads like
     * an album page.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $items = Entry::query()
            ->ofType('item')
            ->with('translations')
            ->when($request->filled('category'), fn ($q) => $q
                ->where('meta->item_category', (string) $request->string('category')))
            ->when($request->filled('slot'), fn ($q) => $q
                ->where('meta->equip_slot', (string) $request->string('slot')))
            // equippable=1 → only wearable gear (has an equip slot).
            ->when($request->filled('equippable'), function ($q) use ($request) {
                $request->boolean('equippable')
                    ? $q->whereRaw("jsonb_exists(meta, 'equip_slot')")
                    : $q->whereRaw("not (jsonb_exists(meta, 'equip_slot'))");
            })
            ->when($request->filled('vocation'), fn ($q) => $q->whereRaw(
                "(meta->'vocations' = '[]'::jsonb or meta->'vocations' @> ?::jsonb)",
                [json_encode([(string) $request->string('vocation')])]
            ))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.addcslashes((string) $request->string('q'), '%_\\').'%';
                $q->whereHas('translations', fn ($t) => $t->where('name', 'ilike', $term));
            })
            ->orderBy('id')
            ->paginate($this->clamp($request, 'per_page', 60, 1, 200))
            ->withQueryString();

        // Stable album order = by name; do it after pagination would be wrong, so
        // sort the page contents client-side. The DB order (id) keeps pages stable.
        return EntryListResource::collection($items);
    }

    /**
     * Full detail for one item (the album's click-through): stats, worth, the
     * NPCs that buy/sell it, and the creatures that drop it — with each dropper
     * resolved to its lore entry so it links through (when published).
     */
    public function show(string $slug): JsonResponse
    {
        $item = Entry::query()
            ->ofType('item')
            ->where('slug', $slug)
            ->with(['translations', 'sources'])
            ->first();
        abort_unless($item !== null, 404);

        $tr = $item->translation(app()->getLocale());
        $meta = $item->meta ?? [];

        // Resolve dropped-by creature NAMES to entries (match on the EN name),
        // preserving the wiki's drop order; unmatched names pass through as text.
        $names = array_values(array_filter((array) data_get($meta, 'dropped_by', [])));
        $droppers = [];
        if ($names) {
            $rows = Entry::query()
                ->ofType('creature')
                ->whereHas('translations', fn ($t) => $t->where('locale', 'en')->whereIn('name', $names))
                ->with(['translations' => fn ($t) => $t->where('locale', 'en')])
                ->get();

            $byName = [];
            foreach ($rows as $c) {
                $name = $c->translations->first()?->name;
                if ($name !== null) {
                    $byName[$name] = [
                        'name' => $name,
                        'slug' => $c->slug,
                        'image' => $c->primary_image,
                        'published' => $c->status->value === 'published',
                    ];
                }
            }
            foreach ($names as $n) {
                $droppers[] = $byName[$n]
                    ?? ['name' => $n, 'slug' => null, 'image' => null, 'published' => false];
            }
        }

        $wikiUrl = optional($item->sources->firstWhere('type', 'tibia_wiki'))->url
            ?? optional($item->sources->first())->url;

        return response()->json(['data' => [
            'slug' => $item->slug,
            'name' => $tr?->name,
            'image' => $item->primary_image,
            'overview' => $tr?->overview,
            'notes' => $tr?->canon,
            'item' => [
                'category' => data_get($meta, 'item_category'),
                'object_class' => data_get($meta, 'object_class'),
                'slot' => data_get($meta, 'equip_slot'),
                'vocations' => data_get($meta, 'vocations', []),
                'level' => data_get($meta, 'level'),
                'attack' => data_get($meta, 'attack'),
                'element_attack' => data_get($meta, 'element_attack'),
                'element_attack_type' => data_get($meta, 'element_attack_type'),
                'atk_mod' => data_get($meta, 'atk_mod'),
                'hit_mod' => data_get($meta, 'hit_mod'),
                'defense' => data_get($meta, 'defense'),
                'defense_mod' => data_get($meta, 'defense_mod'),
                'armor' => data_get($meta, 'armor'),
                'bonuses' => data_get($meta, 'bonuses'),
                'resists' => data_get($meta, 'resists'),
                'power' => data_get($meta, 'power'),
                'weight' => data_get($meta, 'weight'),
                'hands' => data_get($meta, 'hands'),
                'weapon_type' => data_get($meta, 'weapon_type'),
                'damage_range' => data_get($meta, 'damage_range'),
                'damage_type' => data_get($meta, 'damage_type'),
                'imbue_slots' => data_get($meta, 'imbue_slots'),
                'mana_cost' => data_get($meta, 'mana_cost'),
                'range' => data_get($meta, 'range'),
                'marketable' => data_get($meta, 'marketable'),
            ],
            'value' => data_get($meta, 'value'),
            'npc_value' => data_get($meta, 'npc_value'),
            'npc_buy' => data_get($meta, 'npc_buy', []),
            'npc_sell' => data_get($meta, 'npc_sell', []),
            'dropped_by' => $droppers,
            'wiki_url' => $wikiUrl,
        ]]);
    }

    /**
     * Album metadata: every item category with its count (album sections and
     * collection-progress denominators), plus overall totals.
     */
    public function facets(): JsonResponse
    {
        $payload = Cache::remember(ContentCache::key('item-facets'), 3600, function () {
            $base = Entry::query()->ofType('item');

            $categories = (clone $base)
                ->selectRaw("meta->>'item_category' as value, count(*) as count")
                ->whereRaw("meta->>'item_category' is not null")
                ->groupByRaw("meta->>'item_category'")
                ->orderByDesc('count')
                ->get()
                ->map(fn ($row) => ['value' => $row->value, 'count' => (int) $row->count])
                ->all();

            $total = (clone $base)->count();
            $equippable = (clone $base)->whereRaw("jsonb_exists(meta, 'equip_slot')")->count();

            return ['categories' => $categories, 'total' => $total, 'equippable' => $equippable];
        });

        return response()->json($payload);
    }

    /**
     * Loadout configurator: for a given level + vocation, the best usable item
     * in each equipment slot plus a few alternatives. "Best" is the heuristic
     * `power` stat baked in at import (armor / attack / defense / damage), so the
     * UI presents it as a suggestion, not gospel.
     */
    public function loadout(Request $request): JsonResponse
    {
        $level = max(1, $request->integer('level', 1));
        $vocation = strtolower((string) $request->string('vocation'));
        $altCount = $this->clamp($request, 'alts', 5, 0, 8);
        // Obtainable-only by default; ?obtainable=0 shows aspirational relics too.
        $obtainableOnly = $request->boolean('obtainable', true);

        // Not cached: the result holds API resources (which don't round-trip
        // cleanly through the cache store) and the underlying query is cheap.
        return response()->json([
            'level' => $level,
            'vocation' => $vocation,
            'slots' => $this->bestPerSlot($level, $vocation, $altCount, $obtainableOnly),
        ]);
    }

    /**
     * @return array<int, array{slot: string, best: mixed, alternatives: mixed}>
     */
    private function bestPerSlot(int $level, string $vocation, int $altCount, bool $obtainableOnly = true): array
    {
        $query = Entry::query()
            ->ofType('item')
            ->with('translations')
            ->whereRaw("jsonb_exists(meta, 'equip_slot')")
            // Level requirement satisfied (0/absent = none).
            ->whereRaw("coalesce((meta->>'level')::int, 0) <= ?", [$level])
            // Drop the un-farmable collector relics unless explicitly asked for.
            ->when($obtainableOnly, fn ($q) => $q->whereRaw(self::OBTAINABLE_SQL));

        // Vocation: usable by everyone (empty list) or by the chosen vocation.
        if ($vocation !== '') {
            $query->whereRaw(
                "(meta->'vocations' = '[]'::jsonb or meta->'vocations' @> ?::jsonb)",
                [json_encode([$vocation])]
            );
        }

        // Pull every usable equip item once, then rank each slot by the
        // vocation-aware score. On ties, the higher level requirement wins:
        // level-gated gear carries the better secondary stats (Elite Draken
        // Mail over the requirement-free Dragon Scale Mail at the same armor).
        $items = $query->orderBy('id')->get();

        $scores = [];
        foreach ($items as $item) {
            $scores[$item->id] = $this->score($item, $vocation);
        }

        $bySlot = [];
        foreach (self::SLOTS as $slot) {
            $bySlot[$slot] = [];
        }
        foreach ($items as $item) {
            // Few-charge protection jewellery (Stone Skin Amulet ×5, Might
            // Ring ×20) is a situational consumable you pocket, not the piece
            // you WEAR — its huge per-charge resists would otherwise crown
            // every neck/ring slot. High-charge pieces (Prismatic Necklace,
            // ×750) behave like permanent gear and stay.
            $charges = (int) data_get($item->meta, 'charges', 0);
            if ($charges > 0 && $charges < 100) {
                continue;
            }

            $slot = data_get($item->meta, 'equip_slot');
            if (isset($bySlot[$slot])) {
                $bySlot[$slot][] = $item;
            }
        }
        foreach ($bySlot as &$list) {
            usort($list, fn ($a, $b) => [$scores[$b->id], (int) data_get($b->meta, 'level', 0), $a->id]
                <=> [$scores[$a->id], (int) data_get($a->meta, 'level', 0), $b->id]);
        }
        unset($list);

        $result = [];
        foreach (self::SLOTS as $slot) {
            // Skip slots this vocation doesn't use at all (e.g. ammo for non-paladins).
            $only = self::SLOT_VOCATIONS[$slot] ?? null;
            if ($only !== null && $vocation !== '' && ! in_array($vocation, $only, true)) {
                continue;
            }

            // The weapon slot expands into one card per fighting style (knight:
            // sword/axe/club, paladin: bow/crossbow) so every style the vocation
            // masters gets a suggestion, not just the one with the biggest number.
            if ($slot === 'weapon') {
                $cards = self::WEAPON_CARDS[$vocation] ?? [['slot' => 'weapon']];
                foreach ($cards as $card) {
                    $list = $this->filterWeapons($bySlot['weapon'], $card);
                    if ($list) {
                        $result[] = $this->slotPayload($card['slot'], $list, $altCount, $scores);
                    }
                }

                continue;
            }

            $list = $bySlot[$slot];

            // Offhand: keep only gear in this vocation's style (shield vs
            // spellbook), so the suggestion is the right *kind* of item.
            $styles = $slot === 'offhand' && $vocation !== '' ? (self::OFFHAND_STYLES[$vocation] ?? null) : null;
            if ($styles !== null) {
                $list = $this->filterByCategory($list, $styles);
            }

            if ($list) {
                $result[] = $this->slotPayload($slot, $list, $altCount, $scores);
            }
        }

        return $result;
    }

    /**
     * Rank an item for a vocation, in "armor points". Unlike the baked-in
     * `power` stat (raw armor/attack only — which crowned a Magic Plate Armor
     * over every modern set piece), this folds in everything the wiki knows:
     *
     *  - core numbers: armor; weapons add attack (+ the modern atk/hit mods),
     *    a bit of defense, and the wand/rod damage tables;
     *  - skill bonuses, weighted per vocation (SKILL_WEIGHTS) — magic level for
     *    mages, distance fighting for paladins, melee skills for knights;
     *  - elemental resistances (physical protection counts extra — everything
     *    hits physically);
     *  - imbuement slots (each is a big damage/leech upgrade a player WILL use);
     *  - speed, worth a nudge on anything.
     */
    private function score(Entry $item, string $vocation): float
    {
        $meta = $item->meta ?? [];
        $slot = data_get($meta, 'equip_slot');
        $isWeapon = $slot === 'weapon' || $slot === 'ammo';

        $s = (float) data_get($meta, 'armor', 0);

        if ($isWeapon) {
            $s += (float) data_get($meta, 'attack', 0);
            // Elemental damage (Sanguine Blade: attack 8 + fire 46) counts as
            // attack — it's the bulk of a modern weapon's hit.
            $s += (float) data_get($meta, 'element_attack', 0);
            $s += (float) data_get($meta, 'atk_mod', 0);
            $s += 0.8 * (float) data_get($meta, 'hit_mod', 0);
            $s += 0.3 * (float) data_get($meta, 'defense', 0);
            $s += 0.6 * (float) data_get($meta, 'damage_max', 0);
        } elseif ($slot === 'offhand') {
            // Shields block with defense; spellbooks are stat-sticks whose
            // value lives in their bonuses, so defense barely counts there.
            $isSpellbook = str_contains(strtolower((string) data_get($meta, 'item_category', '')), 'spellbook');
            $s += ($isSpellbook ? 0.3 : 1.0) * (float) data_get($meta, 'defense', 0);
        }

        // On armor, +1 of your main skill is a rare prize worth several armor
        // points. On a weapon it competes against raw attack, where +1 skill
        // ≈ +1 attack — so weapon skill bonuses are scaled way down.
        $weights = self::SKILL_WEIGHTS[$vocation] ?? [];
        $skillScale = $isWeapon ? 0.3 : 1.0;
        // Knight gear boosts all three melee skills at once ("axe/club/sword
        // fighting +4"), but a knight fights with ONE of them — count the best
        // once instead of summing the trio.
        $meleeBest = 0;
        foreach ((array) data_get($meta, 'bonuses', []) as $skill => $points) {
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

        // Physical protection counts extra (everything hits physically);
        // drowning counts nothing (underwater breathing, not combat).
        foreach ((array) data_get($meta, 'resists', []) as $element => $pct) {
            $s += match ($element) {
                'physical' => 0.8,
                'drowning' => 0.0,
                default => 0.5,
            } * $pct;
        }

        $s += 2.5 * (int) data_get($meta, 'imbue_slots', 0);

        return $s;
    }

    /**
     * Build one slot card from a power-ordered candidate list: first item is
     * the suggestion, the next `$altCount` are the alternatives.
     *
     * Many items come in stat-identical recolours (the four elemental -soul
     * tabards, the -heart cuirasses); without dedup they fill every alternative
     * slot with copies of the winner and push genuinely different gear out of
     * sight. So alternatives keep only the first item of each stat signature.
     *
     * @param  list<Entry>  $list  non-empty, strongest first
     * @param  array<int, float>  $scores  vocation-aware score per entry id
     * @return array{slot: string, best: mixed, alternatives: mixed}
     */
    private function slotPayload(string $slot, array $list, int $altCount, array $scores): array
    {
        $best = array_shift($list);

        $seen = [$this->statSignature($best, $scores) => true];
        $alternatives = [];
        foreach ($list as $item) {
            if (count($alternatives) === $altCount) {
                break;
            }
            $sig = $this->statSignature($item, $scores);
            if (! isset($seen[$sig])) {
                $seen[$sig] = true;
                $alternatives[] = $item;
            }
        }

        return [
            'slot' => $slot,
            'best' => new EntryListResource($best),
            'alternatives' => EntryListResource::collection($alternatives),
        ];
    }

    /**
     * The stats that make two items interchangeable in a build. Includes the
     * vocation score so two items that merely LOOK alike on raw numbers but
     * differ in bonuses (one has magic level, the other distance) stay distinct.
     *
     * @param  array<int, float>  $scores
     */
    private function statSignature(Entry $item, array $scores): string
    {
        $meta = $item->meta ?? [];

        return implode('|', [
            (string) round($scores[$item->id] ?? 0, 2),
            data_get($meta, 'level', ''),
            data_get($meta, 'armor', ''),
            data_get($meta, 'attack', ''),
            data_get($meta, 'defense', ''),
            data_get($meta, 'damage_range', ''),
        ]);
    }

    /**
     * Narrow the weapon-slot candidates to one WEAPON_CARDS entry: by category
     * keywords (`match`) or by distance kind (`kind`); a card with neither
     * (unknown vocation) passes everything through.
     *
     * @param  list<Entry>  $items
     * @param  array{slot: string, match?: list<string>, kind?: string}  $card
     * @return list<Entry>
     */
    private function filterWeapons(array $items, array $card): array
    {
        if (isset($card['kind'])) {
            return array_values(array_filter($items, fn ($i) => $this->distanceKind($i) === $card['kind']));
        }
        if (isset($card['match'])) {
            return $this->filterByCategory($items, $card['match']);
        }

        return $items;
    }

    /**
     * Bow or crossbow? `item_subcategory` (the wiki's secondarytype) is
     * authoritative; rows imported before that field existed fall back to the
     * name — checking "crossbow"/"arbalest" before "bow", since every crossbow
     * name contains "bow". Throwing weapons (spears, stars) match neither and
     * stay out of both cards — paladins don't hunt with them.
     */
    private function distanceKind(Entry $item): ?string
    {
        $sub = strtolower((string) data_get($item->meta, 'item_subcategory', ''));
        if ($sub !== '') {
            if (str_contains($sub, 'crossbow')) {
                return 'crossbow';
            }

            return str_contains($sub, 'bow') ? 'bow' : null;
        }

        $slug = strtolower($item->slug);
        if (str_contains($slug, 'crossbow') || str_contains($slug, 'arbalest')) {
            return 'crossbow';
        }

        return str_contains($slug, 'bow') ? 'bow' : null;
    }

    /**
     * Keep only items whose `item_category` contains one of the given keywords
     * (case-insensitive), preserving the incoming power order.
     *
     * @param  iterable<Entry>  $items
     * @param  list<string>  $keywords
     * @return list<Entry>
     */
    private function filterByCategory(iterable $items, array $keywords): array
    {
        $matched = [];
        foreach ($items as $item) {
            $category = strtolower((string) data_get($item->meta, 'item_category', ''));
            foreach ($keywords as $keyword) {
                if (str_contains($category, $keyword)) {
                    $matched[] = $item;
                    break;
                }
            }
        }

        return $matched;
    }
}
