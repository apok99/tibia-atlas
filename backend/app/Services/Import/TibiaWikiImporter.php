<?php

namespace App\Services\Import;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Enums\SourceType;
use App\Models\Entry;
use App\Models\ImportRun;
use App\Services\EntryService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

/**
 * Imports pages from the community TibiaWiki (MediaWiki API) as *draft* entries.
 * It never publishes automatically: imported text is raw material an editor must
 * verify and restructure — in line with "prefer accuracy over completeness".
 *
 * For creatures it additionally parses the {{Infobox Creature}} template into
 * structured stats (hitpoints, experience, immunities, weaknesses, battle cry…).
 * Imports are idempotent by slug, so bulk scrapes can be resumed safely.
 */
class TibiaWikiImporter
{
    private const API = 'https://tibia.fandom.com/api.php';

    private const UA = 'TibiaAtlas/1.0 (lore research project; contact: contact@tibiaatlas.test)';

    public function __construct(private readonly EntryService $entries) {}

    private function http()
    {
        // Retry transient failures (rate limiting / 5xx) with a back-off so a
        // hiccup never silently turns into a "creature not found" skip.
        return Http::acceptJson()
            ->withHeaders(['User-Agent' => self::UA])
            ->timeout(15)
            ->retry(2, 300, throw: false);
    }

    /**
     * The tibia.com Library "race" slug for a creature: its name lowercased with
     * all non-alphanumeric characters removed (e.g. "Minotaur Mage" → minotaurmage).
     */
    private function libraryRace(string $name): string
    {
        // Drop wiki disambiguation suffixes like "Monk (Creature)" → "Monk".
        $name = preg_replace('/\s*\([^)]*\)/', '', $name) ?? $name;

        return strtolower(preg_replace('/[^A-Za-z0-9]/', '', $name) ?? '');
    }

    /**
     * Import (or skip if already present) a single page as a draft entry.
     */
    public function import(string $title, EntryType $type = EntryType::Creature, ?int $userId = null, bool $strict = false, bool $refresh = false): ImportRun
    {
        $run = ImportRun::create([
            'source' => 'tibiawiki',
            'query' => $title,
            'status' => 'pending',
            'triggered_by' => $userId,
        ]);

        try {
            $page = $this->fetchPage($title);
            $slug = Str::slug($page['title']);

            $existing = Entry::where('slug', $slug)->first();
            // Skip fully-formed entries (unless refreshing); auto-stubs get filled in.
            if ($existing && empty($existing->meta['auto_stub']) && ! $refresh) {
                $run->update(['status' => 'skipped', 'message' => "Already exists: {$slug}."]);

                return $run->refresh();
            }

            $meta = ['imported_from' => 'tibiawiki', 'wiki_pageid' => $page['pageid'] ?? null];
            if (! empty($page['artwork'])) {
                $meta['artwork'] = $page['artwork'];
            }
            $overview = Str::limit($page['extract'], 600, '…') ?: null;
            $canon = $page['extract'] ?: null;
            $sources = [[
                'type' => SourceType::TibiaWiki->value,
                'title' => 'TibiaWiki: '.$page['title'],
                'url' => $page['url'],
            ]];
            $links = [];

            if ($type === EntryType::Creature) {
                $data = $this->fetchCreatureData($page['title']);

                // In strict (bulk) mode, skip pages without a real creature infobox.
                if ($strict && $data['params'] === []) {
                    $run->update(['status' => 'skipped', 'message' => "No creature infobox: {$slug}."]);

                    return $run->refresh();
                }

                $meta = array_merge($data['meta'], $meta);
                $links = $data['links'];

                // Keep the textual spawn location ("where it is found") so the
                // creature page can name the places next to the map button.
                if ($data['location']) {
                    $meta['location'] = $data['location'];
                }

                // Build the lore from the infobox fields ONLY — never the parsed
                // intro (that is just the rendered stat table). The Library
                // description lives in `bestiarytext`; bosses use `notes` instead.
                $bestiary = $data['overview'];   // bestiarytext
                $notes = $data['canon'];         // notes
                $overview = $bestiary ?: ($notes ?: null);

                $canonParts = array_filter([
                    $bestiary ? $notes : null,   // keep notes in Canon only if the lead came from bestiarytext
                    $data['location'] ? 'Found in: '.$data['location'] : null,
                    $data['behaviour'] ? 'Behaviour: '.$data['behaviour'] : null,
                ]);
                $canon = $canonParts ? implode("\n\n", $canonParts) : null;

                if ($overview !== null) {
                    // The bestiary/notes text is the official Tibia Library content.
                    $sources[] = [
                        'type' => SourceType::OfficialArticle->value,
                        'title' => 'Tibia Library — Creatures: '.$page['title'],
                        'url' => 'https://www.tibia.com/library/?subtopic=creatures&race='
                            .$this->libraryRace($page['title']),
                    ];
                }
            }

            $payload = [
                'slug' => $slug,
                'type' => $type->value,
                'status' => EntryStatus::Draft->value,
                'primary_image' => $page['image'] ?? null,
                'meta' => $meta,
                'translations' => [[
                    'locale' => Locale::English->value,
                    'name' => $page['title'],
                    'overview' => $overview,
                    'canon' => $canon,
                    'research_gaps' => 'Imported draft — verify, translate to Spanish, add interpretations/theories.',
                ]],
                'sources' => $sources,
            ];

            // Fill a previously auto-registered stub, or create a fresh draft.
            $entry = $existing
                ? $this->entries->update($existing, $payload)
                : $this->entries->create($payload, $userId);

            // Auto-register entities the lore links to, so cross-references resolve.
            $this->autoRegisterLinks($entry, $links, $userId);

            $run->update([
                'status' => 'success',
                'entry_id' => $entry->id,
                'payload' => $page,
                'message' => ($existing ? 'Filled' : 'Imported')." draft #{$entry->id} ({$entry->slug}).",
            ]);
        } catch (Throwable $e) {
            $run->update(['status' => 'failed', 'message' => $e->getMessage()]);
        }

        return $run->refresh();
    }

    /**
     * Resolve a bestiary name (often plural) to the canonical creature article.
     *
     * On TibiaWiki the plural form is usually a CLASS/category page with no
     * creature infobox (e.g. "Demons", "Wolves" → "Canines"), while the actual
     * creature lives at the singular ("Demon", "Wolf"). So we search and return
     * the first result that actually contains an {{Infobox Creature}}.
     */
    public function resolveTitle(string $name): ?string
    {
        $search = $this->http()->get(self::API, [
            'action' => 'query', 'format' => 'json', 'list' => 'search',
            'srsearch' => $name, 'srlimit' => 5, 'srnamespace' => 0,
        ])->json();

        $candidates = array_map(
            fn ($r) => $r['title'],
            data_get($search, 'query.search', [])
        );
        if (! $candidates) {
            return null;
        }

        // Batch-fetch the candidates' wikitext in a single request.
        $content = $this->http()->get(self::API, [
            'action' => 'query', 'format' => 'json',
            'titles' => implode('|', $candidates),
            'prop' => 'revisions', 'rvprop' => 'content', 'rvslots' => 'main',
        ])->json();

        $wikitextByTitle = [];
        foreach ((array) data_get($content, 'query.pages', []) as $pg) {
            // The wikitext is under the literal "*" key — data_get treats "*" as a
            // wildcard, so read it with direct array access instead.
            $rev = $pg['revisions'][0] ?? [];
            $wt = $rev['slots']['main']['*'] ?? $rev['*'] ?? '';
            $wikitextByTitle[$pg['title'] ?? ''] = is_string($wt) ? $wt : '';
        }

        // Return the highest-ranked search hit that actually IS a creature
        // (transcludes the infobox — class/list pages merely mention it).
        foreach ($candidates as $title) {
            if ($this->hasCreatureInfobox($wikitextByTitle[$title] ?? '')) {
                return $title;
            }
        }

        return null;
    }

    private function hasCreatureInfobox(string $wikitext): bool
    {
        // Require the exact {{Infobox Creature}} template — NOT
        // {{Infobox Creature Class}}, which class/category pages use.
        return (bool) preg_match('/\{\{\s*Infobox[ _]Creature\s*[|}\r\n]/i', $wikitext);
    }

    /**
     * For each entity the lore links to (e.g. [[Apoc]], [[Darama]]), ensure a
     * draft stub entry exists and relate it — so mentions auto-resolve to pages
     * and become clickable. Stubs are flagged so a later import can fill them.
     *
     * @param  list<string>  $titles
     */
    private function autoRegisterLinks(Entry $entry, array $titles, ?int $userId): void
    {
        $ids = [];
        foreach (array_slice(array_unique($titles), 0, 15) as $title) {
            $title = trim($title);
            // Skip namespaced links (File:, Category:, …) and lowercase common
            // words (e.g. "summon"); real entities are proper nouns.
            if ($title === '' || str_contains($title, ':') || ! preg_match('/^[A-Z]/', $title)) {
                continue;
            }
            $s = Str::slug($title);
            if ($s === '' || $s === $entry->slug) {
                continue;
            }

            $stub = Entry::where('slug', $s)->first();
            if (! $stub) {
                $stub = $this->entries->create([
                    'slug' => $s,
                    'type' => EntryType::Concept->value,
                    'status' => EntryStatus::Draft->value,
                    'meta' => ['auto_stub' => true, 'imported_from' => 'tibiawiki-link'],
                    'translations' => [[
                        'locale' => Locale::English->value,
                        'name' => $title,
                    ]],
                ], $userId);
            }
            $ids[] = $stub->id;
        }

        if ($ids) {
            $entry->relatedEntries()->syncWithoutDetaching($ids);
        }
    }

    /**
     * Scrape creatures from the curated roster file (the user's bestiary list).
     * This is the reliable source: the embeddedin enumeration also returns loot
     * pages, lairs and lists that waste calls. Each name is resolved to its real
     * creature article and imported. $limit > 0 stops after that many NEW ones.
     *
     * @return array{imported: int, skipped: int, failed: int}
     */
    public function scrapeRoster(int $limit = 0, ?int $userId = null, int $offset = 0): array
    {
        $path = database_path('data/creatures.txt');
        if (! is_file($path)) {
            return ['imported' => 0, 'skipped' => 0, 'failed' => 0];
        }

        $names = array_slice(
            array_values(array_filter(array_map('trim', file($path, FILE_IGNORE_NEW_LINES)))),
            $offset
        );

        $imported = $skipped = $failed = 0;
        foreach ($names as $name) {
            if ($limit > 0 && $imported >= $limit) {
                break;
            }
            try {
                $title = $this->resolveTitle($name);
                if ($title === null) {
                    $skipped++;

                    continue;
                }
                $run = $this->import($title, EntryType::Creature, $userId, strict: true);
                match ($run->status) {
                    'success' => $imported++,
                    'skipped' => $skipped++,
                    default => $failed++,
                };
            } catch (Throwable $e) {
                $failed++;
            }
        }

        return ['imported' => $imported, 'skipped' => $skipped, 'failed' => $failed];
    }

    /**
     * Scrape the next $limit not-yet-imported creatures (0 = as many as found).
     * Pre-filters titles whose slug already exists so repeated runs advance to
     * new creatures instead of re-checking the same first ones.
     *
     * @return array{imported: int, skipped: int, failed: int}
     */
    public function scrapeCreatures(int $limit = 15, ?int $userId = null): array
    {
        // Fetch a generous candidate window; one list call returns up to 500.
        $window = $limit > 0 ? max(500, $limit * 5) : 5000;
        $candidates = $this->listByTemplate('Infobox Creature', $window);

        // Existing non-stub slugs (auto-stubs are intentionally left to be filled).
        $existing = Entry::whereNull('meta->auto_stub')->pluck('slug')->flip();

        $imported = $skipped = $failed = 0;
        foreach ($candidates as $title) {
            if ($limit > 0 && $imported >= $limit) {
                break;
            }
            if (isset($existing[Str::slug($title)])) {
                $skipped++;

                continue;
            }

            $run = $this->import($title, EntryType::Creature, $userId, strict: true);
            match ($run->status) {
                'success' => $imported++,
                'skipped' => $skipped++,
                default => $failed++,
            };
        }

        return ['imported' => $imported, 'skipped' => $skipped, 'failed' => $failed];
    }

    /**
     * List up to $limit main-namespace page titles that transclude a template
     * (default "Infobox Creature"). This is the reliable way to enumerate every
     * creature, since the "Creatures" category also holds admin/list pages.
     *
     * @return list<string>
     */
    public function listByTemplate(string $template = 'Infobox Creature', int $limit = 50): array
    {
        $titles = [];
        $continue = null;

        do {
            $params = [
                'action' => 'query',
                'format' => 'json',
                'list' => 'embeddedin',
                'eititle' => 'Template:'.$template,
                'einamespace' => 0,            // main namespace = actual articles
                'eilimit' => min(500, $limit - count($titles)),
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
        } while ($continue && count($titles) < $limit);

        return array_slice($titles, 0, $limit);
    }

    /**
     * List up to $limit main-namespace page titles in a TibiaWiki category.
     *
     * @return list<string>
     */
    public function listCategory(string $category, int $limit = 50): array
    {
        $titles = [];
        $continue = null;

        do {
            $params = [
                'action' => 'query',
                'format' => 'json',
                'list' => 'categorymembers',
                'cmtitle' => 'Category:'.$category,
                'cmtype' => 'page',
                'cmnamespace' => 0,
                'cmlimit' => min(500, $limit - count($titles)),
            ];
            if ($continue) {
                $params['cmcontinue'] = $continue;
            }

            $json = $this->http()->get(self::API, $params)->throw()->json();

            foreach (data_get($json, 'query.categorymembers', []) as $member) {
                if (isset($member['title'])) {
                    $titles[] = $member['title'];
                }
            }

            $continue = data_get($json, 'continue.cmcontinue');
        } while ($continue && count($titles) < $limit);

        return array_slice($titles, 0, $limit);
    }

    /**
     * @return array{pageid?: int, title: string, extract: string, url: string, image: string, artwork: ?string}
     */
    private function fetchPage(string $title): array
    {
        $response = $this->http()
            ->get(self::API, [
                'action' => 'query',
                'format' => 'json',
                'prop' => 'extracts|info|pageimages',
                'inprop' => 'url',
                'piprop' => 'original',
                'explaintext' => 1,
                'redirects' => 1,
                'titles' => $title,
            ])
            ->throw()
            ->json();

        $pages = data_get($response, 'query.pages', []);
        $page = is_array($pages) ? reset($pages) : null;

        if (! $page || isset($page['missing'])) {
            throw new \RuntimeException("Page '{$title}' not found on TibiaWiki.");
        }

        $extract = trim($page['extract'] ?? '');

        // Fandom usually lacks TextExtracts, so fall back to the parsed intro.
        if ($extract === '') {
            $extract = $this->fetchIntro($page['title']);
        }

        // Profile image = the in-game SPRITE (File:<Name>.gif), not the big
        // "Official Artwork". pageimages returns the artwork, which we keep
        // separately to show below the lore.
        $spriteName = preg_replace('/\s*\([^)]*\)\s*$/', '', $page['title']);
        $sprite = 'https://tibia.fandom.com/wiki/Special:FilePath/'.rawurlencode($spriteName).'.gif';

        $original = $page['original']['source'] ?? null;
        // The pageimages original is artwork only when it's not the sprite gif.
        $artwork = ($original && ! str_ends_with(strtolower($original), '.gif')) ? $original : null;

        return [
            'pageid' => $page['pageid'] ?? null,
            'title' => $page['title'],
            'extract' => $extract,
            'url' => $page['fullurl'] ?? 'https://tibia.fandom.com/wiki/'.rawurlencode($page['title']),
            'image' => $sprite,
            'artwork' => $artwork,
        ];
    }

    /**
     * Fetch the lead section's rendered text and reduce it to clean plain text.
     */
    private function fetchIntro(string $title): string
    {
        $json = $this->http()
            ->get(self::API, [
                'action' => 'parse',
                'format' => 'json',
                'page' => $title,
                'prop' => 'text',
                'section' => 0,
                'redirects' => 1,
                'disabletoc' => 1,
            ])
            ->json();

        $html = $json['parse']['text']['*'] ?? null;
        if (! is_string($html) || $html === '') {
            return '';
        }

        $html = preg_replace('/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>.*?<\/sup>/is', '', $html) ?? $html;
        $text = trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5));

        return trim(preg_replace("/\n{3,}/", "\n\n", $text) ?? $text);
    }

    /**
     * Fetch the creature page wikitext and extract structured stats + the real
     * lore (the `bestiarytext` parameter is the official Tibia Library text).
     *
     * @return array{params: array<string,string>, meta: array<string,mixed>, overview: ?string, canon: ?string, location: ?string, behaviour: ?string, links: list<string>}
     */
    public function fetchCreatureData(string $title): array
    {
        $empty = ['params' => [], 'meta' => [], 'overview' => null, 'canon' => null, 'location' => null, 'behaviour' => null, 'links' => []];

        $json = $this->http()
            ->get(self::API, [
                'action' => 'parse',
                'format' => 'json',
                'page' => $title,
                'prop' => 'wikitext',
                'redirects' => 1,
            ])
            ->json();

        $wikitext = $json['parse']['wikitext']['*'] ?? '';
        if (! is_string($wikitext) || ! $this->hasCreatureInfobox($wikitext)) {
            return $empty;
        }

        // Single-line infobox params we care about (multi-line ones are ignored).
        $keys = [
            'hp', 'exp', 'armor', 'speed', 'mitigation', 'maxdmg',
            'primarytype', 'creatureclass', 'bestiaryclass', 'bestiarylevel', 'spawntype', 'isboss',
            'senseinvis', 'paraimmune',
            'bestiarytext', 'notes', 'location', 'behaviour', 'sounds',
            'physicaldmgmod', 'holydmgmod', 'deathdmgmod', 'firedmgmod',
            'energydmgmod', 'icedmgmod', 'earthdmgmod', 'drowndmgmod', 'hpdraindmgmod',
        ];
        $params = [];
        foreach ($keys as $key) {
            if (! preg_match('/(?im)^\s*\|\s*'.preg_quote($key, '/').'\s*=\s*(.*)$/', $wikitext, $m)) {
                continue;
            }
            $val = trim($m[1]);

            // Some infoboxes pack an empty field next to the following one on the
            // same line ("| speed = | strategy = …"). Cut at the next "| key =",
            // but only for plain values — never inside a {{template}} or [[link]].
            if ($val !== '' && $val[0] !== '{' && $val[0] !== '['
                && preg_match('/^(.*?)\s*\|\s*[a-zA-Z0-9_]+\s*=/', $val, $cut)) {
                $val = trim($cut[1]);
            }

            $params[$key] = $val;
        }

        // The attack/ability list is a multi-line {{Ability List|…}} template, so
        // capture it with balanced-brace matching rather than the single-line
        // regex above (which would stop at the first newline).
        $abilities = $this->extractBalancedField($wikitext, 'abilities');
        if ($abilities !== null) {
            $params['abilities'] = $abilities;
        }

        // Entities the lore cross-references, from [[wiki links]] in prose fields.
        $linkText = implode(' ', array_filter([
            $params['bestiarytext'] ?? '', $params['notes'] ?? '',
            $params['location'] ?? '', $params['behaviour'] ?? '',
        ]));
        $links = [];
        if (preg_match_all('/\[\[([^|\]#]+)(?:\|[^\]]*)?\]\]/', $linkText, $mm)) {
            $links = array_values(array_unique(array_map('trim', $mm[1])));
        }

        return [
            'params' => $params,
            'meta' => $this->buildCreatureMeta($params),
            'overview' => $this->cleanWikitext($params['bestiarytext'] ?? '') ?: null,
            'canon' => $this->cleanWikitext($params['notes'] ?? '') ?: null,
            'location' => $this->cleanWikitext($params['location'] ?? '') ?: null,
            'behaviour' => $this->cleanWikitext($params['behaviour'] ?? '') ?: null,
            'links' => $links,
        ];
    }

    private function hasNpcInfobox(string $wikitext): bool
    {
        return (bool) preg_match('/\{\{\s*Infobox[ _]NPC\s*[|}\r\n]/i', $wikitext);
    }

    /**
     * Remove image/media wikitext that pollutes NPC prose: <gallery> blocks and
     * [[File:…]] / [[Image:…]] embeds (whose caption pipes otherwise survive
     * cleanWikitext as junk like "thumb|right|300px").
     */
    private function stripMedia(string $text): string
    {
        $text = preg_replace('/<gallery\b[^>]*>.*?<\/gallery>/is', '', $text) ?? $text;
        $text = preg_replace('/\[\[(?:File|Image):[^\]]*\]\]/i', '', $text) ?? $text;

        return trim($text);
    }

    /**
     * Fetch an NPC page's wikitext and pull the {{Infobox NPC}} fields into
     * structured lore. NPCs have no `bestiarytext`; their descriptive lore lives
     * in `notes` (and `history`), with `job`/`location`/`city`/`race` as facts.
     *
     * @return array{params: array<string,string>, meta: array<string,mixed>, overview: ?string, canon: ?string, location: ?string, links: list<string>}
     */
    public function fetchNpcData(string $title): array
    {
        $empty = ['params' => [], 'meta' => [], 'overview' => null, 'canon' => null, 'location' => null, 'links' => []];

        $json = $this->http()
            ->get(self::API, [
                'action' => 'parse',
                'format' => 'json',
                'page' => $title,
                'prop' => 'wikitext',
                'redirects' => 1,
            ])
            ->json();

        $wikitext = $json['parse']['wikitext']['*'] ?? '';
        if (! is_string($wikitext) || ! $this->hasNpcInfobox($wikitext)) {
            return $empty;
        }

        // Single-line infobox params we care about. `notes`/`history` are prose
        // and may span lines — capture up to the next "| key =" or the closing }}.
        $keys = ['name', 'job', 'location', 'city', 'race', 'gender', 'implemented'];
        $params = [];
        foreach ($keys as $key) {
            if (! preg_match('/(?im)^\s*\|\s*'.preg_quote($key, '/').'\s*=\s*(.*)$/', $wikitext, $m)) {
                continue;
            }
            $val = trim($m[1]);
            if ($val !== '' && $val[0] !== '{' && $val[0] !== '['
                && preg_match('/^(.*?)\s*\|\s*[a-zA-Z0-9_]+\s*=/', $val, $cut)) {
                $val = trim($cut[1]);
            }
            $params[$key] = $val;
        }

        // Prose fields: grab everything up to the next "| key =" at line start,
        // or the infobox's closing "}}" on its own line. Terminating on a bare
        // "}}" would truncate at the first inline template (e.g. {{KW|Cormaya}}).
        foreach (['notes', 'history'] as $key) {
            if (preg_match('/(?is)\n\s*\|\s*'.$key.'\s*=\s*(.*?)(?:\n\s*\|\s*[a-zA-Z0-9_]+\s*=|\n\s*\}\})/', $wikitext, $m)) {
                $params[$key] = $this->stripMedia(trim($m[1]));
            }
        }

        $notes = $this->cleanWikitext($params['notes'] ?? '') ?: null;
        $history = $this->cleanWikitext($params['history'] ?? '') ?: null;
        $location = $this->cleanWikitext($params['location'] ?? '') ?: null;
        $city = $this->cleanWikitext($params['city'] ?? '') ?: null;
        $job = $this->cleanWikitext($params['job'] ?? '') ?: null;

        // Canon: state the facts (job, where), then the historical note.
        $where = $location ?: $city;
        $canon = implode("\n\n", array_filter([
            $job && ! in_array(strtolower($job), ['unknown occupation', 'none', ''], true) ? 'Occupation: '.$job.'.' : null,
            $where ? 'Found in: '.$where.($city && $location && $city !== $location ? ' ('.$city.').' : '.') : null,
            $history,
        ])) ?: null;

        $linkText = implode(' ', array_filter([$params['notes'] ?? '', $params['history'] ?? '', $params['location'] ?? '']));
        $links = [];
        if (preg_match_all('/\[\[([^|\]#]+)(?:\|[^\]]*)?\]\]/', $linkText, $mm)) {
            $links = array_values(array_unique(array_map('trim', $mm[1])));
        }

        return [
            'params' => $params,
            'meta' => $this->buildNpcMeta($params),
            'overview' => $notes,
            'canon' => $canon,
            'location' => $where,
            'links' => $links,
        ];
    }

    /**
     * @param  array<string,string>  $p
     * @return array<string,mixed>
     */
    private function buildNpcMeta(array $p): array
    {
        $meta = ['classification' => 'NPC'];
        foreach (['job', 'city', 'location', 'race', 'gender'] as $k) {
            $v = $this->cleanWikitext($p[$k] ?? '');
            if ($v !== '' && ! in_array(strtolower($v), ['unknown occupation', 'unknown', 'none'], true)) {
                $meta[$k] = $v;
            }
        }

        return $meta;
    }

    /**
     * @param  array<string,string>  $p
     * @return array<string,mixed>
     */
    private function buildCreatureMeta(array $p): array
    {
        $meta = [
            'classification' => $this->cleanWikitext($p['primarytype'] ?? $p['creatureclass'] ?? 'Creature'),
        ];
        if (! empty($p['bestiaryclass'])) {
            $meta['bestiary_class'] = $this->cleanWikitext($p['bestiaryclass']);
        }
        if (! empty($p['bestiarylevel'])) {
            $meta['difficulty'] = $this->cleanWikitext($p['bestiarylevel']);
        }
        $isBoss = ($p['isboss'] ?? '') === 'yes';
        if ($isBoss) {
            $meta['rank'] = 'Boss';
        }
        // How a creature enters the world (TibiaWiki `spawntype`). MULTI-VALUED — a
        // boss can be "Raid, Unique, Unblockable" at once (comma-/slash-separated).
        // Split, normalise casing, keep only known categories (drops "--"/markup).
        // Persisted for bosses (any spawntype) AND rare-spawn creatures that appear
        // via a raid (spawntype contains 'Raid', e.g. Midnight Panther) — the latter
        // are boss-like and surface in the map Boss Watch even without an `isboss`
        // flag. NOT stored for ordinary creatures: 'Unblockable'/'Triggered' are
        // common combat/spawn properties on normal monsters (e.g. a squirrel is
        // "Regular, Unblockable"), so only 'Raid' reliably marks a boss-tier spawn.
        $spawn = trim($this->cleanWikitext($p['spawntype'] ?? ''));
        $types = [];
        foreach (preg_split('/[,\/]+/', $spawn) as $tok) {
            $tok = ucfirst(strtolower(trim($tok)));
            if (in_array($tok, ['Raid', 'Unique', 'Unblockable', 'Triggered', 'Regular', 'Event'], true)) {
                $types[] = $tok;
            }
        }
        $types = array_values(array_unique($types));
        if ($types !== [] && ($isBoss || in_array('Raid', $types, true))) {
            $meta['spawn_type'] = $types;
        }

        // Numeric stats: strip thousands separators, then take the first number
        // (so "812.007" footnotes → 812, "8,200" → 8200, "500+" → 500).
        foreach (['hp' => 'hitpoints', 'exp' => 'experience', 'armor' => 'armor', 'speed' => 'speed'] as $src => $dst) {
            if (isset($p[$src])) {
                $clean = str_replace(',', '', explode('~', $p[$src])[0]);
                if (preg_match('/\d+/', $clean, $m)) {
                    $meta[$dst] = (int) $m[0];
                }
            }
        }
        // Max damage = sum of the numbers in the maxdmg template.
        if (! empty($p['maxdmg']) && preg_match_all('/\d+/', $p['maxdmg'], $dm)) {
            $meta['max_damage'] = array_sum(array_map('intval', $dm[0]));
        }
        if (! empty($p['mitigation']) && preg_match('/[\d.]+/', $p['mitigation'], $mm)) {
            $meta['mitigation'] = $mm[0].'%';
        }

        // Damage modifiers. Each *dmgmod is the % of damage the creature takes
        // from that element: 0% = immune, <100% = resistant, >100% = weak.
        // We keep the raw percentages in `damage_mods` (keyed by the frontend
        // element id) so the UI can show exactly *how much* extra/less damage,
        // plus the immune_to / weak_to label strings for back-compat.
        $elements = [
            'physical' => ['physical', 'Physical'], 'holy' => ['holy', 'Holy'],
            'death' => ['death', 'Death'], 'fire' => ['fire', 'Fire'],
            'energy' => ['energy', 'Energy'], 'ice' => ['ice', 'Ice'],
            'earth' => ['earth', 'Earth'], 'drown' => ['drown', 'Drown'],
            'hpdrain' => ['life_drain', 'Life drain'],
        ];
        $mods = [];
        $immune = $weak = [];
        foreach ($elements as $key => [$id, $label]) {
            $field = $p[$key.'dmgmod'] ?? null;
            if ($field === null || ! preg_match('/\d/', $field)) {
                continue;
            }
            $pct = (int) preg_replace('/\D/', '', $field);
            $mods[$id] = $pct;
            if ($pct === 0) {
                $immune[] = $label;
            } elseif ($pct > 100) {
                $weak[] = $label;
            }
        }
        if ($mods) {
            $meta['damage_mods'] = $mods;
        }
        if ($immune) {
            $meta['immune_to'] = implode(', ', $immune);
        }
        if ($weak) {
            $meta['weak_to'] = implode(', ', $weak);
        }

        // Behavioural flags.
        if (($p['senseinvis'] ?? '') === 'yes') {
            $meta['sense_invisible'] = 'Yes';
        }
        if (isset($p['paraimmune'])) {
            $meta['paralysable'] = $p['paraimmune'] === 'yes' ? 'No' : 'Yes';
        }
        // NOTE: `spawn_type` is captured (as a normalised list) in the boss block
        // above — don't re-assign it here as a raw string, or the two writers clobber
        // each other on every import.

        // Battle cry (first phrase in the sounds list).
        if (! empty($p['sounds'])) {
            $sounds = preg_replace('/\{\{Sound[ _]List\s*\|?/i', '', $p['sounds']);
            $first = trim((string) explode('|', str_replace(['}}', '{{'], '', $sounds))[0]);
            if ($first !== '' && ! str_contains($first, '=')) {
                $meta['battle_cry'] = $first;
            }
        }

        // Attacks & abilities (melee, spells, self-healing, summons, …).
        if (! empty($p['abilities'])) {
            $abilities = $this->parseAbilities($p['abilities']);
            if ($abilities) {
                $meta['abilities'] = $abilities;
            }
        }

        return $meta;
    }

    /**
     * Parse a TibiaWiki {{Ability List|…}} block into a flat, render-ready list of
     * attacks. Each child template ({{Melee}}, {{Ability|Name|dmg|element=…}},
     * {{Healing}}, {{Summon}}, {{Haste}}, …) becomes one entry; scene/animation
     * arguments are dropped. Returns [] when the field isn't an ability list.
     *
     * @return list<array<string,string>>
     */
    private function parseAbilities(string $raw): array
    {
        $raw = trim($raw);
        if (! str_starts_with($raw, '{{')) {
            return [];
        }
        $children = $this->splitTopLevelPipes(substr($raw, 2, -2));
        $head = strtolower(str_replace([' ', '_'], '', trim(array_shift($children) ?? '')));
        // If the wrapper isn't an Ability List, treat the whole block as one ability.
        if ($head !== 'abilitylist') {
            $children = [$raw];
        }

        $out = [];
        $seen = [];
        foreach ($children as $child) {
            $child = trim($child);
            if ($child === '' || ! str_starts_with($child, '{{')) {
                continue;
            }
            $ability = $this->parseAbilityTemplate($child);
            if ($ability === null) {
                continue;
            }
            $key = json_encode($ability);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = $ability;
        }

        return $out;
    }

    /**
     * Turn a single ability template into { kind?, name?, damage?, element? }.
     * Generic kinds (melee/healing/haste/summon) carry a `kind` the frontend can
     * translate; named spells pass their proper name through unchanged.
     *
     * @return array<string,string>|null
     */
    private function parseAbilityTemplate(string $tpl): ?array
    {
        // Take only the leading balanced {{…}} — an Ability List child can carry
        // trailing prose on the same line ("{{Healing|range=2,500-3,500}} (every
        // turn)"), which must not bleed into the parsed fields.
        $inner = $this->firstBalancedTemplate(trim($tpl));
        if ($inner === null) {
            return null;
        }
        $parts = $this->splitTopLevelPipes($inner);
        $tname = strtolower(str_replace([' ', '_'], '', trim(array_shift($parts) ?? '')));
        if ($tname === '') {
            return null;
        }

        $pos = [];
        $kv = [];
        foreach ($parts as $part) {
            if (preg_match('/^\s*([A-Za-z0-9_]+)\s*=(.*)$/s', $part, $m)) {
                $kv[strtolower($m[1])] = trim($m[2]);
            } elseif (($t = trim($part)) !== '') {
                $pos[] = $t;
            }
        }

        // Element can be a named arg (element=fire) or a positional word
        // ({{Ability|Great Fireball|150-250|fire}}). Named wins.
        $kvElement = isset($kv['element']) || isset($kv['elements'])
            ? $this->normalizeElement($kv['element'] ?? $kv['elements'])
            : null;
        $prune = static fn (array $a): array => array_filter($a, static fn ($v) => $v !== null && $v !== '');

        switch ($tname) {
            case 'melee':
                [$dmg, $el] = $this->damageAndElement($pos);
                return $prune(['kind' => 'melee', 'damage' => $dmg, 'element' => $kvElement ?? $el ?? 'physical']);
            case 'healing':
                [$dmg] = $this->damageAndElement($pos);
                return $prune(['kind' => 'healing', 'damage' => $kv['range'] ?? $dmg]);
            case 'haste':
                return ['kind' => 'haste'];
            case 'summon':
            case 'summons':
                $names = array_values(array_filter($pos, static fn ($v) => ! preg_match('/^\d/', $v) && ! str_contains($v, '=')));
                return $prune(['kind' => 'summon', 'name' => $names ? $this->cleanWikitext(implode(', ', $names)) : null]);
            case 'ability':
                $name = $this->cleanWikitext($pos[0] ?? '');
                if ($name === '') {
                    return null;
                }
                [$dmg, $el] = $this->damageAndElement(array_slice($pos, 1));
                return $prune(['name' => $name, 'damage' => $kv['damage'] ?? $dmg, 'element' => $kvElement ?? $el]);
            default:
                $name = $this->cleanWikitext($pos[0] ?? ucfirst($tname));
                if ($name === '') {
                    return null;
                }
                [$dmg, $el] = $this->damageAndElement(array_slice($pos, 1));
                return $prune(['name' => $name, 'damage' => $kv['damage'] ?? $dmg, 'element' => $kvElement ?? $el]);
        }
    }

    /**
     * From an ability's positional args, pull the first numeric damage range
     * ("0-120", "150-250", "160-240 …" → "160-240") and the first short element
     * or status word ("fire", "life drain", "slowed"), normalized. Thousands
     * separators are kept ("0-7,200", "1,200-6,500").
     *
     * @param  list<string>  $pos
     * @return array{0:?string,1:?string} [damage, element]
     */
    private function damageAndElement(array $pos): array
    {
        $damage = null;
        $element = null;
        foreach ($pos as $raw) {
            $r = trim((string) $raw);
            if ($damage === null && preg_match('/^\d[\d,\s]*(?:[-–]\s*\d[\d,\s]*)?\+?/u', $r, $m)) {
                $damage = rtrim(trim($m[0]), ', ');

                continue;
            }
            if ($element === null && preg_match('/^[a-zA-Z][a-zA-Z ]{0,14}$/', $r)) {
                $element = $this->normalizeElement($r);
            }
        }

        return [$damage, $element];
    }

    /** Map a TibiaWiki element name to the frontend element id (or null). */
    private function normalizeElement(string $raw): ?string
    {
        $key = strtolower(trim(explode(',', $raw)[0]));

        return match ($key) {
            'physical', 'phys' => 'physical',
            'fire' => 'fire',
            'energy' => 'energy',
            'ice' => 'ice',
            'earth' => 'earth',
            'holy' => 'holy',
            'death' => 'death',
            'drown' => 'drown',
            'lifedrain', 'life drain', 'hpdrain' => 'life_drain',
            'manadrain', 'mana drain' => 'mana_drain',
            default => $key !== '' ? $key : null,
        };
    }

    /**
     * Capture a multi-line infobox field whose value is a {{template}} (e.g.
     * `| abilities = {{Ability List|…}}`), matching nested braces so the whole
     * block is returned. Null when the field is absent or not a template.
     */
    private function extractBalancedField(string $wikitext, string $field): ?string
    {
        if (! preg_match('/(?im)^\s*\|\s*'.preg_quote($field, '/').'\s*=\s*/', $wikitext, $m, PREG_OFFSET_CAPTURE)) {
            return null;
        }
        $rest = ltrim(substr($wikitext, $m[0][1] + strlen($m[0][0])));
        if (! str_starts_with($rest, '{{')) {
            return null;
        }
        $depth = 0;
        $len = strlen($rest);
        $out = '';
        for ($i = 0; $i < $len; $i++) {
            $two = substr($rest, $i, 2);
            if ($two === '{{') {
                $depth++;
                $out .= '{{';
                $i++;
            } elseif ($two === '}}') {
                $depth--;
                $out .= '}}';
                $i++;
                if ($depth === 0) {
                    break;
                }
            } else {
                $out .= $rest[$i];
            }
        }

        return $depth === 0 ? $out : null;
    }

    /**
     * Return the inner body of the first balanced {{…}} at the start of $s,
     * ignoring anything after its closing braces. Null when $s doesn't open
     * with a template or the braces never balance.
     */
    private function firstBalancedTemplate(string $s): ?string
    {
        if (! str_starts_with($s, '{{')) {
            return null;
        }
        $depth = 0;
        $len = strlen($s);
        for ($i = 0; $i < $len; $i++) {
            $two = substr($s, $i, 2);
            if ($two === '{{') {
                $depth++;
                $i++;
            } elseif ($two === '}}') {
                $depth--;
                if ($depth === 0) {
                    return substr($s, 2, $i - 2);
                }
                $i++;
            }
        }

        return null;
    }

    /**
     * Split a template body on top-level "|", ignoring pipes nested inside
     * {{templates}} or [[links]].
     *
     * @return list<string>
     */
    private function splitTopLevelPipes(string $s): array
    {
        $parts = [];
        $buf = '';
        $depth = 0;
        $len = strlen($s);
        for ($i = 0; $i < $len; $i++) {
            $two = substr($s, $i, 2);
            if ($two === '{{' || $two === '[[') {
                $depth++;
                $buf .= $two;
                $i++;
            } elseif ($two === '}}' || $two === ']]') {
                $depth = max(0, $depth - 1);
                $buf .= $two;
                $i++;
            } elseif ($s[$i] === '|' && $depth === 0) {
                $parts[] = $buf;
                $buf = '';
            } else {
                $buf .= $s[$i];
            }
        }
        $parts[] = $buf;

        return $parts;
    }

    /**
     * Reduce wiki markup to clean reading text: unwrap [[links]], drop templates,
     * refs and HTML, and tidy whitespace.
     */
    private function cleanWikitext(string $text): string
    {
        if ($text === '') {
            return '';
        }
        // [[target|label]] → label ; [[target]] → target
        $text = preg_replace('/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/', '$1', $text) ?? $text;
        // Link/keyword display templates ({{KW|Cormaya}}, {{Item|rope}}) render as
        // their argument — keep the last non-empty one instead of dropping it.
        $text = preg_replace_callback(
            '/\{\{\s*(?:KW|Kw|Item|Creature|NPC|Npc|Location|City|Book|Outfit|Spell)\s*\|([^{}]*)\}\}/i',
            function (array $m): string {
                $parts = array_values(array_filter(array_map('trim', explode('|', $m[1])), fn ($p) => $p !== ''));

                return $parts ? end($parts) : '';
            },
            $text
        ) ?? $text;
        $text = preg_replace('/\{\{[^{}]*\}\}/', '', $text) ?? $text;   // remaining simple templates
        $text = preg_replace('/<ref[^>]*>.*?<\/ref>/is', '', $text) ?? $text;
        $text = preg_replace('/<\/?[^>]+>/', '', $text) ?? $text;       // stray HTML
        $text = str_replace(["'''", "''"], '', $text);                  // bold/italic
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5);

        return trim(preg_replace('/[ \t]+/', ' ', $text) ?? $text);
    }
}
