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
     * Which gear each vocation actually fights with, by slot. The baked-in
     * `power` stat alone can't tell a usable-by-all greataxe apart from the wand
     * a mage is meant to hold, so without this the configurator hands a sorcerer
     * a two-handed sword and a knight a fishing rod. Values are matched as
     * case-insensitive substrings of the item's `item_category`; a vocation
     * absent from a slot map has no restriction (e.g. armour, rings, amulets are
     * shared by everyone). A slot whose filter matches nothing is dropped rather
     * than back-filled with off-style gear.
     */
    private const STYLES = [
        'weapon' => [
            'knight' => ['sword', 'axe', 'club'],
            'paladin' => ['distance'],
            'sorcerer' => ['wand'],
            'druid' => ['rod'],
            'monk' => ['fist'],
        ],
        'offhand' => [
            // Knights hold a shield; mages hold a spellbook. Paladins and monks
            // are handled by SLOT_VOCATIONS below — they get no offhand at all.
            'knight' => ['shield'],
            'sorcerer' => ['spellbook'],
            'druid' => ['spellbook'],
        ],
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
     * An item counts as obtainable if a creature drops it or an NPC sells it.
     * `marketable` alone is NOT enough: pure collector relics (Golden Helmet,
     * Winged/Horned Helmet) are flagged marketable yet have no farmable source,
     * so the configurator would otherwise crown a helmet no player can realistically
     * get. Quest-/event-/store-only gear with neither a drop nor an NPC seller is
     * left out of the build (it still shows in the album catalogue).
     */
    private const OBTAINABLE_SQL =
        "(jsonb_array_length(coalesce(meta->'dropped_by', '[]'::jsonb)) > 0".
        " or jsonb_array_length(coalesce(meta->'npc_buy', '[]'::jsonb)) > 0)";

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
                $term = '%'.$request->string('q').'%';
                $q->whereHas('translations', fn ($t) => $t->where('name', 'ilike', $term));
            })
            ->orderBy('id')
            ->paginate(min(max($request->integer('per_page', 60), 1), 200))
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
                'defense' => data_get($meta, 'defense'),
                'defense_mod' => data_get($meta, 'defense_mod'),
                'armor' => data_get($meta, 'armor'),
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
        $altCount = min(max($request->integer('alts', 4), 0), 8);
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

        // Pull every usable equip item once, strongest first, then bucket by slot.
        $items = $query
            ->orderByRaw("coalesce((meta->>'power')::int, 0) desc")
            ->orderBy('id')
            ->get();

        $bySlot = [];
        foreach (self::SLOTS as $slot) {
            $bySlot[$slot] = [];
        }
        foreach ($items as $item) {
            $slot = data_get($item->meta, 'equip_slot');
            if (isset($bySlot[$slot])) {
                $bySlot[$slot][] = $item;
            }
        }

        // Re-rank feet. Boots barely differ in armor (almost every pair is 2–4),
        // so ranking by armor alone lets a no-bonus prestige rare (Golden Boots,
        // armor 4) win on every vocation, while ranking by level alone hands a
        // low-level player a weak high-requirement boot over Golden's solid armor.
        // So: prefer boots made *for* the chosen vocation (their set bonuses beat
        // the flat armor stat), then highest armor, then tier (level) as the
        // tie-break. Net effect — each vocation gets its own end-game boots once
        // those unlock, but Golden Boots still wins at low level, where no
        // vocation boot is available yet.
        $vocFirst = $vocation !== '';
        usort($bySlot['feet'], function ($a, $b) use ($vocFirst) {
            $sa = $vocFirst && data_get($a->meta, 'vocations', []) !== [] ? 1 : 0;
            $sb = $vocFirst && data_get($b->meta, 'vocations', []) !== [] ? 1 : 0;

            return [$sb, (int) data_get($b->meta, 'armor', 0), (int) data_get($b->meta, 'level', 0), $a->id]
                <=> [$sa, (int) data_get($a->meta, 'armor', 0), (int) data_get($a->meta, 'level', 0), $b->id];
        });

        $result = [];
        $twoHandedWeapon = false;
        foreach (self::SLOTS as $slot) {
            // Skip slots this vocation doesn't use at all (e.g. ammo for non-paladins).
            $only = self::SLOT_VOCATIONS[$slot] ?? null;
            if ($only !== null && $vocation !== '' && ! in_array($vocation, $only, true)) {
                continue;
            }

            // A two-handed weapon (greatsword, bow, monk fist weapon…) leaves no
            // free hand, so don't crown an offhand item alongside it. SLOTS lists
            // 'weapon' before 'offhand', so the flag is set by the time we get here.
            if ($slot === 'offhand' && $twoHandedWeapon) {
                continue;
            }

            $list = $bySlot[$slot];

            // Weapon/offhand: keep only gear in this vocation's fighting style,
            // so the suggestion is the right *kind* of item, not just the one
            // with the biggest number. Empty after filtering → skip the slot.
            $styles = $vocation !== '' ? (self::STYLES[$slot][$vocation] ?? null) : null;
            if ($styles !== null) {
                $list = $this->filterByCategory($list, $styles);
            }

            // Paladins fight with bows and crossbows, not one-handed throwing
            // weapons (spears, throwing stars). Both share the "Distance Weapons"
            // category, so split them by hands: bows/crossbows are two-handed.
            if ($slot === 'weapon' && $vocation === 'paladin') {
                $list = array_values(array_filter(
                    $list,
                    fn ($i) => str_contains(strtolower((string) data_get($i->meta, 'hands')), 'two')
                ));
            }

            if (! $list) {
                continue;
            }
            $best = array_shift($list);

            if ($slot === 'weapon') {
                $twoHandedWeapon = str_contains(strtolower((string) data_get($best->meta, 'hands')), 'two');
            }

            $result[] = [
                'slot' => $slot,
                'best' => new EntryListResource($best),
                'alternatives' => EntryListResource::collection(array_slice($list, 0, $altCount)),
            ];
        }

        return $result;
    }

    /**
     * Keep only items whose `item_category` contains one of the given keywords
     * (case-insensitive), preserving the incoming power order.
     *
     * @param  iterable<\App\Models\Entry>  $items
     * @param  list<string>  $keywords
     * @return list<\App\Models\Entry>
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
