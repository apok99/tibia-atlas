<?php

namespace App\Http\Controllers;

use App\Enums\EntryType;
use App\Models\Entry;
use App\Support\ContentCache;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\View;
use Illuminate\Support\Str;

/**
 * Dynamic rendering for crawlers (Googlebot, Bingbot, GPTBot, ClaudeBot,
 * PerplexityBot, …). These bots largely don't execute JavaScript, so Nginx
 * routes their requests here and we serve a server-rendered HTML mirror of
 * the SPA route — same data, same meta tags — straight from the database.
 * Human visitors keep getting the static SPA bundle.
 */
class PrerenderController extends Controller
{
    private const SITE = 'https://tibiaatlas.com';

    public function render(Request $request, string $path = ''): mixed
    {
        // Resolve content locale: explicit ?lang= wins, then Accept-Language,
        // otherwise Spanish — the site's primary language and default audience.
        $lang = $request->query('lang');
        if (! in_array($lang, ['es', 'en'], true)) {
            $lang = substr((string) $request->header('Accept-Language'), 0, 2) === 'en' ? 'en' : 'es';
        }
        app()->setLocale($lang);

        $segments = array_values(array_filter(explode('/', trim($path, '/')), fn ($s) => $s !== ''));

        // Retired or duplicate SPA routes redirect client-side (App.tsx); bots
        // must get the same move as a real 301 so ranking signals consolidate
        // on the canonical URL instead of indexing a soft duplicate.
        $target = $this->redirectTarget($segments);
        if ($target !== null) {
            return redirect()->away(self::SITE.$target, 301);
        }

        // Crawlers hammer these pages and every hit is several queries; cache
        // the finished HTML per path+lang. The versioned key means any content
        // edit (which bumps ContentCache) invalidates instantly.
        $page = Cache::remember(
            ContentCache::key('prerender:page:'.$lang.':'.md5(implode('/', $segments))),
            900,
            function () use ($segments, $lang): array {
                $resp = $this->dispatch($segments, $lang);

                return [
                    'html' => $resp->getContent(),
                    'status' => $resp->getStatusCode(),
                    'robots' => $resp->headers->get('X-Robots-Tag', 'all'),
                ];
            }
        );

        return response($page['html'], $page['status'])
            ->header('Content-Type', 'text/html; charset=utf-8')
            ->header('X-Robots-Tag', $page['robots']);
    }

    private function dispatch(array $segments, string $lang): mixed
    {
        // /entry/{slug} — the real lore content. Everything else is a hub page.
        if (count($segments) === 2 && $segments[0] === 'entry') {
            return $this->entry($segments[1], $lang);
        }
        // /items/{slug} — item detail (stats, price, droppers). Items are a
        // reference catalogue kept as drafts, so this reads them directly.
        if (count($segments) === 2 && $segments[0] === 'items') {
            return $this->item($segments[1], $lang);
        }
        if (count($segments) >= 1 && $segments[0] === 'browse') {
            return $this->browse($segments[1] ?? null, $lang);
        }
        // /items hub gets a real link directory (not just meta) so the ~4k
        // item pages aren't sitemap-only orphans in the crawl graph.
        if ($segments === ['items']) {
            return $this->itemsHub($lang);
        }
        // /rashid — daily merchant location, computed server-side.
        if ($segments === ['rashid']) {
            return $this->rashid($lang);
        }

        return $this->staticPage($segments[0] ?? '', $lang);
    }

    /** Mirror of the App.tsx <Navigate> redirects, as permanent server-side moves. */
    private function redirectTarget(array $segments): ?string
    {
        return match (implode('/', $segments)) {
            'map', 'history', 'browse/npc', 'browse/city', 'browse/character' => '/',
            'quests' => '/browse/quest',
            'browse/item' => '/items',
            default => null,
        };
    }

    // ── Lore article ────────────────────────────────────────────────────────

    private function entry(string $slug, string $lang): mixed
    {
        $entry = Entry::published()
            ->with(['translations', 'sources', 'relatedEntries.translations'])
            ->where('slug', $slug)
            ->first();

        if (! $entry) {
            return $this->notFound($lang);
        }

        $tr = $entry->translation($lang);
        $name = $tr?->name ?? $entry->slug;
        $typeLabel = $entry->type->labels()[$lang] ?? $entry->type->labels()['en'];

        $lead = $tr?->overview ?: $tr?->canon ?: '';
        $location = is_string(data_get($entry->meta, 'location')) ? data_get($entry->meta, 'location') : null;
        $description = $this->entryDescription($name, $entry->type->value, $lang, $lead, $location);
        $canonical = self::SITE.'/entry/'.$entry->slug;
        $image = $entry->primary_image ?: self::SITE.'/logo.png';

        $es = $lang === 'es';
        $isCreature = $entry->type === EntryType::Creature;
        $hp = data_get($entry->meta, 'hitpoints');
        $exp = data_get($entry->meta, 'experience');
        $cls = data_get($entry->meta, 'classification');
        $spawnCount = (int) data_get($entry->meta, 'spawn_count', 0);
        $loot = $isCreature ? $this->creatureLoot($entry) : collect();

        // Semantic body: heading, every editorial section, related links, sources.
        $body = '<article>';
        $body .= '<p><a href="'.e(self::SITE.'/browse/'.$entry->type->value).'">'.e($typeLabel).'</a></p>';
        $body .= '<h1>'.e($name).'</h1>';
        if ($entry->primary_image) {
            $body .= '<img src="'.e($entry->primary_image).'" alt="'.e($name).'" width="160" height="160">';
        }

        if ($isCreature) {
            // Direct-answer lead: the one sentence a snippet/AI extractor lifts.
            // Facts first, lore after — mirrors how players actually ask.
            $answer = $es
                ? $name.' es una criatura del MMORPG Tibia'.($cls ? ' de la clase '.$cls : '').'.'
                : $name.' is a creature in the MMORPG Tibia'.($cls ? ' of the '.$cls.' class' : '').'.';
            if (is_numeric($hp)) {
                $answer .= $es
                    ? ' Tiene '.number_format((float) $hp, 0, ',', '.').' puntos de vida'
                    : ' It has '.number_format((float) $hp).' hitpoints';
                $answer .= is_numeric($exp)
                    ? ($es ? ' y da '.number_format((float) $exp, 0, ',', '.').' de experiencia.' : ' and yields '.number_format((float) $exp).' experience.')
                    : '.';
            }
            $body .= '<p>'.e($answer).'</p>';

            // "Where it spawns" — the site's differentiator, phrased like the
            // "dónde aparece X" searches. Prominent, above the lore.
            if ($location || $spawnCount > 0) {
                $body .= '<h2>'.($es ? '¿Dónde aparece '.$name.'?' : 'Where does '.$name.' spawn?').'</h2>';
                if ($location) {
                    $body .= '<p>'.e(($es ? $name.' aparece en: ' : $name.' spawns in: ').$location).'</p>';
                }
                if ($spawnCount > 0) {
                    $body .= '<p>'.e($es
                        ? 'El mapa de Tibia Atlas registra '.$spawnCount.' puntos de aparición de '.$name.', piso por piso.'
                        : 'The Tibia Atlas map records '.$spawnCount.' spawn points for '.$name.', floor by floor.')
                        .' <a href="'.e(self::SITE.'/').'">'.($es ? 'Ver el mapa interactivo' : 'See the interactive map').'</a></p>';
                }
            }
        }

        // Stat block (creature/item attributes) as a definition list — before
        // the lore so the numbers are within the first extractable screenful.
        $meta = collect($entry->meta ?? [])
            ->reject(fn ($v, $k) => is_array($v) || is_null($v) || $v === '' || in_array($k, ['spawns', 'spawn_count', 'imported_from', 'wiki_pageid', 'auto_stub', 'artwork', 'origin_image', 'note']))
            ->take(30);
        if ($meta->isNotEmpty()) {
            $body .= '<h2>'.($es ? 'Datos de '.$name : $name.' stats').'</h2><dl>';
            foreach ($meta as $k => $v) {
                $body .= '<dt>'.e($this->statLabel((string) $k, $lang)).'</dt><dd>'.e((string) $v).'</dd>';
            }
            $body .= '</dl>';
        }

        // Loot, derived from the item catalogue's dropped_by lists. Links give
        // the ~4k item pages in-content inbound links from creature pages.
        if ($loot->isNotEmpty()) {
            $body .= '<h2>'.($es ? '¿Qué suelta '.$name.'?' : 'What does '.$name.' drop?').'</h2><ul>';
            foreach ($loot as $it) {
                $itName = $it->translation($lang)?->name ?? $it->slug;
                $value = data_get($it->meta, 'value');
                $suffix = is_string($value) && preg_match('/\d/', $value) ? ' ('.$value.' gp)' : '';
                $body .= '<li><a href="'.e(self::SITE.'/items/'.$it->slug).'">'.e($itName).'</a>'.e($suffix).'</li>';
            }
            $body .= '</ul>';
        }

        $body .= $this->section($es ? 'Resumen' : 'Overview', $tr?->overview);
        $body .= $this->section($es ? 'Canon' : 'Canon', $tr?->canon);
        $body .= $this->section($es ? 'Interpretaciones' : 'Interpretations', $tr?->interpretations);
        $body .= $this->section($es ? 'Teorías' : 'Theories', $tr?->theories);

        // Related entities.
        $related = $entry->relatedEntries;
        if ($related->isNotEmpty()) {
            $body .= '<h2>'.($lang === 'es' ? 'Entidades relacionadas' : 'Related entities').'</h2><ul>';
            foreach ($related as $rel) {
                $relName = $rel->translation($lang)?->name ?? $rel->slug;
                $body .= '<li><a href="'.e(self::SITE.'/entry/'.$rel->slug).'">'.e($relName).'</a></li>';
            }
            $body .= '</ul>';
        }

        // Sources.
        if ($entry->sources->isNotEmpty()) {
            $body .= '<h2>'.($lang === 'es' ? 'Fuentes' : 'Sources').'</h2><ul>';
            foreach ($entry->sources as $src) {
                $label = e($src->title ?: ($src->url ?? 'Source'));
                $body .= $src->url
                    ? '<li><a href="'.e($src->url).'" rel="nofollow">'.$label.'</a></li>'
                    : '<li>'.$label.'</li>';
            }
            $body .= '</ul>';
        }
        $body .= '</article>';

        $jsonLd = [
            [
                '@context' => 'https://schema.org',
                '@type' => 'Article',
                'headline' => $name,
                'description' => $description,
                'inLanguage' => $lang,
                'mainEntityOfPage' => $canonical,
                'image' => $image,
                'datePublished' => $entry->published_at?->toIso8601String(),
                'dateModified' => $entry->updated_at?->toIso8601String(),
                'author' => ['@type' => 'Organization', 'name' => 'Tibia Atlas'],
                'publisher' => ['@type' => 'Organization', 'name' => 'Tibia Atlas', 'url' => self::SITE, 'logo' => self::SITE.'/logo.png'],
                'about' => $this->tibiaAbout(),
            ],
            [
                '@context' => 'https://schema.org',
                '@type' => 'BreadcrumbList',
                'itemListElement' => [
                    ['@type' => 'ListItem', 'position' => 1, 'name' => 'Tibia Atlas', 'item' => self::SITE],
                    ['@type' => 'ListItem', 'position' => 2, 'name' => $typeLabel, 'item' => self::SITE.'/browse/'.$entry->type->value],
                    ['@type' => 'ListItem', 'position' => 3, 'name' => $name, 'item' => $canonical],
                ],
            ],
        ];

        // Honest FAQ from real data (server-only): the exact questions players
        // ask an answer engine, each answered from fields rendered above.
        if ($isCreature) {
            $faq = [];
            if ($location) {
                $faq[] = [
                    'q' => $es ? '¿Dónde aparece '.$name.' en Tibia?' : 'Where does '.$name.' spawn in Tibia?',
                    'a' => $es ? $name.' aparece en: '.$location.'.' : $name.' spawns in: '.$location.'.',
                ];
            }
            if (is_numeric($hp)) {
                $faq[] = [
                    'q' => $es ? '¿Cuántos puntos de vida tiene '.$name.'?' : 'How many hitpoints does '.$name.' have?',
                    'a' => $es
                        ? $name.' tiene '.number_format((float) $hp, 0, ',', '.').' puntos de vida'.(is_numeric($exp) ? ' y da '.number_format((float) $exp, 0, ',', '.').' de experiencia' : '').'.'
                        : $name.' has '.number_format((float) $hp).' hitpoints'.(is_numeric($exp) ? ' and yields '.number_format((float) $exp).' experience' : '').'.',
                ];
            }
            if ($loot->isNotEmpty()) {
                $names = $loot->take(15)->map(fn ($it) => $it->translation($lang)?->name ?? $it->slug)->implode(', ');
                $faq[] = [
                    'q' => $es ? '¿Qué loot suelta '.$name.'?' : 'What loot does '.$name.' drop?',
                    'a' => $es ? $name.' puede soltar: '.$names.'.' : $name.' can drop: '.$names.'.',
                ];
            }
            if (count($faq) >= 2) {
                $jsonLd[] = [
                    '@context' => 'https://schema.org',
                    '@type' => 'FAQPage',
                    'mainEntity' => array_map(fn ($f) => [
                        '@type' => 'Question',
                        'name' => $f['q'],
                        'acceptedAnswer' => ['@type' => 'Answer', 'text' => $f['a']],
                    ], $faq),
                ];
            }
        }

        return $this->view([
            'lang' => $lang,
            'title' => $this->entryTitle($name, $entry->type->value, $lang),
            'ogTitle' => $name,
            'description' => $description,
            'canonical' => $canonical,
            'image' => $image,
            'ogType' => 'article',
            'jsonLd' => $jsonLd,
            'body' => $body,
        ]);
    }

    // ── Item detail ───────────────────────────────────────────────────────────

    private function item(string $slug, string $lang): mixed
    {
        // Items are a reference catalogue kept as drafts (see ItemController),
        // so no published() scope here — same as the public item API.
        $item = Entry::query()
            ->ofType(EntryType::Item)
            ->with(['translations', 'sources'])
            ->where('slug', $slug)
            ->first();

        if (! $item) {
            return $this->notFound($lang);
        }

        $tr = $item->translation($lang);
        $name = $tr?->name ?? $item->slug;
        $meta = $item->meta ?? [];
        $category = data_get($meta, 'item_category');
        $canonical = self::SITE.'/items/'.$item->slug;
        $image = $item->primary_image ?: self::SITE.'/logo.png';

        $droppers = array_values(array_filter((array) data_get($meta, 'dropped_by', [])));
        $es = $lang === 'es';

        $description = $es
            ? $name.' en Tibia'.($category ? " ({$category})" : '').': estadísticas, precio de mercado, NPCs que lo compran y venden'.($droppers ? ', y las '.count($droppers).' criaturas que lo sueltan' : '').'.'
            : $name.' in Tibia'.($category ? " ({$category})" : '').': stats, market price, NPCs that buy and sell it'.($droppers ? ', and the '.count($droppers).' creatures that drop it' : '').'.';
        $description = $this->excerpt($description);

        $npcBuy = array_values(array_filter((array) data_get($meta, 'npc_buy', []), fn ($r) => ! empty($r['npc'])));
        $npcSell = array_values(array_filter((array) data_get($meta, 'npc_sell', []), fn ($r) => ! empty($r['npc'])));
        $value = data_get($meta, 'value');
        $npcValue = data_get($meta, 'npc_value');

        $body = '<article>';
        $body .= '<p><a href="'.e(self::SITE.'/items').'">'.($es ? 'Objeto' : 'Item').'</a></p>';
        $body .= '<h1>'.e($name).'</h1>';
        if ($item->primary_image) {
            $body .= '<img src="'.e($item->primary_image).'" alt="'.e($name).'" width="64" height="64">';
        }

        // Direct price answer first — "cuánto cuesta X" in one liftable sentence.
        $priceBits = [];
        if (is_string($value) && preg_match('/\d/', $value)) {
            $priceBits[] = $es ? 'vale '.$value.' gp en el mercado' : 'is worth '.$value.' gp on the market';
        }
        if (is_numeric($npcValue)) {
            $priceBits[] = $es ? 'los NPC pagan '.number_format((float) $npcValue, 0, ',', '.').' gp' : 'NPCs pay '.number_format((float) $npcValue).' gp';
        }
        if ($priceBits) {
            $body .= '<p>'.e(($es ? $name.' en Tibia ' : $name.' in Tibia ').implode($es ? ' y ' : ' and ', $priceBits).'.').'</p>';
        }
        if ($tr?->overview) {
            $body .= '<p><em>'.e($tr->overview).'</em></p>';
        }
        if ($tr?->canon) {
            $body .= '<p>'.e($tr->canon).'</p>';
        }

        // Stat block from the curated item attributes players compare on.
        $statKeys = ['item_category', 'equip_slot', 'level', 'vocations', 'attack', 'defense', 'armor', 'damage_range', 'weight', 'imbue_slots', 'value', 'npc_value'];
        $stats = collect($statKeys)
            ->mapWithKeys(fn ($k) => [$k => data_get($meta, $k)])
            ->reject(fn ($v) => is_null($v) || $v === '' || $v === [])
            ->map(fn ($v) => is_array($v) ? implode(', ', $v) : (string) $v);
        if ($stats->isNotEmpty()) {
            $body .= '<h2>'.($es ? 'Estadísticas de '.$name : $name.' stats').'</h2><dl>';
            foreach ($stats as $k => $v) {
                $body .= '<dt>'.e($this->statLabel((string) $k, $lang)).'</dt><dd>'.e($v).'</dd>';
            }
            $body .= '</dl>';
        }

        // NPC trade — the "dónde comprar / a quién vender" answer, from the
        // wiki trade lists (NPC names; prices when the catalogue has them).
        if ($npcBuy) {
            $body .= '<h2>'.($es ? '¿Dónde comprar '.$name.'?' : 'Where to buy '.$name.'?').'</h2><ul>';
            foreach ($npcBuy as $r) {
                $label = $r['npc'].(! empty($r['city']) ? ' ('.$r['city'].')' : '').(! empty($r['price']) ? ': '.$r['price'].' gp' : '');
                $body .= '<li>'.e($label).'</li>';
            }
            $body .= '</ul>';
        }
        if ($npcSell) {
            $body .= '<h2>'.($es ? '¿A quién vender '.$name.'?' : 'Who buys '.$name.'?').'</h2>';
            if (is_numeric($npcValue)) {
                $body .= '<p>'.e($es
                    ? 'Los NPC pagan '.number_format((float) $npcValue, 0, ',', '.').' gp por '.$name.'.'
                    : 'NPCs pay '.number_format((float) $npcValue).' gp for '.$name.'.').'</p>';
            }
            $body .= '<ul>';
            foreach ($npcSell as $r) {
                $label = $r['npc'].(! empty($r['city']) ? ' ('.$r['city'].')' : '').(! empty($r['price']) ? ': '.$r['price'].' gp' : '');
                $body .= '<li>'.e($label).'</li>';
            }
            $body .= '</ul>';
        }

        // Dropped by — link the ones we document, list the rest as text.
        if ($droppers) {
            $published = Entry::query()->ofType(EntryType::Creature)->published()
                ->whereHas('translations', fn ($t) => $t->where('locale', 'en')->whereIn('name', $droppers))
                ->with(['translations' => fn ($t) => $t->where('locale', 'en')])
                ->get()
                ->mapWithKeys(fn ($c) => [$c->translations->first()?->name => $c->slug])
                ->filter();

            $body .= '<h2>'.($es ? 'Lo sueltan' : 'Dropped by').'</h2><ul>';
            foreach ($droppers as $d) {
                $body .= isset($published[$d])
                    ? '<li><a href="'.e(self::SITE.'/entry/'.$published[$d]).'">'.e($d).'</a></li>'
                    : '<li>'.e($d).'</li>';
            }
            $body .= '</ul>';
        }
        $body .= '</article>';

        // Article, not Product: Google requires offers/review on Product (in-game
        // gold can't be a valid Offer), so Product markup here would only pile
        // up Search Console errors. Article matches the lore entries' node.
        $jsonLd = [
            [
                '@context' => 'https://schema.org',
                '@type' => 'Article',
                'headline' => $name,
                'description' => $description,
                'inLanguage' => $lang,
                'mainEntityOfPage' => $canonical,
                'image' => $image,
                'dateModified' => $item->updated_at?->toIso8601String(),
                'author' => ['@type' => 'Organization', 'name' => 'Tibia Atlas'],
                'publisher' => ['@type' => 'Organization', 'name' => 'Tibia Atlas', 'url' => self::SITE, 'logo' => self::SITE.'/logo.png'],
                'about' => $this->tibiaAbout(),
            ],
            [
                '@context' => 'https://schema.org',
                '@type' => 'BreadcrumbList',
                'itemListElement' => [
                    ['@type' => 'ListItem', 'position' => 1, 'name' => 'Tibia Atlas', 'item' => self::SITE],
                    ['@type' => 'ListItem', 'position' => 2, 'name' => $es ? 'Objetos' : 'Items', 'item' => self::SITE.'/items'],
                    ['@type' => 'ListItem', 'position' => 3, 'name' => $name, 'item' => $canonical],
                ],
            ],
        ];

        return $this->view([
            'lang' => $lang,
            'title' => $this->entryTitle($name, 'item', $lang),
            'ogTitle' => $name,
            'description' => $description,
            'canonical' => $canonical,
            'image' => $image,
            'ogType' => 'article',
            'jsonLd' => $jsonLd,
            'body' => $body,
        ]);
    }

    // ── Listing hub ─────────────────────────────────────────────────────────

    private function browse(?string $type, string $lang): mixed
    {
        $typeEnum = $type ? EntryType::tryFrom($type) : null;
        // /browse/{garbage} must 404, not clone the hub under a foreign URL.
        if ($type !== null && $typeEnum === null) {
            return $this->notFound($lang);
        }
        $heading = $typeEnum
            ? ($typeEnum->labels()[$lang] ?? $typeEnum->labels()['en'])
            : ($lang === 'es' ? 'Explorar' : 'Browse');
        $canonical = self::SITE.'/browse'.($type ? '/'.$type : '');

        // Bots hammer hub pages; cache the rendered link list plus the data the
        // JSON-LD needs (cheap to store, saves a 500-row query + HTML build per
        // hit). Versioned key, so any content edit invalidates it immediately.
        $hub = Cache::remember(
            ContentCache::key('prerender:browse-hub:'.($type ?? 'all').':'.$lang),
            1800,
            function () use ($typeEnum, $lang): array {
                $query = Entry::published()->with('translations');
                if ($typeEnum) {
                    $query->ofType($typeEnum);
                }
                $count = (clone $query)->count();
                $entries = $query->orderByDesc('view_count')->limit(500)->get();

                $list = '<ul>';
                $top = [];
                foreach ($entries as $e) {
                    $n = $e->translation($lang)?->name ?? $e->slug;
                    $list .= '<li><a href="'.e(self::SITE.'/entry/'.$e->slug).'">'.e($n).'</a></li>';
                    if (count($top) < 100) {
                        $top[] = ['name' => $n, 'url' => self::SITE.'/entry/'.$e->slug];
                    }
                }

                return ['html' => $list.'</ul>', 'top' => $top, 'count' => $count];
            }
        );

        $es = $lang === 'es';
        $description = $es
            ? $heading.' de Tibia: '.$hub['count'].' artículos documentados y con fuentes en Tibia Atlas.'
            : $heading.' of Tibia: '.$hub['count'].' documented, sourced articles on Tibia Atlas.';
        $body = '<h1>'.e($heading).'</h1><p>'.e($description).'</p>'.$hub['html'];

        return $this->view([
            'lang' => $lang,
            'title' => $heading.' · Tibia Atlas',
            'ogTitle' => $heading,
            'description' => $description,
            'canonical' => $canonical,
            'image' => self::SITE.'/logo.png',
            'jsonLd' => [
                [
                    '@context' => 'https://schema.org',
                    '@type' => 'CollectionPage',
                    'name' => $heading,
                    'description' => $description,
                    'url' => $canonical,
                    'isPartOf' => ['@type' => 'WebSite', 'name' => 'Tibia Atlas', 'url' => self::SITE],
                    'about' => $this->tibiaAbout(),
                ],
                [
                    '@context' => 'https://schema.org',
                    '@type' => 'ItemList',
                    'numberOfItems' => count($hub['top']),
                    'itemListElement' => array_map(fn ($t, $i) => [
                        '@type' => 'ListItem',
                        'position' => $i + 1,
                        'name' => $t['name'],
                        'url' => $t['url'],
                    ], $hub['top'], array_keys($hub['top'])),
                ],
            ],
            'body' => $body,
        ]);
    }

    /** /items hub for crawlers: a real link directory grouped by category. */
    private function itemsHub(string $lang): mixed
    {
        $es = $lang === 'es';
        $meta = $this->staticMeta($lang)['items'];

        $groups = Cache::remember(
            ContentCache::key('prerender:items-hub:'.$lang),
            1800,
            function () use ($lang): string {
                $items = Entry::ofType(EntryType::Item)
                    ->select('slug', 'meta')
                    ->with('translations')
                    ->whereRaw(
                        "(jsonb_exists(meta, 'equip_slot')"
                        ." or jsonb_array_length(coalesce(meta->'dropped_by', '[]'::jsonb)) > 0"
                        ." or jsonb_array_length(coalesce(meta->'npc_buy', '[]'::jsonb)) > 0"
                        ." or jsonb_array_length(coalesce(meta->'npc_sell', '[]'::jsonb)) > 0)"
                    )
                    ->orderBy('slug')
                    ->limit(700)
                    ->get()
                    ->groupBy(fn ($it) => (string) (data_get($it->meta, 'item_category') ?: 'Otros'));

                $html = '';
                foreach ($items->sortKeys() as $category => $group) {
                    $html .= '<h2>'.e((string) $category).'</h2><ul>';
                    foreach ($group as $it) {
                        $n = $it->translation($lang)?->name ?? $it->slug;
                        $html .= '<li><a href="'.e(self::SITE.'/items/'.$it->slug).'">'.e($n).'</a></li>';
                    }
                    $html .= '</ul>';
                }

                return $html;
            }
        );

        return $this->view([
            'lang' => $lang,
            'title' => $meta['title'],
            'ogTitle' => $meta['h1'],
            'description' => $meta['description'],
            'canonical' => self::SITE.'/items',
            'image' => self::SITE.'/logo.png',
            'jsonLd' => [[
                '@context' => 'https://schema.org',
                '@type' => 'CollectionPage',
                'name' => $meta['h1'],
                'description' => $meta['description'],
                'url' => self::SITE.'/items',
                'isPartOf' => ['@type' => 'WebSite', 'name' => 'Tibia Atlas', 'url' => self::SITE],
                'about' => $this->tibiaAbout(),
            ]],
            'body' => '<h1>'.e($meta['h1']).'</h1><p>'.e($meta['description']).'</p>'.$groups,
        ]);
    }

    // ── Static / hub pages (home + feature pages) ────────────────────────────

    private function staticPage(string $slug, string $lang): mixed
    {
        $pages = $this->staticMeta($lang);
        $meta = $pages[$slug] ?? null;
        // Unknown paths are a hard 404 — serving the home page copy under a
        // foreign URL with a 200 reads as thousands of soft duplicates.
        if ($meta === null) {
            return $this->notFound($lang);
        }
        $canonical = self::SITE.($slug ? '/'.$slug : '');

        $body = '<h1>'.e($meta['h1']).'</h1><p>'.e($meta['description']).'</p>';

        // The home page doubles as the site map for crawlers: link every hub
        // with descriptive anchor text (the anchor is a ranking signal).
        if ($slug === '') {
            $es = $lang === 'es';
            $nav = [
                'browse/creature' => $es ? 'Bestiario de Tibia' : 'Tibia bestiary',
                'browse/location' => $es ? 'Lugares del mundo de Tibia' : 'Places of the Tibian world',
                'browse/organization' => $es ? 'Organizaciones y facciones' : 'Organizations and factions',
                'browse/quest' => $es ? 'Misiones de Tibia' : 'Tibia quests',
                'browse/event' => $es ? 'Eventos históricos' : 'Historical events',
                'browse/concept' => $es ? 'Conceptos del lore' : 'Lore concepts',
                'items' => $es ? 'Catálogo de items de Tibia' : 'Tibia item catalogue',
                'killstats' => $es ? 'Boss tracker y estadísticas de muertes' : 'Boss tracker and kill statistics',
                'rashid' => $es ? '¿Dónde está Rashid hoy?' : 'Where is Rashid today?',
                'soundtrack' => $es ? 'La música de Tibia' : 'The music of Tibia',
                'wordle' => $es ? 'Bestiordle, el wordle de Tibia' : 'Bestiordle, the Tibia wordle',
                'geo' => $es ? 'El Cartógrafo: adivina la zona del mapa' : 'The Cartographer: guess the map zone',
                'altar' => $es ? 'Altar del Bestiario: adivina la silueta' : 'Bestiary Altar: guess the silhouette',
                'about' => $es ? 'Sobre Tibia Atlas' : 'About Tibia Atlas',
            ];
            $body .= '<nav><ul>';
            foreach ($nav as $href => $label) {
                $body .= '<li><a href="'.e(self::SITE.'/'.$href).'">'.e($label).'</a></li>';
            }
            $body .= '</ul></nav>';

            // Surface the most popular lore so bots reach real content one hop
            // in. The home page is every crawler's first stop — cache the
            // rendered list instead of querying the top-50 on each hit.
            $body .= Cache::remember(
                ContentCache::key('prerender:home-top:'.$lang),
                1800,
                function () use ($lang): string {
                    $top = Entry::published()->with('translations')->orderByDesc('view_count')->limit(50)->get();
                    if ($top->isEmpty()) {
                        return '';
                    }

                    $list = '<h2>'.($lang === 'es' ? 'Destacados' : 'Featured').'</h2><ul>';
                    foreach ($top as $e) {
                        $n = $e->translation($lang)?->name ?? $e->slug;
                        $list .= '<li><a href="'.e(self::SITE.'/entry/'.$e->slug).'">'.e($n).'</a></li>';
                    }

                    return $list.'</ul>';
                }
            );
        }

        // Home mirrors MapPage.tsx: WebSite + Organization + the full VideoGame
        // node. Feature pages get a WebPage node tied to the game entity.
        $jsonLd = $slug === ''
            ? [
                [
                    '@context' => 'https://schema.org',
                    '@type' => 'WebSite',
                    'name' => 'Tibia Atlas',
                    'alternateName' => ['Atlas de Tibia', 'Wiki de Tibia en español', 'Guía de Tibia en español', 'Mapa de Tibia'],
                    'description' => 'La guía de Tibia en español: mapa interactivo, bestiario, loot, items y lore.',
                    'url' => self::SITE,
                    'inLanguage' => ['es', 'en'],
                    'about' => ['@id' => self::SITE.'/#tibia'],
                    'potentialAction' => [
                        '@type' => 'SearchAction',
                        'target' => ['@type' => 'EntryPoint', 'urlTemplate' => self::SITE.'/browse?q={search_term_string}'],
                        'query-input' => 'required name=search_term_string',
                    ],
                ],
                [
                    '@context' => 'https://schema.org',
                    '@type' => 'Organization',
                    '@id' => self::SITE.'/#org',
                    'name' => 'Tibia Atlas',
                    'url' => self::SITE,
                    'logo' => self::SITE.'/logo.png',
                ],
                [
                    '@context' => 'https://schema.org',
                    '@type' => 'VideoGame',
                    '@id' => self::SITE.'/#tibia',
                    'name' => 'Tibia',
                    'url' => 'https://www.tibia.com',
                    'sameAs' => ['https://en.wikipedia.org/wiki/Tibia_(video_game)', 'https://www.wikidata.org/wiki/Q616401'],
                    'author' => ['@type' => 'Organization', 'name' => 'CipSoft GmbH', 'url' => 'https://www.cipsoft.com'],
                    'publisher' => ['@type' => 'Organization', 'name' => 'CipSoft GmbH'],
                    'genre' => 'MMORPG',
                    'gamePlatform' => ['PC'],
                    'playMode' => 'MultiPlayer',
                    'datePublished' => '1997-01-07',
                    'operatingSystem' => ['Windows', 'Linux', 'macOS'],
                    'applicationCategory' => 'Game',
                ],
            ]
            : [[
                '@context' => 'https://schema.org',
                '@type' => 'WebPage',
                'name' => $meta['h1'],
                'description' => $meta['description'],
                'url' => $canonical,
                'inLanguage' => $lang,
                'isPartOf' => ['@type' => 'WebSite', 'name' => 'Tibia Atlas', 'url' => self::SITE],
                'about' => $this->tibiaAbout(),
            ]];

        return $this->view([
            'lang' => $lang,
            'title' => $meta['title'],
            'ogTitle' => $meta['h1'],
            'description' => $meta['description'],
            'canonical' => $canonical,
            'image' => self::SITE.'/logo.png',
            'jsonLd' => $jsonLd,
            'body' => $body,
        ]);
    }

    /** @return array<string, array{title:string,h1:string,description:string}> */
    private function staticMeta(string $lang): array
    {
        $es = $lang === 'es';

        return [
            '' => [
                'title' => 'Tibia Atlas — '.($es ? 'Mapa, bestiario y guía de Tibia en español' : 'Interactive map, bestiary and guide to Tibia'),
                'h1' => $es ? 'Tibia Atlas — la guía de Tibia en español' : 'Tibia Atlas — the atlas of Tibia',
                'description' => $es
                    ? 'La guía de Tibia en español: mapa interactivo con dónde aparece cada criatura piso por piso, rutas entre ciudades, casas, bestiario, más de 4.000 items con precios y dónde venderlos, boss tracker y el lore de Tibia. Con juegos diarios.'
                    : "The Tibia guide: an interactive map with every creature's spawns floor by floor, routes between cities, houses, a bestiary, 4,000+ items with prices and where to sell them, a live boss tracker and Tibia lore. Plus daily games.",
            ],
            'items' => [
                'title' => ($es ? 'Items de Tibia: precios, stats y dónde comprarlos' : 'Tibia items: prices, stats and where to buy them').' · Tibia Atlas',
                'h1' => $es ? 'El Álbum de Items de Tibia' : 'The Tibia Item Album',
                'description' => $es
                    ? 'Más de 4.000 items de Tibia con estadísticas, precio de mercado, qué criaturas los sueltan y qué NPC los compran o venden. Con configurador de equipo.'
                    : '4,000+ Tibia items with stats, market price, which creatures drop them and which NPCs buy or sell them. With a loadout configurator.',
            ],
            'killstats' => [
                'title' => ($es ? 'Boss tracker y estadísticas de muertes de Tibia' : 'Tibia boss tracker and kill statistics').' · Tibia Atlas',
                'h1' => $es ? 'Boss tracker y estadísticas de muertes de Tibia' : 'Tibia boss tracker and kill statistics',
                'description' => $es
                    ? 'Rastrea los bosses de Tibia: qué bosses han muerto en cada mundo, cuáles podrían estar disponibles y las estadísticas de muertes en directo.'
                    : 'Track Tibia bosses: which bosses died on each world, which may be up right now, and live kill statistics across worlds.',
            ],
            'soundtrack' => [
                'title' => ($es ? 'La música de Tibia' : 'The Music of Tibia').' · Tibia Atlas',
                'h1' => $es ? 'La música de Tibia' : 'The Music of Tibia',
                'description' => $es ? 'La banda sonora de Tibia para escuchar mientras exploras el mapa.' : 'The Tibia soundtrack to listen to while you explore the map.',
            ],
            'wordle' => [
                'title' => ($es ? 'Bestiordle — el wordle de criaturas de Tibia' : 'Bestiordle — the Tibia creature wordle').' · Tibia Atlas',
                'h1' => 'Bestiordle',
                'description' => $es
                    ? 'El wordle de Tibia: adivina la criatura del día por sus pistas. Un juego diario gratuito para jugadores de Tibia.'
                    : 'The Tibia wordle: guess the creature of the day from its clues. A free daily game for Tibia players.',
            ],
            'geo' => [
                'title' => ($es ? 'El Cartógrafo — adivina la zona del mapa de Tibia' : 'The Cartographer — guess the Tibia map zone').' · Tibia Atlas',
                'h1' => $es ? 'El Cartógrafo' : 'The Cartographer',
                'description' => $es
                    ? 'Juego diario del mapa de Tibia: observa un recorte del mapa y adivina a qué zona del mundo pertenece. Un reto nuevo cada día.'
                    : 'A daily Tibia map game: study a slice of the map and guess which zone of the world it belongs to. A new challenge every day.',
            ],
            'altar' => [
                'title' => ($es ? 'Altar del Bestiario — adivina la criatura por su silueta' : 'Bestiary Altar — guess the creature by its silhouette').' · Tibia Atlas',
                'h1' => $es ? 'El Altar del Bestiario' : 'The Bestiary Altar',
                'description' => $es
                    ? 'Juego diario de siluetas de Tibia: una criatura velada en sombra y un solo intento al día para nombrarla.'
                    : 'A daily Tibia silhouette game: one creature veiled in shadow, one guess a day to name it.',
            ],
            'about' => [
                'title' => ($es ? 'Sobre Tibia Atlas' : 'About Tibia Atlas').' · Tibia Atlas',
                'h1' => $es ? 'Sobre Tibia Atlas' : 'About Tibia Atlas',
                'description' => $es
                    ? 'Qué es Tibia Atlas: un proyecto de fans que documenta el mundo de Tibia — mapa interactivo, bestiario, items y lore — en español e inglés. No afiliado a CipSoft.'
                    : 'What Tibia Atlas is: a fan project documenting the world of Tibia — interactive map, bestiary, items and lore — in Spanish and English. Not affiliated with CipSoft.',
            ],
        ];
    }

    /** Real 404: minimal noindex page with a link home, no canonical. */
    private function notFound(string $lang): mixed
    {
        $es = $lang === 'es';

        return $this->view([
            'lang' => $lang,
            'title' => ($es ? 'Página no encontrada' : 'Page not found').' · Tibia Atlas',
            'ogTitle' => $es ? 'Página no encontrada' : 'Page not found',
            'description' => $es ? 'Esta página no existe en Tibia Atlas.' : 'This page does not exist on Tibia Atlas.',
            'canonical' => null,
            'image' => self::SITE.'/logo.png',
            'jsonLd' => [],
            'noindex' => true,
            'body' => '<h1>404</h1><p>'
                .($es ? 'Esta página no existe. Vuelve al ' : 'This page does not exist. Return to the ')
                .'<a href="'.self::SITE.'/">'.($es ? 'mapa de Tibia' : 'map of Tibia').'</a>.</p>',
        ], 404);
    }

    /**
     * /rashid — "¿Dónde está Rashid hoy?", the classic daily query. Rotation
     * switches at the 10:00 Europe/Berlin server save. Mirrors RashidPage.tsx
     * (same copy, same rotation) — edit both together.
     */
    private function rashid(string $lang): mixed
    {
        $es = $lang === 'es';
        $now = now('Europe/Berlin');
        $isoDay = $now->hour < 10 ? $now->copy()->subDay()->dayOfWeekIso : $now->dayOfWeekIso;

        // City, spot, and exact map coordinates (x, y, floor) — mirrored from
        // frontend/src/lib/rashid.ts (coordinates sourced from the OT data).
        $rotation = [
            1 => ['Svargrond', $es ? 'en el bar del edificio más al norte (sede del Baltic Trader)' : 'in the bar of the northernmost building (Baltic Trader HQ)', 32207, 31155, 7],
            2 => ['Liberty Bay', $es ? 'en la taberna al oeste del depot' : 'in the tavern west of the depot', 32300, 32837, 7],
            3 => ['Port Hope', $es ? 'en la taberna de Clyde, junto al barco' : "in Clyde's tavern near the ship", 32577, 32753, 7],
            4 => ['Ankrahmun', $es ? 'en la taberna cerca del barco' : 'in the tavern near the ship', 33066, 32879, 6],
            5 => ['Darashia', $es ? 'en la taberna de Miraia' : "in Miraia's tavern", 33235, 32483, 7],
            6 => ['Edron', $es ? 'en la taberna de Mirabell, encima del depot' : "in Mirabell's tavern above the depot", 33166, 31810, 6],
            7 => ['Carlin', $es ? 'en el depot, una planta arriba' : 'in the depot, one floor up', 32328, 31782, 6],
        ];
        $dayNames = $es
            ? [1 => 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
            : [1 => 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        [$city, $spot, $x, $y, $z] = $rotation[$isoDay];
        $answer = $es
            ? 'Hoy es '.$dayNames[$isoDay].': Rashid está en '.$city.', '.$spot.'.'
            : 'Today is '.$dayNames[$isoDay].': Rashid is in '.$city.', '.$spot.'.';
        $change = $es
            ? 'Rashid cambia de ciudad cada día en el server save de las 10:00 CET (hora de Europa/Berlín).'
            : 'Rashid moves to the next city every day at the 10:00 CET server save (Europe/Berlin time).';

        $title = $es
            ? '¿Dónde está Rashid hoy? Ubicación de hoy y rotación semanal — Tibia · Tibia Atlas'
            : "Where is Rashid today? Today's location and weekly rotation — Tibia · Tibia Atlas";
        $description = $es
            ? 'Dónde está Rashid hoy en Tibia: la ciudad de hoy en su rotación semanal, a qué hora cambia (server save de las 10:00 CET) y la lista completa de días y ciudades.'
            : "Where Rashid is today in Tibia: today's city in his weekly rotation, when it changes (10:00 CET server save) and the full day-by-day list.";

        $body = '<article><h1>'.($es ? '¿Dónde está Rashid hoy?' : 'Where is Rashid today?').'</h1>';
        $body .= '<p>'.e($answer).'</p><p>'.e($change).'</p>';
        $body .= '<h2>'.($es ? 'Rotación semanal de Rashid' : "Rashid's weekly rotation").'</h2><table>';
        $body .= '<tr><th>'.($es ? 'Día' : 'Day').'</th><th>'.($es ? 'Ciudad' : 'City').'</th><th>'.($es ? 'Dónde exactamente' : 'Exact spot').'</th><th>'.($es ? 'Coordenadas' : 'Coordinates').'</th></tr>';
        foreach ($rotation as $d => [$c, $s, $rx, $ry, $rz]) {
            $body .= '<tr><td>'.e(ucfirst($dayNames[$d])).'</td><td>'.e($c).'</td><td>'.e($s).'</td><td>'.$rx.', '.$ry.', z'.$rz.'</td></tr>';
        }
        $body .= '</table>';
        $body .= '<h2>'.($es ? '¿Quién es Rashid?' : 'Who is Rashid?').'</h2>';
        $body .= '<p>'.e($es
            ? 'Rashid es el mercader viajero de Tibia: compra productos de criaturas y objetos raros a buen precio. Para comerciar con él hay que completar la quest The Travelling Trader.'
            : 'Rashid is the travelling merchant of Tibia: he buys creature products and rare items at good prices. Trading with him requires completing The Travelling Trader quest.').'</p>';
        $body .= '<p><a href="'.e(self::SITE.'/#x='.$x.'&y='.$y.'&z=4&f='.$z).'">'.($es ? 'Ver a Rashid en el mapa interactivo' : 'See Rashid on the interactive map').'</a></p></article>';

        return $this->view([
            'lang' => $lang,
            'title' => $title,
            'ogTitle' => $es ? '¿Dónde está Rashid hoy?' : 'Where is Rashid today?',
            'description' => $description,
            'canonical' => self::SITE.'/rashid',
            'image' => self::SITE.'/logo.png',
            'jsonLd' => [[
                '@context' => 'https://schema.org',
                '@type' => 'FAQPage',
                'mainEntity' => [
                    [
                        '@type' => 'Question',
                        'name' => $es ? '¿Dónde está Rashid hoy?' : 'Where is Rashid today?',
                        'acceptedAnswer' => ['@type' => 'Answer', 'text' => $answer],
                    ],
                    [
                        '@type' => 'Question',
                        'name' => $es ? '¿Cuándo cambia Rashid de ciudad?' : 'When does Rashid move to the next city?',
                        'acceptedAnswer' => ['@type' => 'Answer', 'text' => $change],
                    ],
                ],
            ]],
            'body' => $body,
        ]);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** Compact `about` reference tying content to the Tibia game entity. */
    private function tibiaAbout(): array
    {
        return [
            '@type' => 'VideoGame',
            'name' => 'Tibia',
            'url' => 'https://www.tibia.com',
            'sameAs' => ['https://en.wikipedia.org/wiki/Tibia_(video_game)', 'https://www.wikidata.org/wiki/Q616401'],
        ];
    }

    /** Items this creature drops, derived from the catalogue's dropped_by lists. */
    private function creatureLoot(Entry $entry): \Illuminate\Support\Collection
    {
        // dropped_by holds English creature names, so match on the EN name.
        $enName = $entry->translation('en')?->name ?? $entry->slug;

        return Entry::query()
            ->ofType(EntryType::Item)
            ->with('translations')
            ->whereRaw("coalesce(meta->'dropped_by', '[]'::jsonb) @> ?::jsonb", [json_encode([$enName])])
            ->orderByRaw("case when meta->>'value' ~ '^[0-9][0-9,.]*$' then translate(meta->>'value', ',.', '')::bigint else 0 end desc")
            ->limit(40)
            ->get();
    }

    /** Human label for a meta stat key, in the page language. */
    private function statLabel(string $key, string $lang): string
    {
        $labels = [
            'hitpoints' => ['es' => 'Puntos de vida', 'en' => 'Hit points'],
            'experience' => ['es' => 'Experiencia', 'en' => 'Experience'],
            'armor' => ['es' => 'Armadura', 'en' => 'Armor'],
            'speed' => ['es' => 'Velocidad', 'en' => 'Speed'],
            'classification' => ['es' => 'Clasificación', 'en' => 'Classification'],
            'battle_cry' => ['es' => 'Grito de batalla', 'en' => 'Battle cry'],
            'gold_per_kill' => ['es' => 'Oro medio por muerte', 'en' => 'Average gold per kill'],
            'item_category' => ['es' => 'Categoría', 'en' => 'Category'],
            'equip_slot' => ['es' => 'Ranura de equipo', 'en' => 'Equip slot'],
            'level' => ['es' => 'Nivel requerido', 'en' => 'Required level'],
            'vocations' => ['es' => 'Vocaciones', 'en' => 'Vocations'],
            'attack' => ['es' => 'Ataque', 'en' => 'Attack'],
            'defense' => ['es' => 'Defensa', 'en' => 'Defense'],
            'damage_range' => ['es' => 'Daño', 'en' => 'Damage'],
            'weight' => ['es' => 'Peso', 'en' => 'Weight'],
            'imbue_slots' => ['es' => 'Ranuras de imbuido', 'en' => 'Imbuement slots'],
            'value' => ['es' => 'Valor de mercado', 'en' => 'Market value'],
            'npc_value' => ['es' => 'Precio de venta a NPC', 'en' => 'NPC sell price'],
            'location' => ['es' => 'Dónde aparece', 'en' => 'Where it spawns'],
        ];

        return $labels[$key][$lang] ?? Str::headline($key);
    }

    private function section(string $title, ?string $text): string
    {
        if (! $text) {
            return '';
        }
        $paras = preg_split('/\n{2,}/', trim($text)) ?: [trim($text)];
        $html = '<h2>'.e($title).'</h2>';
        foreach ($paras as $p) {
            $p = trim($p);
            if ($p !== '') {
                $html .= '<p>'.e($p).'</p>';
            }
        }

        return $html;
    }

    private function excerpt(?string $text, int $max = 160): string
    {
        if (! $text) {
            return 'Tibia Atlas';
        }
        $clean = trim(preg_replace('/\s+/', ' ', $text));

        return Str::limit($clean, $max, '…');
    }

    /**
     * Keyword-first title/description copy, mirrored from the frontend
     * frontend/src/lib/seo.tsx (entrySeoTitle/entrySeoDescription) so humans
     * and crawlers see the same tags. Edit both together.
     */
    private function typeTitleSuffix(string $type, string $lang): string
    {
        $es = $lang === 'es';

        return match ($type) {
            'creature' => $es ? 'dónde aparece, loot y stats' : 'spawn, loot and stats',
            // (item suffix below mirrors seo.tsx TYPE_TITLE_SUFFIX — edit both)
            'npc' => $es ? 'NPC de Tibia: ubicación e historia' : 'Tibia NPC: location and story',
            'character' => $es ? 'historia y lore en Tibia' : 'story and lore in Tibia',
            'city' => $es ? 'guía de la ciudad de Tibia' : 'guide to the Tibian city',
            'location' => $es ? 'el lugar en el mundo de Tibia' : 'the place in the world of Tibia',
            'organization' => $es ? 'la organización en el lore de Tibia' : 'the organization in Tibia lore',
            'quest' => $es ? 'guía de la misión de Tibia' : 'Tibia quest guide',
            'event' => $es ? 'en la historia de Tibia' : "in Tibia's history",
            'item' => $es ? 'precio, quién lo suelta y dónde venderlo' : 'price, droppers and where to sell it',
            'concept' => $es ? 'en el lore de Tibia' : 'in Tibia lore',
            default => '',
        };
    }

    private function entryTitle(string $name, string $type, string $lang): string
    {
        $suffix = $this->typeTitleSuffix($type, $lang);

        return ($suffix ? $name.': '.$suffix : $name).' · Tibia Atlas';
    }

    private function entryDescription(string $name, string $type, string $lang, ?string $lead, ?string $location): string
    {
        $es = $lang === 'es';
        $prefix = '';
        if ($type === 'creature' && $location) {
            $prefix = $es ? "{$name} en Tibia: aparece en {$location}." : "{$name} in Tibia: spawns in {$location}.";
        }
        $body = trim($prefix.' '.trim((string) $lead));
        if ($body !== '') {
            return $this->excerpt($body);
        }

        return $es ? "{$name} en el atlas de Tibia en español." : "{$name} in the Tibia atlas.";
    }

    /** @param array<string, mixed> $data */
    private function view(array $data, int $status = 200): mixed
    {
        $data['site'] = self::SITE;

        return response(View::make('crawler', $data)->render(), $status)
            ->header('Content-Type', 'text/html; charset=utf-8')
            ->header('X-Robots-Tag', ! empty($data['noindex']) ? 'noindex, follow' : 'all');
    }
}
