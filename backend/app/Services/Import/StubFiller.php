<?php

namespace App\Services\Import;

use App\Models\Entry;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Fills empty entries with lore/content from TibiaWiki.
 *
 * Handles both prose-based pages (cities, lore articles) and infobox-only pages
 * (items, quests, spells, NPCs, hunt locations, mounts, creatures).
 */
class StubFiller
{
    private const API = 'https://tibia.fandom.com/api.php';

    private const UA = 'TibiaAtlas/1.0 (lore research project; contact: admin@tibiaatlas.test)';

    private function http()
    {
        return Http::acceptJson()
            ->withHeaders(['User-Agent' => self::UA])
            ->timeout(20)
            ->retry(3, 400, throw: false);
    }

    /**
     * Fill empty entries with lore from TibiaWiki.
     *
     * @param  callable(string):void|null  $progress
     * @return array{filled: int, nocontent: int, missing: int, failed: int, total: int}
     */
    public function fillEmpty(bool $publishedOnly = true, int $limit = 0, int $sleepMs = 120, ?callable $progress = null): array
    {
        $targets = Entry::query()
            ->with('translations')
            ->when($publishedOnly, fn ($q) => $q->where('status', 'published'))
            ->get()
            ->filter(function (Entry $e) {
                $en = $e->translation('en');

                return ! ($en?->overview) && ! ($en?->canon) && filled($en?->name);
            })
            ->values();

        if ($limit > 0) {
            $targets = $targets->take($limit);
        }

        $stats = ['filled' => 0, 'nocontent' => 0, 'missing' => 0, 'failed' => 0, 'total' => $targets->count()];

        foreach ($targets as $i => $entry) {
            try {
                $result = $this->fetchContent($entry->translation('en')->name);
                if ($result === null) {
                    $stats['missing']++;
                } elseif (max(Str::length($result['overview'] ?? ''), Str::length($result['canon'] ?? '')) < 20) {
                    $stats['nocontent']++;
                } else {
                    $this->apply($entry, $result['overview'], $result['canon'] ?? $result['overview']);
                    $stats['filled']++;
                }
            } catch (\Throwable $e) {
                $stats['failed']++;
            }

            if ($progress && ($i + 1) % 25 === 0) {
                $progress(sprintf(
                    'filled %d · no-content %d · missing %d · failed %d / %d',
                    $stats['filled'], $stats['nocontent'], $stats['missing'], $stats['failed'], $stats['total']
                ));
            }

            if ($sleepMs > 0) {
                usleep($sleepMs * 1000);
            }
        }

        return $stats;
    }

    /**
     * Force-(re)fill a single entry, OVERWRITING whatever lore it has.
     *
     * @return 'filled'|'cleared'
     */
    public function refillEntry(Entry $entry): string
    {
        $name = $entry->translation('en')?->name;
        $result = $name ? $this->fetchContent($name) : null;

        if ($result !== null && max(Str::length($result['overview'] ?? ''), Str::length($result['canon'] ?? '')) >= 20) {
            $this->apply($entry, $result['overview'], $result['canon'] ?? $result['overview']);

            return 'filled';
        }

        $entry->translations()->where('locale', 'en')->update(['overview' => null, 'canon' => null]);

        return 'cleared';
    }

    /** Write the fetched content onto the entry's English translation. */
    private function apply(Entry $entry, string $overview, string $canon): void
    {
        $entry->translations()->updateOrCreate(
            ['locale' => 'en'],
            ['overview' => Str::limit($overview, 600, '…'), 'canon' => $canon],
        );

        $meta = $entry->meta ?? [];
        unset($meta['auto_stub']);
        $meta['imported_from'] = 'tibiawiki';
        $entry->meta = $meta;
        $entry->save();
    }

    /**
     * Fetch content for the given TibiaWiki page title.
     * Returns ['overview' => ..., 'canon' => ...] or null if page not found / no content.
     *
     * @return array{overview: string, canon: string}|null
     */
    public function fetchContent(string $title): ?array
    {
        // Handle "/Skinning" sub-pages — they're statistics tables, not lore.
        // Generate a descriptive stub from the parent item name.
        if (str_contains($title, '/Skinning')) {
            $item = trim(str_replace('/Skinning', '', $title));

            return $this->generateSkinningContent($item);
        }

        return $this->doFetchContent($title);
    }

    /** Generate a short lore-adjacent description for a skinning sub-page. */
    private function generateSkinningContent(string $itemName): array
    {
        $text = "Skinning guide for obtaining {$itemName} in Tibia. Using an Obsidian Knife on the corpse of a compatible creature can yield {$itemName} as a creature product.";

        return ['overview' => $text, 'canon' => $text];
    }

    /**
     * @internal
     *
     * @return array{overview: string, canon: string}|null
     */
    private function doFetchContent(string $title): ?array
    {
        $json = $this->http()->get(self::API, [
            'action'    => 'parse',
            'format'    => 'json',
            'page'      => $title,
            'prop'      => 'wikitext',
            'redirects' => 1,
        ])->json();

        $wikitext = $json['parse']['wikitext']['*'] ?? null;
        if (! is_string($wikitext) || $wikitext === '') {
            return null;
        }

        // Detect any infobox in the wikitext (not just at the top — some pages have {{Stub}} etc. before).
        $infoboxType = null;
        if (preg_match('/\{\{Infobox\s+([^\|}\n]+)/i', $wikitext, $m)) {
            $infoboxType = strtolower(trim($m[1]));
        }

        if ($infoboxType !== null) {
            $result = $this->extractFromInfobox($wikitext, $infoboxType);
            if ($result !== null) {
                return $result;
            }
        }

        // Fallback: look for prose in sections or lead.
        $prose = $this->extractProseFromWikitext($wikitext);

        return $prose ? ['overview' => $prose, 'canon' => $prose] : null;
    }

    /**
     * Legacy compat: kept for refillEntry calls from outside that expect a string.
     *
     * @internal
     */
    public function fetchProse(string $title): ?string
    {
        $result = $this->fetchContent($title);

        return $result ? $result['overview'] : null;
    }

    // ─── Infobox-specific extraction ────────────────────────────────────────────

    /**
     * Route to the right extractor based on the infobox type keyword.
     *
     * @return array{overview: string, canon: string}|null
     */
    private function extractFromInfobox(string $wikitext, string $type): ?array
    {
        return match (true) {
            str_starts_with($type, 'object')      => $this->describeItem($wikitext),
            str_starts_with($type, 'quest')       => $this->describeQuest($wikitext),
            str_starts_with($type, 'spell')       => $this->describeSpell($wikitext),
            str_starts_with($type, 'npc')         => $this->describeNpc($wikitext),
            str_starts_with($type, 'creature')    => $this->describeCreature($wikitext),
            str_starts_with($type, 'mount')       => $this->describeMount($wikitext),
            str_starts_with($type, 'hunt')        => $this->describeHunt($wikitext),
            str_starts_with($type, 'achievement') => $this->describeAchievement($wikitext),
            str_starts_with($type, 'corpse')      => $this->describeCorpse($wikitext),
            str_starts_with($type, 'geography')   => $this->describeGeography($wikitext),
            str_starts_with($type, 'building')    => $this->describeBuilding($wikitext),
            default                               => null,
        };
    }

    /** Items — Infobox Object */
    private function describeItem(string $w): ?array
    {
        $notes      = $this->field($w, 'notes');
        $type       = $this->field($w, 'primarytype') ?? $this->field($w, 'objectclass');
        $name       = $this->field($w, 'name') ?? $this->field($w, 'actualname');
        $droppedBy  = $this->field($w, 'droppedby');

        if (! $notes && ! $type) {
            return null;
        }

        $parts = [];

        if ($type && $name) {
            $parts[] = "{$name} is a {$type} item in Tibia.";
        }

        if ($notes) {
            $clean = $this->cleanWikitext($notes);
            if ($clean) {
                $parts[] = $clean;
            }
        }

        if ($droppedBy && ! str_contains(implode(' ', $parts), 'dropped')) {
            $mobs = $this->cleanWikitext($droppedBy);
            if ($mobs) {
                $parts[] = "Dropped by: {$mobs}.";
            }
        }

        $text = implode("\n\n", array_filter($parts));

        return $text ? ['overview' => Str::limit($text, 500, '…'), 'canon' => $text] : null;
    }

    /** Quests — Infobox Quest */
    private function describeQuest(string $w): ?array
    {
        $legend   = $this->field($w, 'legend');
        $reward   = $this->field($w, 'reward');
        $location = $this->field($w, 'location');
        $level    = $this->field($w, 'lvlrec') ?? $this->field($w, 'lvl');
        $dangers  = $this->field($w, 'dangers');
        $name     = $this->field($w, 'name');

        if (! $legend && ! $reward) {
            return null;
        }

        $overview = $legend ? $this->cleanWikitext($legend) : '';
        if ($location) {
            $loc = $this->cleanWikitext($location);
            if ($loc) {
                $overview .= ($overview ? ' ' : '') . "Located in {$loc}.";
            }
        }

        $canon = $overview;
        $extra = [];
        if ($level) {
            $extra[] = "Recommended level: {$level}";
        }
        if ($reward) {
            $extra[] = 'Reward: ' . $this->cleanWikitext($reward);
        }
        if ($dangers) {
            $extra[] = 'Dangers: ' . $this->cleanWikitext($dangers);
        }
        if ($extra) {
            $canon .= "\n\n" . implode('. ', $extra) . '.';
        }

        return ($overview || $canon)
            ? ['overview' => trim($overview) ?: trim($canon), 'canon' => trim($canon)]
            : null;
    }

    /** Spells — Infobox Spell */
    private function describeSpell(string $w): ?array
    {
        $effect  = $this->field($w, 'effect');
        $notes   = $this->field($w, 'notes');
        $words   = $this->field($w, 'words');
        $mana    = $this->field($w, 'mana');
        $level   = $this->field($w, 'levelrequired');
        $voc     = $this->field($w, 'voc');
        $name    = $this->field($w, 'name');

        $overview = $this->cleanWikitext($effect ?? '');
        if (! $overview && ! $notes) {
            return null;
        }

        $meta = [];
        if ($words) {
            $meta[] = "incantation: {$words}";
        }
        if ($mana) {
            $meta[] = "mana: {$mana}";
        }
        if ($level) {
            $meta[] = "requires level {$level}";
        }
        if ($voc) {
            $meta[] = 'usable by ' . $this->cleanWikitext($voc);
        }

        $canon = $overview;
        if ($meta) {
            $canon .= "\n\n" . ucfirst(implode(', ', $meta)) . '.';
        }
        if ($notes) {
            $n = $this->cleanWikitext($notes);
            if ($n && strlen($n) > 20) {
                $canon .= "\n\n" . $n;
            }
        }

        return ['overview' => $overview ?: Str::limit($canon, 300), 'canon' => trim($canon)];
    }

    /** NPCs — Infobox NPC */
    private function describeNpc(string $w): ?array
    {
        $notes    = $this->field($w, 'notes');
        $job      = $this->field($w, 'job');
        $job2     = $this->field($w, 'job2');
        $city     = $this->field($w, 'city');
        $location = $this->field($w, 'location');
        $name     = $this->field($w, 'name');

        $jobTitle = implode(' / ', array_filter([$job, $job2]));
        $parts    = [];

        if ($jobTitle && ($name || $city)) {
            $where = $city ? " in {$city}" : '';
            $parts[] = ($name ?? 'This NPC') . " is a {$jobTitle}{$where}.";
        }
        if ($location) {
            $parts[] = 'Location: ' . $this->cleanWikitext($location) . '.';
        }
        if ($notes) {
            $n = $this->cleanWikitext($notes);
            if ($n) {
                $parts[] = $n;
            }
        }

        $text = implode("\n\n", array_filter($parts));

        return $text ? ['overview' => Str::limit($text, 400, '…'), 'canon' => $text] : null;
    }

    /** Creatures — Infobox Creature (bestiarytext approach) */
    private function describeCreature(string $w): ?array
    {
        $bestiary = $this->field($w, 'bestiarytext');
        $notes    = $this->field($w, 'notes');

        $overview = $bestiary ? $this->cleanWikitext($bestiary) : null;
        $canon    = $overview;

        if ($notes) {
            $n = $this->cleanWikitext($notes);
            if ($n && strlen($n) > 20) {
                $canon = $overview ? "{$overview}\n\n{$n}" : $n;
            }
        }

        if (! $overview && ! $notes) {
            return null;
        }

        return ['overview' => $overview ?? Str::limit($canon ?? '', 400), 'canon' => $canon ?? ''];
    }

    /** Mounts — Infobox Mount */
    private function describeMount(string $w): ?array
    {
        $notes = $this->field($w, 'notes');
        $speed = $this->field($w, 'speed');
        $name  = $this->field($w, 'name');

        if (! $notes && ! $speed) {
            return null;
        }

        $parts = [];
        if ($name) {
            $parts[] = "{$name} is a mount in Tibia.";
        }
        if ($speed) {
            $parts[] = "Speed bonus: {$speed}.";
        }
        if ($notes) {
            $parts[] = $this->cleanWikitext($notes);
        }

        $text = implode("\n\n", array_filter($parts));

        return $text ? ['overview' => Str::limit($text, 400, '…'), 'canon' => $text] : null;
    }

    /** Hunt locations — Infobox Hunt */
    private function describeHunt(string $w): ?array
    {
        $name     = $this->field($w, 'name');
        $city     = $this->field($w, 'city');
        $location = $this->field($w, 'location');
        $best1    = $this->field($w, 'bestloot');
        $best2    = $this->field($w, 'bestloot2');
        $exp      = $this->field($w, 'exp');

        $parts = [];
        if ($name && $city) {
            $parts[] = "{$name} is a hunting ground near {$city}.";
        }
        if ($location) {
            $parts[] = 'Location: ' . $this->cleanWikitext($location) . '.';
        }
        $loot = implode(', ', array_filter([$best1, $best2]));
        if ($loot) {
            $parts[] = 'Notable loot: ' . $this->cleanWikitext($loot) . '.';
        }
        if ($exp) {
            $parts[] = "Experience: {$exp}.";
        }

        $text = implode("\n\n", array_filter($parts));

        return $text ? ['overview' => $text, 'canon' => $text] : null;
    }

    /** Corpses — Infobox Corpse */
    private function describeCorpse(string $w): ?array
    {
        $name     = $this->field($w, 'name');
        $liquid   = $this->field($w, 'liquid');
        $skinable = $this->field($w, 'skinable');
        $notes    = $this->field($w, 'notes');

        if (! $name) {
            return null;
        }

        $parts = [];
        $parts[] = "{$name} is the corpse left behind by a creature in Tibia.";
        if ($liquid) {
            $parts[] = 'Contains: ' . $this->cleanWikitext($liquid) . '.';
        }
        if ($skinable && strtolower(trim($skinable)) !== 'no' && trim($skinable) !== '?') {
            $parts[] = 'This corpse can be skinned to obtain creature products.';
        }
        if ($notes) {
            $n = $this->cleanWikitext($notes);
            if ($n) {
                $parts[] = $n;
            }
        }

        $text = implode("\n\n", array_filter($parts));

        return $text ? ['overview' => $text, 'canon' => $text] : null;
    }

    /** Achievements — Infobox Achievement */
    private function describeAchievement(string $w): ?array
    {
        $desc    = $this->field($w, 'description');
        $spoiler = $this->field($w, 'spoiler');
        $name    = $this->field($w, 'name');
        $points  = $this->field($w, 'points');
        $grade   = $this->field($w, 'grade');

        if (! $desc && ! $spoiler) {
            return null;
        }

        $parts = [];
        if ($desc) {
            $parts[] = $this->cleanWikitext($desc);
        }
        if ($spoiler) {
            $parts[] = $this->cleanWikitext($spoiler);
        }
        if ($points || $grade) {
            $info = array_filter(["Grade {$grade}", "{$points} point(s)"]);
            $parts[] = implode(', ', $info) . '.';
        }

        $text = implode("\n\n", array_filter($parts));

        return $text ? ['overview' => $text, 'canon' => $text] : null;
    }

    /** Buildings / guildhalls — build description from location fields. */
    private function describeBuilding(string $w): ?array
    {
        // Try prose sections first (some building pages have descriptive text).
        $geo = $this->describeGeography($w);
        if ($geo) {
            return $geo;
        }

        $name     = $this->field($w, 'name');
        $type     = $this->field($w, 'type');
        $location = $this->field($w, 'location');
        $city     = $this->field($w, 'city');
        $street   = $this->field($w, 'street');
        $beds     = $this->field($w, 'beds');
        $size     = $this->field($w, 'size');

        $parts = [];
        $typeName = $type ?? 'building';
        $where    = $city ? ", {$city}" : ($location ? ", {$this->cleanWikitext($location)}" : '');

        if ($name) {
            $parts[] = "{$name} is a {$typeName} in Tibia{$where}.";
        }
        if ($location && $city) {
            $parts[] = 'Located at: ' . $this->cleanWikitext($location) . '.';
        }
        if ($street) {
            $parts[] = "Address: {$street}.";
        }
        if ($size || $beds) {
            $info = array_filter([$size ? "{$size} sq tiles" : null, $beds ? "{$beds} beds" : null]);
            $parts[] = implode(', ', $info) . '.';
        }

        $text = implode("\n\n", array_filter($parts));

        return $text ? ['overview' => $text, 'canon' => $text] : null;
    }

    /** Geography / buildings — content lives in sections, not the lead infobox. */
    private function describeGeography(string $wikitext): ?array
    {
        // Strip the infobox from the top, then look for the first section's prose.
        $stripped = $this->stripTemplates($wikitext);
        $stripped = $this->stripTables($stripped);
        $stripped = preg_replace('/\[\[(?:File|Image|Category):[^\]]*\]\]/i', '', $stripped) ?? $stripped;

        // Split on section headings and grab the first non-empty section body.
        $sections = preg_split('/^==[^=].*?==\s*$/m', $stripped) ?: [$stripped];
        foreach ($sections as $section) {
            $prose = $this->cleanWikitext($section);
            $prose = preg_replace('/^.*\bredirects here\b.*$/im', '', $prose) ?? $prose;
            $prose = preg_replace('/^\s*For .{0,80}?see .{0,80}?\.$/im', '', $prose) ?? $prose;
            $prose = trim(preg_replace("/\n{3,}/", "\n\n", $prose) ?? $prose);
            if (Str::length($prose) >= 60) {
                return ['overview' => Str::limit($prose, 500, '…'), 'canon' => $prose];
            }
        }

        return null;
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    /**
     * Extract a named field value from an infobox (| field = value).
     * The value may span multiple lines; ends at the next field line or }}.
     * Uses literal \n in the lookahead — PHP's ^ inside (?=...) with /m is unreliable.
     */
    private function field(string $wikitext, string $name): ?string
    {
        // Stop at: newline then optional whitespace then | (next field) or }} (end of infobox).
        $pattern = '/\|\s*' . preg_quote($name, '/') . '\s*=[ \t]*(.*?)(?=\n\s*(?:\||\}\}))/si';
        if (preg_match($pattern, $wikitext, $m)) {
            $val = trim($m[1]);

            return $val !== '' ? $val : null;
        }

        return null;
    }

    /**
     * Extract prose from the lead or first meaningful section of a wikitext page.
     * Used as a generic fallback.
     */
    private function extractProseFromWikitext(string $wikitext): ?string
    {
        // Try the lead first (text before the first == Heading ==).
        $lead = preg_split('/^\s*==.*$/m', $wikitext, 2)[0] ?? $wikitext;
        $lead = $this->stripTemplates($lead);
        $lead = $this->stripTables($lead);
        $lead = preg_replace('/\[\[(?:File|Image|Category):[^\]]*\]\]/i', '', $lead) ?? $lead;
        $prose = $this->cleanAndFilter($lead);
        if (Str::length($prose) >= 40) {
            return $prose;
        }

        // Fall back to first section with useful prose.
        $sections = preg_split('/^==[^=].*?==\s*$/m', $wikitext) ?: [];
        foreach (array_slice($sections, 1) as $section) {
            $s = $this->stripTemplates($section);
            $s = $this->stripTables($s);
            $s = preg_replace('/\[\[(?:File|Image|Category):[^\]]*\]\]/i', '', $s) ?? $s;
            $prose = $this->cleanAndFilter($s);
            if (Str::length($prose) >= 40) {
                return $prose;
            }
        }

        return null;
    }

    private function cleanAndFilter(string $text): string
    {
        $prose = $this->cleanWikitext($text);
        $prose = preg_replace('/^.*\bredirects here\b.*$/im', '', $prose) ?? $prose;
        $prose = preg_replace('/^\s*For .{0,80}?see .{0,80}?\.$/im', '', $prose) ?? $prose;

        return trim(preg_replace("/\n{3,}/", "\n\n", $prose) ?? $prose);
    }

    /** Remove balanced {{ ... }} template blocks (handles nesting). */
    private function stripTemplates(string $w): string
    {
        $out   = '';
        $depth = 0;
        $len   = strlen($w);
        for ($i = 0; $i < $len; $i++) {
            if ($i + 1 < $len && $w[$i] === '{' && $w[$i + 1] === '{') {
                $depth++;
                $i++;

                continue;
            }
            if ($i + 1 < $len && $w[$i] === '}' && $w[$i + 1] === '}') {
                $depth = max(0, $depth - 1);
                $i++;

                continue;
            }
            if ($depth === 0) {
                $out .= $w[$i];
            }
        }

        return $out;
    }

    /** Remove wiki tables {| ... |}. */
    private function stripTables(string $w): string
    {
        return preg_replace('/\{\|.*?\|\}/s', '', $w) ?? $w;
    }

    /**
     * Reduce wiki markup to clean reading text: unwrap [[links]], drop refs and
     * HTML, normalise whitespace while keeping paragraph breaks.
     */
    private function cleanWikitext(string $text): string
    {
        $text = preg_replace('/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/', '$1', $text) ?? $text;
        $text = preg_replace('/<ref[^>]*>.*?<\/ref>/is', '', $text) ?? $text;
        $text = preg_replace('/<ref[^>]*\/>/i', '', $text) ?? $text;
        // Strip nested templates that weren't stripped at the block level.
        $text = $this->stripTemplates($text);
        $text = preg_replace('/<\/?[^>]+>/', '', $text) ?? $text;
        $text = str_replace(["'''", "''"], '', $text);
        $text = preg_replace('/^[\*#:;]+\s*/m', '', $text) ?? $text;
        $text = preg_replace('/__[A-Z]+__/', '', $text) ?? $text;
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5);

        $lines = array_map(fn ($l) => trim(preg_replace('/[ \t]+/', ' ', $l) ?? $l), explode("\n", $text));
        $text  = implode("\n", $lines);
        $text  = preg_replace("/\n{3,}/", "\n\n", $text) ?? $text;

        return trim($text);
    }
}
