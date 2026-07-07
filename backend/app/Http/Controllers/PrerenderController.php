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

        return $this->staticPage($segments[0] ?? '', $lang);
    }

    // ── Lore article ────────────────────────────────────────────────────────

    private function entry(string $slug, string $lang): mixed
    {
        $entry = Entry::published()
            ->with(['translations', 'sources', 'relatedEntries.translations'])
            ->where('slug', $slug)
            ->first();

        if (! $entry) {
            return $this->staticPage('', $lang, status: 404);
        }

        $tr = $entry->translation($lang);
        $name = $tr?->name ?? $entry->slug;
        $typeLabel = $entry->type->labels()[$lang] ?? $entry->type->labels()['en'];

        $lead = $tr?->overview ?: $tr?->canon ?: '';
        $location = is_string(data_get($entry->meta, 'location')) ? data_get($entry->meta, 'location') : null;
        $description = $this->entryDescription($name, $entry->type->value, $lang, $lead, $location);
        $canonical = self::SITE.'/entry/'.$entry->slug;
        $image = $entry->primary_image ?: self::SITE.'/logo.png';

        // Semantic body: heading, every editorial section, related links, sources.
        $body = '<article>';
        $body .= '<p><a href="'.e(self::SITE.'/browse/'.$entry->type->value).'">'.e($typeLabel).'</a></p>';
        $body .= '<h1>'.e($name).'</h1>';
        if ($entry->primary_image) {
            $body .= '<img src="'.e($entry->primary_image).'" alt="'.e($name).'" width="160" height="160">';
        }
        // "Where it spawns" — the site's differentiator, and the phrasing that
        // matches "dónde aparece X" searches. Prominent, above the lore.
        if ($entry->type === EntryType::Creature && $location) {
            $body .= '<h2>'.($lang === 'es' ? 'Dónde aparece' : 'Where it spawns').'</h2>';
            $body .= '<p>'.e(($lang === 'es' ? $name.' aparece en: ' : $name.' spawns in: ').$location).'</p>';
        }
        $body .= $this->section($lang === 'es' ? 'Resumen' : 'Overview', $tr?->overview);
        $body .= $this->section($lang === 'es' ? 'Canon' : 'Canon', $tr?->canon);
        $body .= $this->section($lang === 'es' ? 'Interpretaciones' : 'Interpretations', $tr?->interpretations);
        $body .= $this->section($lang === 'es' ? 'Teorías' : 'Theories', $tr?->theories);

        // Stat block (creature/item attributes) as a definition list.
        $meta = collect($entry->meta ?? [])
            ->reject(fn ($v, $k) => is_array($v) || is_null($v) || $v === '' || in_array($k, ['spawns', 'spawn_count', 'imported_from', 'wiki_pageid', 'auto_stub', 'artwork', 'note']))
            ->take(30);
        if ($meta->isNotEmpty()) {
            $body .= '<h2>'.($lang === 'es' ? 'Datos' : 'Stats').'</h2><dl>';
            foreach ($meta as $k => $v) {
                $body .= '<dt>'.e(Str::headline((string) $k)).'</dt><dd>'.e((string) $v).'</dd>';
            }
            $body .= '</dl>';
        }

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
            return $this->staticPage('items', $lang, status: 404);
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

        $body = '<article>';
        $body .= '<p><a href="'.e(self::SITE.'/items').'">'.($es ? 'Objeto' : 'Item').'</a></p>';
        $body .= '<h1>'.e($name).'</h1>';
        if ($item->primary_image) {
            $body .= '<img src="'.e($item->primary_image).'" alt="'.e($name).'" width="64" height="64">';
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
            $body .= '<h2>'.($es ? 'Estadísticas' : 'Stats').'</h2><dl>';
            foreach ($stats as $k => $v) {
                $body .= '<dt>'.e(Str::headline((string) $k)).'</dt><dd>'.e($v).'</dd>';
            }
            $body .= '</dl>';
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

        $jsonLd = [
            [
                '@context' => 'https://schema.org',
                '@type' => 'Product',
                'name' => $name,
                'description' => $description,
                'image' => $image,
                'category' => $category,
                'url' => $canonical,
                'brand' => ['@type' => 'Brand', 'name' => 'Tibia'],
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
        $heading = $typeEnum
            ? ($typeEnum->labels()[$lang] ?? $typeEnum->labels()['en'])
            : ($lang === 'es' ? 'Explorar' : 'Browse');
        $canonical = self::SITE.'/browse'.($type ? '/'.$type : '');

        // Bots hammer hub pages; cache the rendered link list (cheap to store,
        // saves a 500-row query + HTML build per hit). Versioned key, so any
        // content edit invalidates it immediately.
        $list = Cache::remember(
            ContentCache::key('prerender:browse:'.($type ?? 'all').':'.$lang),
            1800,
            function () use ($typeEnum, $lang): string {
                $query = Entry::published()->with('translations');
                if ($typeEnum) {
                    $query->ofType($typeEnum);
                }
                $entries = $query->orderByDesc('view_count')->limit(500)->get();

                $list = '<ul>';
                foreach ($entries as $e) {
                    $n = $e->translation($lang)?->name ?? $e->slug;
                    $list .= '<li><a href="'.e(self::SITE.'/entry/'.$e->slug).'">'.e($n).'</a></li>';
                }

                return $list.'</ul>';
            }
        );

        $body = '<h1>'.e($heading).'</h1>'.$list;

        return $this->view([
            'lang' => $lang,
            'title' => $heading.' · Tibia Atlas',
            'ogTitle' => $heading,
            'description' => $lang === 'es'
                ? $heading.' del lore de Tibia, documentados y con fuentes en Tibia Atlas.'
                : $heading.' from Tibia lore, documented and sourced on Tibia Atlas.',
            'canonical' => $canonical,
            'image' => self::SITE.'/logo.png',
            'jsonLd' => [[
                '@context' => 'https://schema.org',
                '@type' => 'CollectionPage',
                'name' => $heading,
                'url' => $canonical,
                'isPartOf' => ['@type' => 'WebSite', 'name' => 'Tibia Atlas', 'url' => self::SITE],
            ]],
            'body' => $body,
        ]);
    }

    // ── Static / hub pages (home + feature pages) ────────────────────────────

    private function staticPage(string $slug, string $lang, int $status = 200): mixed
    {
        $pages = $this->staticMeta($lang);
        $meta = $pages[$slug] ?? $pages[''];
        $canonical = self::SITE.($slug ? '/'.$slug : '');

        $body = '<h1>'.e($meta['h1']).'</h1><p>'.e($meta['description']).'</p>';

        // The home page doubles as the site map for crawlers: link every hub.
        if ($slug === '') {
            $body .= '<nav><ul>';
            foreach (['browse/creature', 'browse/character', 'browse/city', 'browse/organization', 'browse/quest', 'browse/event', 'browse/location', 'items', 'map', 'history', 'quests', 'killstats', 'soundtrack', 'wordle'] as $href) {
                $body .= '<li><a href="'.e(self::SITE.'/'.$href).'">'.e($href).'</a></li>';
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

        $jsonLd = $slug === ''
            ? [[
                '@context' => 'https://schema.org',
                '@type' => 'WebSite',
                'name' => 'Tibia Atlas',
                'alternateName' => ['Atlas de Tibia', 'Wiki de Tibia en español', 'Guía de Tibia en español', 'Mapa de Tibia'],
                'description' => 'La guía de Tibia en español: mapa interactivo, bestiario, loot, items y lore.',
                'url' => self::SITE,
                'inLanguage' => ['es', 'en'],
                'potentialAction' => [
                    '@type' => 'SearchAction',
                    'target' => ['@type' => 'EntryPoint', 'urlTemplate' => self::SITE.'/browse?q={search_term_string}'],
                    'query-input' => 'required name=search_term_string',
                ],
            ]]
            : [];

        return $this->view([
            'lang' => $lang,
            'title' => $meta['title'],
            'ogTitle' => $meta['h1'],
            'description' => $meta['description'],
            'canonical' => $canonical,
            'image' => self::SITE.'/logo.png',
            'jsonLd' => $jsonLd,
            'noindex' => $status === 404,
            'body' => $body,
        ], $status);
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
                    ? 'La guía de Tibia en español: mapa interactivo con dónde aparece cada criatura piso por piso, rutas entre ciudades, bestiario, loot, precios de items y el lore de Tibia. Con wordle diario.'
                    : 'The interactive map of Tibia: find where every creature spawns floor by floor, chart routes between cities and explore the world. Plus a daily wordle, a bestiary and Tibia lore in Spanish and English.',
            ],
            'items' => [
                'title' => ($es ? 'El Álbum de Items' : 'The Item Album').' · Tibia Atlas',
                'h1' => $es ? 'El Álbum de Items' : 'The Item Album',
                'description' => $es ? 'Catálogo completo de objetos de Tibia con estadísticas y un configurador de equipo.' : 'The full Tibia item catalogue with stats and a loadout configurator.',
            ],
            'map' => [
                'title' => ($es ? 'El Mapa de Tibia' : 'The Map of Tibia').' · Tibia Atlas',
                'h1' => $es ? 'El Mapa de Tibia' : 'The Map of Tibia',
                'description' => $es ? 'Mapa interactivo de Tibia con puntos de aparición de criaturas por planta.' : 'Interactive map of Tibia with creature spawn points per floor.',
            ],
            'history' => [
                'title' => ($es ? 'La Biblioteca de Tibia' : 'The Library of Tibia').' · Tibia Atlas',
                'h1' => $es ? 'La Biblioteca de Tibia' : 'The Library of Tibia',
                'description' => $es ? 'Todos los libros leíbles del juego, transcritos y organizados por estantería.' : 'Every readable in-game book, transcribed and organised by shelf.',
            ],
            'quests' => [
                'title' => ($es ? 'Misiones por nivel recomendado' : 'Quests by recommended level').' · Tibia Atlas',
                'h1' => $es ? 'Misiones de Tibia' : 'Tibia Quests',
                'description' => $es ? 'Guía de misiones de Tibia agrupadas por nivel recomendado.' : 'A guide to Tibia quests grouped by recommended level.',
            ],
            'killstats' => [
                'title' => ($es ? 'Estadísticas de muertes de Tibia' : 'Tibia Kill Statistics').' · Tibia Atlas',
                'h1' => $es ? 'Estadísticas de muertes de Tibia' : 'Tibia Kill Statistics',
                'description' => $es ? 'Estadísticas de criaturas y bosses muertos por mundo, en directo.' : 'Live statistics of creatures and bosses killed across worlds.',
            ],
            'soundtrack' => [
                'title' => ($es ? 'La música de Tibia' : 'The Music of Tibia').' · Tibia Atlas',
                'h1' => $es ? 'La música de Tibia' : 'The Music of Tibia',
                'description' => $es ? 'La banda sonora de Tibia para escuchar mientras exploras el mapa.' : 'The Tibia soundtrack to listen to while you explore the map.',
            ],
            'wordle' => [
                'title' => 'Bestiordle · Tibia Atlas',
                'h1' => 'Bestiordle',
                'description' => $es ? 'Adivina la criatura de Tibia del día. Un juego diario.' : 'Guess the Tibia creature of the day. A daily game.',
            ],
        ];
    }

    // ── helpers ─────────────────────────────────────────────────────────────

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
            'npc' => $es ? 'NPC de Tibia: ubicación e historia' : 'Tibia NPC: location and story',
            'character' => $es ? 'historia y lore en Tibia' : 'story and lore in Tibia',
            'city' => $es ? 'guía de la ciudad de Tibia' : 'guide to the Tibian city',
            'location' => $es ? 'el lugar en el mundo de Tibia' : 'the place in the world of Tibia',
            'organization' => $es ? 'la organización en el lore de Tibia' : 'the organization in Tibia lore',
            'quest' => $es ? 'guía de la misión de Tibia' : 'Tibia quest guide',
            'event' => $es ? 'en la historia de Tibia' : "in Tibia's history",
            'item' => $es ? 'stats, precio y quién lo suelta' : 'stats, price and droppers',
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
