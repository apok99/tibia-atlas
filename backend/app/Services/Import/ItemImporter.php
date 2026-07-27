<?php

namespace App\Services\Import;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Enums\SourceType;
use App\Models\Entry;
use App\Models\ImportRun;
use App\Services\EntryService;
use App\Support\Wikitext;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

/**
 * Imports objects/items from TibiaWiki ({{Infobox Object}}) as *draft* `item`
 * entries. Unlike the creature importer it makes a single wiki call per item
 * (parse → wikitext) and builds everything from the infobox — flavor text for
 * the lead, plus structured equipment stats (slot, level/vocation requirements,
 * attack/defense/armor and a derived `power` used to rank gear in the loadout
 * configurator). Idempotent by slug so the bulk import can be resumed in batches.
 */
class ItemImporter
{
    private const API = 'https://tibia.fandom.com/api.php';

    private const UA = 'TibiaAtlas/1.0 (lore research project; contact: contact@tibiaatlas.test)';

    /** Vocation roots we recognise in the `vocrequired` field. */
    private const VOCATIONS = ['knight', 'paladin', 'sorcerer', 'druid', 'monk'];

    public function __construct(private readonly EntryService $entries) {}

    private function http()
    {
        return Http::acceptJson()
            ->withHeaders(['User-Agent' => self::UA])
            ->timeout(15)
            ->retry(2, 300, throw: false);
    }

    /**
     * Import (or skip if already present) a single object page as a draft item.
     */
    public function import(string $title, ?int $userId = null, bool $strict = true, bool $refresh = false): ImportRun
    {
        $run = ImportRun::create([
            'source' => 'tibiawiki',
            'query' => $title,
            'status' => 'pending',
            'triggered_by' => $userId,
        ]);

        try {
            $data = $this->fetchItemData($title);

            if ($data['params'] === []) {
                if ($strict) {
                    $run->update(['status' => 'skipped', 'message' => "No item infobox: {$title}."]);

                    return $run->refresh();
                }
            }

            $name = $this->cleanWikitext($data['params']['name'] ?? $title) ?: $title;
            $slug = Str::slug($name);

            // Avoid clobbering a non-item entry that happens to share the slug
            // (e.g. a creature named the same as an item) — suffix instead.
            $existing = Entry::where('slug', $slug)->first();
            if ($existing && $existing->type !== EntryType::Item) {
                $slug = $slug.'-item';
                $existing = Entry::where('slug', $slug)->first();
            }

            // Skip fully-formed items unless refreshing; auto-stubs get filled in.
            if ($existing && empty($existing->meta['auto_stub']) && ! $refresh) {
                $run->update(['status' => 'skipped', 'message' => "Already exists: {$slug}."]);

                return $run->refresh();
            }

            $meta = array_merge($data['meta'], [
                'imported_from' => 'tibiawiki',
                'wiki_pageid' => $data['pageid'],
            ]);

            $sprite = 'https://tibia.fandom.com/wiki/Special:FilePath/'.rawurlencode($name).'.gif';
            $url = 'https://tibia.fandom.com/wiki/'.rawurlencode($data['title'] ?? $title);

            $overview = $data['overview'];
            $canon = $data['canon'];

            $payload = [
                'slug' => $slug,
                'type' => EntryType::Item->value,
                'status' => EntryStatus::Draft->value,
                'primary_image' => $sprite,
                'meta' => $meta,
                'translations' => [[
                    'locale' => Locale::English->value,
                    'name' => $name,
                    'overview' => $overview,
                    'canon' => $canon,
                    'research_gaps' => 'Imported draft — verify, translate to Spanish.',
                ]],
                'sources' => [[
                    'type' => SourceType::TibiaWiki->value,
                    'title' => 'TibiaWiki: '.$name,
                    'url' => $url,
                ]],
            ];

            $entry = $existing
                ? $this->entries->update($existing, $payload)
                : $this->entries->create($payload, $userId);

            $run->update([
                'status' => 'success',
                'entry_id' => $entry->id,
                'message' => ($existing ? 'Filled' : 'Imported')." item #{$entry->id} ({$entry->slug}).",
            ]);
        } catch (Throwable $e) {
            $run->update(['status' => 'failed', 'message' => $e->getMessage()]);
        }

        return $run->refresh();
    }

    /**
     * Enumerate the next $limit not-yet-imported objects (0 = as many as found).
     * Pre-filters titles whose slug already exists so repeated runs advance to
     * new items instead of re-checking the same first ones.
     *
     * @return array{imported: int, skipped: int, failed: int}
     */
    public function scrapeItems(int $limit = 50, ?int $userId = null): array
    {
        // Always enumerate the FULL object list (cheap relative to importing):
        // $limit only bounds how many items this batch (re)imports. Capping the
        // candidate window instead would stall a batched run once the first
        // window is fully imported, never reaching the rest of the catalogue.
        $candidates = $this->listObjects(0);

        // Items already imported at the CURRENT meta schema (detail = 2) are
        // skipped; anything missing or on an older schema gets (re)imported, so
        // a batched /loop run advances until the whole catalogue is up to date.
        $done = Entry::query()
            ->ofType('item')
            ->where('meta->detail', 2)
            ->pluck('slug')
            ->flip();

        $imported = $skipped = $failed = 0;
        foreach ($candidates as $title) {
            if ($limit > 0 && $imported >= $limit) {
                break;
            }
            $slug = Str::slug($title);
            if (isset($done[$slug]) || isset($done[$slug.'-item'])) {
                $skipped++;

                continue;
            }

            // refresh: true so an item present at an older schema is overwritten
            // with the richer meta rather than skipped as "already exists".
            $run = $this->import($title, $userId, strict: true, refresh: true);
            match ($run->status) {
                'success' => $imported++,
                'skipped' => $skipped++,
                default => $failed++,
            };
        }

        return ['imported' => $imported, 'skipped' => $skipped, 'failed' => $failed];
    }

    /**
     * List main-namespace page titles that transclude {{Infobox Object}}.
     * Pass $limit = 0 to walk the entire set (used to build the skip list).
     *
     * @return list<string>
     */
    public function listObjects(int $limit = 0): array
    {
        $titles = [];
        $continue = null;

        do {
            $params = [
                'action' => 'query',
                'format' => 'json',
                'list' => 'embeddedin',
                'eititle' => 'Template:Infobox Object',
                'einamespace' => 0,
                'eilimit' => 500,
            ];
            if ($continue) {
                $params['eicontinue'] = $continue;
            }

            $json = $this->http()->get(self::API, $params)->throw()->json();

            foreach (data_get($json, 'query.embeddedin', []) as $member) {
                if (isset($member['title'])) {
                    $titles[] = $member['title'];
                }
            }

            $continue = data_get($json, 'continue.eicontinue');
        } while ($continue && ($limit === 0 || count($titles) < $limit));

        return $limit > 0 ? array_slice($titles, 0, $limit) : $titles;
    }

    /**
     * Fetch an object page's wikitext and parse the {{Infobox Object}} fields.
     *
     * @return array{pageid: ?int, title: ?string, params: array<string,string>, meta: array<string,mixed>, overview: ?string, canon: ?string}
     */
    public function fetchItemData(string $title): array
    {
        $empty = ['pageid' => null, 'title' => null, 'params' => [], 'meta' => [], 'overview' => null, 'canon' => null];

        $json = $this->http()
            ->get(self::API, [
                'action' => 'parse',
                'format' => 'json',
                'page' => $title,
                'prop' => 'wikitext|displaytitle',
                'redirects' => 1,
            ])
            ->json();

        $wikitext = $json['parse']['wikitext']['*'] ?? '';
        $pageid = $json['parse']['pageid'] ?? null;
        $resolved = $json['parse']['title'] ?? $title;

        if (! is_string($wikitext)) {
            return $empty;
        }
        $parsed = $this->parseObjectWikitext($wikitext);
        if ($parsed === null) {
            return $empty;
        }

        return ['pageid' => $pageid, 'title' => $resolved] + $parsed;
    }

    /**
     * Parse an object page's raw wikitext ({{Infobox Object}}) into params +
     * structured meta. Public so bulk backfills can batch-fetch wikitext (50
     * pages per API call) and still reuse the exact import parsing. Returns
     * null when the text carries no object infobox.
     *
     * @return ?array{params: array<string,string>, meta: array<string,mixed>, overview: ?string, canon: ?string}
     */
    public function parseObjectWikitext(string $wikitext): ?array
    {
        if (! preg_match('/\{\{\s*Infobox[ _]Object\b/i', $wikitext)) {
            return null;
        }

        // Single-line infobox params we care about.
        $keys = [
            'name', 'actualname', 'itemid', 'objectclass', 'primarytype', 'secondarytype',
            'slot', 'hands', 'weapontype', 'levelrequired', 'vocrequired',
            'attack', 'defense', 'defensemod', 'armor', 'imbueslots',
            'atk_mod', 'hit_mod', 'attrib', 'resist', 'charges',
            'fire_attack', 'earth_attack', 'energy_attack', 'ice_attack',
            'death_attack', 'holy_attack', 'drown_attack', 'physical_attack',
            'range', 'manacost', 'damagetype', 'damagerange', 'weight', 'marketable',
            'value', 'npcvalue', 'buyfrom', 'sellto', 'droppedby',
            'flavortext', 'notes',
        ];
        $params = [];
        foreach ($keys as $key) {
            // [^\S\n] = whitespace but NOT newline: with a plain \s* an EMPTY
            // param ("| notes =" as the infobox's last line) lets the match
            // spill onto the next line and capture the template's closing "}}".
            if (! preg_match('/(?im)^[^\S\n]*\|[^\S\n]*'.preg_quote($key, '/').'[^\S\n]*=[^\S\n]*(.*)$/', $wikitext, $m)) {
                continue;
            }
            $val = trim($m[1]);
            // Some infoboxes pack an empty field next to the following one on the
            // same line. Cut at the next "| key =", but never inside a template/link.
            if ($val !== '' && $val[0] !== '{' && $val[0] !== '['
                && preg_match('/^(.*?)\s*\|\s*[a-zA-Z0-9_]+\s*=/', $val, $cut)) {
                $val = trim($cut[1]);
            }
            $params[$key] = $val;
        }

        $flavor = $this->cleanWikitext($params['flavortext'] ?? '');
        $notes = $this->cleanWikitext($params['notes'] ?? '');

        return [
            'params' => $params,
            'meta' => $this->buildItemMeta($params),
            'overview' => ($flavor ?: $notes) ?: null,
            'canon' => ($flavor && $notes) ? $notes : null,
        ];
    }

    /**
     * Fetch raw wikitext for up to 50 titles in ONE MediaWiki query call,
     * resolving normalisation and redirects, keyed back by the REQUESTED title.
     * Missing pages are simply absent from the result.
     *
     * @param  list<string>  $titles
     * @return array<string, string>
     */
    public function fetchWikitextBatch(array $titles): array
    {
        $json = $this->http()
            ->get(self::API, [
                'action' => 'query',
                'format' => 'json',
                'prop' => 'revisions',
                'rvprop' => 'content',
                'rvslots' => 'main',
                'redirects' => 1,
                'titles' => implode('|', array_slice($titles, 0, 50)),
            ])
            ->json();

        // The API answers under final titles; walk each requested title through
        // the normalized (case/underscores) and redirects maps to find its page.
        $forward = [];
        foreach ((array) data_get($json, 'query.normalized', []) as $n) {
            $forward[$n['from']] = $n['to'];
        }
        foreach ((array) data_get($json, 'query.redirects', []) as $r) {
            $forward[$r['from']] = $r['to'];
        }

        $byTitle = [];
        foreach ((array) data_get($json, 'query.pages', []) as $page) {
            // NB: the content key is literally "*" — don't data_get() through
            // it, Laravel would treat it as a wildcard.
            $text = data_get($page, 'revisions.0.slots.main')['*'] ?? null;
            if (isset($page['title']) && is_string($text)) {
                $byTitle[$page['title']] = $text;
            }
        }

        $out = [];
        foreach ($titles as $title) {
            $resolved = $title;
            // Follow the mapping at most twice: normalized → redirected.
            for ($i = 0; $i < 2 && isset($forward[$resolved]); $i++) {
                $resolved = $forward[$resolved];
            }
            if (isset($byTitle[$resolved])) {
                $out[$title] = $byTitle[$resolved];
            }
        }

        return $out;
    }

    /**
     * @param  array<string,string>  $p
     * @return array<string,mixed>
     */
    private function buildItemMeta(array $p): array
    {
        $category = $this->cleanWikitext($p['primarytype'] ?? '') ?: 'Miscellaneous';
        // secondarytype refines the category — e.g. Distance Weapons split into
        // Bows / Crossbows / Throwing Weapons. The loadout configurator relies
        // on it to give paladins separate bow and crossbow cards. (Items imported
        // before this existed are covered by tibia:backfill-item-subtypes.)
        $subcategory = $this->cleanWikitext($p['secondarytype'] ?? '');
        $objectClass = $this->cleanWikitext($p['objectclass'] ?? '');

        $meta = [
            // Schema version of the item meta. Bumped to 2 when trade/loot data
            // (value, buy/sell NPCs, dropped-by) was added — the resumable import
            // re-processes any item still on an older version.
            'detail' => 2,
            'item_category' => $category,
            'item_subcategory' => $subcategory ?: null,
            'object_class' => $objectClass ?: null,
        ];

        if (! empty($p['itemid']) && preg_match('/\d+/', $p['itemid'], $idm)) {
            $meta['item_id'] = (int) $idm[0];
        }

        // Numeric combat/defence stats.
        foreach (['attack', 'defense', 'armor', 'levelrequired', 'imbueslots', 'manacost', 'range', 'charges'] as $key) {
            if (isset($p[$key]) && preg_match('/-?\d+/', str_replace(',', '', $p[$key]), $m)) {
                $dst = match ($key) {
                    'levelrequired' => 'level',
                    'imbueslots' => 'imbue_slots',
                    'manacost' => 'mana_cost',
                    default => $key,
                };
                $meta[$dst] = (int) $m[0];
            }
        }
        if (isset($p['weight']) && preg_match('/[\d.]+/', $p['weight'], $wm)) {
            $meta['weight'] = (float) $wm[0];
        }
        if (! empty($p['defensemod'])) {
            $meta['defense_mod'] = trim($p['defensemod']);
        }
        if (! empty($p['hands'])) {
            $meta['hands'] = $this->cleanWikitext($p['hands']);
        }
        if (! empty($p['weapontype'])) {
            $meta['weapon_type'] = $this->cleanWikitext($p['weapontype']);
        }
        if (! empty($p['damagetype'])) {
            $meta['damage_type'] = $this->cleanWikitext($p['damagetype']);
        }
        // Wand/rod damage range "65 (56-74)" → keep label + parse a max for ranking.
        if (! empty($p['damagerange'])) {
            $dr = $this->cleanWikitext($p['damagerange']);
            $meta['damage_range'] = $dr;
            if (preg_match_all('/\d+/', $dr, $dm)) {
                $meta['damage_max'] = max(array_map('intval', $dm[0]));
            }
        }
        if (isset($p['marketable'])) {
            $meta['marketable'] = strtolower(trim($p['marketable'])) === 'yes';
        }

        // Modern-gear modifiers: flat attack bonus and hit% ("atk_mod = 6",
        // "hit_mod = +5").
        foreach (['atk_mod', 'hit_mod'] as $key) {
            if (isset($p[$key]) && preg_match('/[+-]?\d+/', $p[$key], $m)) {
                $meta[$key] = (int) $m[0];
            }
        }
        // Elemental weapon damage lives in per-element params (Sanguine Blade:
        // "attack = 8" + "fire_attack = 46"); without this the modern element
        // weapons look laughably weak next to a plain 50-attack blade.
        $elementAttack = 0;
        $elementType = null;
        foreach (['fire', 'earth', 'energy', 'ice', 'death', 'holy', 'drown', 'physical'] as $element) {
            if (isset($p[$element.'_attack']) && preg_match('/\d+/', $p[$element.'_attack'], $m) && (int) $m[0] > 0) {
                $elementAttack += (int) $m[0];
                $elementType ??= $element;
            }
        }
        if ($elementAttack > 0) {
            $meta['element_attack'] = $elementAttack;
            $meta['element_attack_type'] = $elementType;
        }
        // Skill bonuses: "magic level +2, speed +15" → {"magic level": 2, ...}.
        if ($bonuses = $this->parseBonusList($p['attrib'] ?? '')) {
            $meta['bonuses'] = $bonuses;
        }
        // Elemental resistances: "energy +8%, ice -2%" → {"energy": 8, "ice": -2}.
        if ($resists = $this->parseBonusList($p['resist'] ?? '')) {
            $meta['resists'] = $resists;
        }

        // Worth + where to trade it.
        $value = $this->cleanWikitext($p['value'] ?? '');
        if ($value !== '' && $value !== '--') {
            $meta['value'] = $value;
        }
        if (! empty($p['npcvalue']) && preg_match('/\d+/', str_replace(',', '', $p['npcvalue']), $nm)) {
            $meta['npc_value'] = (int) $nm[0];
        }
        $buy = $this->parseNpcList($p['buyfrom'] ?? '');
        if ($buy) {
            $meta['npc_buy'] = $buy;
        }
        $sell = $this->parseNpcList($p['sellto'] ?? '');
        if ($sell) {
            $meta['npc_sell'] = $sell;
        }
        $dropped = $this->parseDroppedBy($p['droppedby'] ?? '');
        if ($dropped) {
            $meta['dropped_by'] = $dropped;
        }

        // Required vocations (empty = usable by everyone).
        $meta['vocations'] = $this->parseVocations($p['vocrequired'] ?? '');

        // Equipment slot for the loadout configurator (null = not wearable gear).
        $slot = $this->resolveSlot($this->cleanWikitext($p['slot'] ?? ''), $category, $meta);
        if ($slot !== null) {
            $meta['equip_slot'] = $slot;
            $meta['power'] = $this->rankPower($slot, $meta);
        }

        return $meta;
    }

    /**
     * Parse a comma-separated "name +N[%]" list (the wiki `attrib` and `resist`
     * fields) into a name → signed-int map. Entries without a signed number
     * (e.g. "faster regeneration") are skipped.
     *
     * @return array<string, int>
     */
    private function parseBonusList(string $raw): array
    {
        $raw = $this->cleanWikitext($raw);
        if ($raw === '' || $raw === '--') {
            return [];
        }

        $out = [];
        foreach (explode(',', $raw) as $part) {
            if (preg_match('/^\s*(.+?)\s*([+-]\s*\d+)\s*%?\s*$/', trim($part), $m)) {
                $out[strtolower($m[1])] = (int) preg_replace('/\s+/', '', $m[2]);
            }
        }

        return $out;
    }

    /**
     * Parse a TibiaWiki `buyfrom`/`sellto` field into a list of NPC deals.
     * The field is a comma-separated list of `NpcName:price` entries, where the
     * price (and a trailing `;flags` / `(location)`) is optional — e.g.
     * "Rashid, Sam:6400;sayname, H.L.:720".
     *
     * @return list<array{npc: string, price?: int}>
     */
    private function parseNpcList(string $raw): array
    {
        $raw = $this->cleanWikitext($raw);
        if ($raw === '' || $raw === '--' || strtolower($raw) === 'none') {
            return [];
        }

        $out = [];
        foreach (explode(',', $raw) as $chunk) {
            $chunk = trim($chunk);
            if ($chunk === '') {
                continue;
            }
            // NpcName  [: price]  [; flags | ( location )]
            if (! preg_match('/^([^:()]+?)\s*(?::\s*([\d,]+))?\s*(?:[;(].*)?$/', $chunk, $m)) {
                continue;
            }
            $npc = trim($m[1]);
            if ($npc === '') {
                continue;
            }
            $deal = ['npc' => $npc];
            if (! empty($m[2])) {
                $deal['price'] = (int) str_replace(',', '', $m[2]);
            }
            $out[] = $deal;
        }

        return array_slice($out, 0, 30);
    }

    /**
     * Extract the creature names from a {{Dropped By|A|B|C}} template.
     *
     * @return list<string>
     */
    private function parseDroppedBy(string $raw): array
    {
        if (! preg_match('/\{\{\s*Dropped By\s*\|(.*?)\}\}/is', $raw, $m)) {
            return [];
        }
        $names = array_filter(array_map(
            fn ($n) => $this->cleanWikitext(trim($n)),
            explode('|', $m[1])
        ));

        return array_values(array_slice(array_values($names), 0, 60));
    }

    /**
     * @return list<string>
     */
    private function parseVocations(string $raw): array
    {
        $raw = strtolower($raw);
        $found = [];
        foreach (self::VOCATIONS as $voc) {
            if (str_contains($raw, $voc)) {
                $found[] = $voc;
            }
        }

        return $found;
    }

    /**
     * Map the wiki `slot` field (+ category) to a canonical equipment slot used
     * by the configurator. Returns null for non-wearable items so they're left
     * out of the loadout. Hand items split into weapon vs offhand by category.
     *
     * @param  array<string,mixed>  $meta
     */
    private function resolveSlot(string $slot, string $category, array $meta): ?string
    {
        $cat = strtolower($category);

        // Offhand gear (left hand): shields and spellbooks.
        if (str_contains($cat, 'shield') || str_contains($cat, 'spellbook')) {
            return 'offhand';
        }

        // All weapon kinds hold the weapon slot. The wiki `slot` field is blank or
        // inconsistent for a large share of weapons (≈40% of swords/axes/clubs),
        // so key off the category — that's what every weapon category reliably
        // carries. Covers Sword/Axe/Club/Distance/Fist Fighting Weapons + Wands/Rods.
        if (str_contains($cat, 'weapon') || str_contains($cat, 'wand') || str_contains($cat, 'rod')) {
            return 'weapon';
        }

        // Ammunition / quivers occupy the ammo slot.
        if (str_contains($cat, 'ammunition') || str_contains($cat, 'quiver')) {
            return 'ammo';
        }

        // Rings / amulets: the wiki `slot` field is often blank for these, so
        // key off the category instead.
        if (str_contains($cat, 'ring')) {
            return 'finger';
        }
        if (str_contains($cat, 'amulet') || str_contains($cat, 'necklace')) {
            return 'neck';
        }

        // Body-armour categories: trust the wiki `slot` field first, then fall
        // back to the category so pieces with a blank slot still land correctly.
        return match (strtolower($slot)) {
            'head' => 'head',
            'body' => 'body',
            'legs' => 'legs',
            'feet' => 'feet',
            'weapon hand', 'two-handed', 'two handed' => 'weapon',
            'necklace', 'amulet', 'necklace slot' => 'neck',
            'ring', 'ring slot' => 'finger',
            'extra slot', 'ammo', 'ammunition slot' => 'ammo',
            default => match (true) {
                str_contains($cat, 'helmet') => 'head',
                str_contains($cat, 'armor') => 'body',
                str_contains($cat, 'legs') => 'legs',
                str_contains($cat, 'boots') => 'feet',
                default => null,
            },
        };
    }

    /**
     * A single numeric ranking value per equipment slot, so the loadout endpoint
     * can sort usable gear by "strength" without slot-specific SQL. This is a
     * rough heuristic (the in-game best-in-slot also depends on imbues, set
     * bonuses and resistances) and the UI labels it as a suggestion.
     *
     * @param  array<string,mixed>  $meta
     */
    private function rankPower(string $slot, array $meta): int
    {
        $cat = strtolower((string) ($meta['item_category'] ?? ''));
        $twoHanded = str_contains(strtolower((string) ($meta['hands'] ?? '')), 'two');

        return match ($slot) {
            'head', 'body', 'legs', 'feet' => (int) ($meta['armor'] ?? 0),
            'offhand' => (int) ($meta['defense'] ?? $meta['armor'] ?? 0),
            // Bows/crossbows (two-handed distance) carry no attack stat — the
            // damage is the ammo's — so rank them by tier (level requirement).
            // Melee, wands/rods and one-handed throwing weapons rank by attack
            // PLUS elemental attack — on modern weapons the element is the bulk
            // of the hit (Soulshredder: attack 10 + ice 47), same treatment as
            // GearRules::score().
            'weapon' => (str_contains($cat, 'distance') && $twoHanded)
                ? (int) ($meta['level'] ?? 0)
                : (int) ($meta['attack'] ?? $meta['damage_max'] ?? 0) + (int) ($meta['element_attack'] ?? 0),
            'ammo' => (int) ($meta['attack'] ?? 0) + (int) ($meta['element_attack'] ?? 0),
            // Amulets/rings vary too much to rank by one stat; the required level
            // is the best available proxy for "tier".
            'neck', 'finger' => (int) ($meta['level'] ?? 0),
            default => 0,
        };
    }

    /**
     * Reduce wiki markup to clean reading text (shared shape with the creature
     * importer): unwrap [[links]], drop templates/refs/HTML, tidy whitespace.
     */
    private function cleanWikitext(string $text): string
    {
        if ($text === '') {
            return '';
        }
        $text = preg_replace('/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/', '$1', $text) ?? $text;
        $text = Wikitext::stripTemplates($text);
        $text = preg_replace('/<ref[^>]*>.*?<\/ref>/is', '', $text) ?? $text;
        $text = preg_replace('/<\/?[^>]+>/', '', $text) ?? $text;
        $text = str_replace(["'''", "''"], '', $text);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5);
        $text = preg_replace('/[ \t]+/', ' ', $text) ?? $text;

        return Wikitext::tidy($text);
    }
}
