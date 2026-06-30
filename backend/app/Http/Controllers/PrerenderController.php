<?php

namespace App\Http\Controllers;

use App\Enums\EntryType;
use App\Models\Entry;
use Illuminate\Http\Request;
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
        $description = $this->excerpt($lead);
        $canonical = self::SITE.'/entry/'.$entry->slug;
        $image = $entry->primary_image ?: self::SITE.'/logo.png';

        // Semantic body: heading, every editorial section, related links, sources.
        $body = '<article>';
        $body .= '<p><a href="'.e(self::SITE.'/browse/'.$entry->type->value).'">'.e($typeLabel).'</a></p>';
        $body .= '<h1>'.e($name).'</h1>';
        if ($entry->primary_image) {
            $body .= '<img src="'.e($entry->primary_image).'" alt="'.e($name).'" width="160" height="160">';
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
            'title' => $name.' · Tibia Atlas',
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

        $query = Entry::published()->with('translations');
        if ($typeEnum) {
            $query->ofType($typeEnum);
        }
        $entries = $query->orderByDesc('view_count')->limit(500)->get();

        $body = '<h1>'.e($heading).'</h1><ul>';
        foreach ($entries as $e) {
            $n = $e->translation($lang)?->name ?? $e->slug;
            $body .= '<li><a href="'.e(self::SITE.'/entry/'.$e->slug).'">'.e($n).'</a></li>';
        }
        $body .= '</ul>';

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
            foreach (['browse/creature', 'browse/character', 'browse/city', 'browse/organization', 'browse/quest', 'browse/event', 'browse/location', 'items', 'map', 'history', 'timeline', 'quests', 'killstats', 'soundtrack', 'wordle'] as $href) {
                $body .= '<li><a href="'.e(self::SITE.'/'.$href).'">'.e($href).'</a></li>';
            }
            $body .= '</ul></nav>';

            // Surface the most popular lore so bots reach real content one hop in.
            $top = Entry::published()->with('translations')->orderByDesc('view_count')->limit(50)->get();
            if ($top->isNotEmpty()) {
                $body .= '<h2>'.($lang === 'es' ? 'Destacados' : 'Featured').'</h2><ul>';
                foreach ($top as $e) {
                    $n = $e->translation($lang)?->name ?? $e->slug;
                    $body .= '<li><a href="'.e(self::SITE.'/entry/'.$e->slug).'">'.e($n).'</a></li>';
                }
                $body .= '</ul>';
            }
        }

        $jsonLd = $slug === ''
            ? [[
                '@context' => 'https://schema.org',
                '@type' => 'WebSite',
                'name' => 'Tibia Atlas',
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
                'title' => 'Tibia Atlas — '.($es ? 'El archivo viviente del lore de Tibia' : 'The living archive of Tibian lore'),
                'h1' => 'Tibia Atlas',
                'description' => $es
                    ? 'Atlas bilingüe del lore de Tibia: bestiario, personajes, ciudades, misiones, objetos, mapa, libros y la historia del mundo. Documentado y con fuentes citadas.'
                    : 'Bilingual archive of Tibia lore: bestiary, characters, cities, quests, items, map, books and the history of the world. Documented and fully sourced.',
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
            'timeline' => [
                'title' => ($es ? 'Cronología de Tibia' : 'Timeline of Tibia').' · Tibia Atlas',
                'h1' => $es ? 'Cronología de Tibia' : 'Timeline of Tibia',
                'description' => $es ? 'La historia completa del universo de Tibia, desde la creación hasta hoy.' : 'The complete history of the Tibia universe, from creation to today.',
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
                'description' => $es ? 'La banda sonora de Tibia para escuchar mientras exploras el archivo.' : 'The Tibia soundtrack to listen to while you explore the archive.',
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

    /** @param array<string, mixed> $data */
    private function view(array $data, int $status = 200): mixed
    {
        $data['site'] = self::SITE;

        return response(View::make('crawler', $data)->render(), $status)
            ->header('Content-Type', 'text/html; charset=utf-8')
            ->header('X-Robots-Tag', ! empty($data['noindex']) ? 'noindex, follow' : 'all');
    }
}
