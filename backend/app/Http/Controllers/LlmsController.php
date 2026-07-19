<?php

namespace App\Http\Controllers;

use App\Enums\EntryType;
use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Markdown surfaces for AI assistants (ChatGPT, Claude, Perplexity, Gemini):
 * `/llms-full.txt` is a fact-annotated index of the whole archive, and
 * `/entry/{slug}.md` serves any single article as clean Markdown so a model
 * can ingest it without parsing HTML.
 */
class LlmsController extends Controller
{
    private const SITE = 'https://tibiaatlas.com';

    public function full(Request $request): Response
    {
        $lang = $request->query('lang') === 'en' ? 'en' : 'es';

        $body = Cache::remember("llms:full:{$lang}", 1800, function () use ($lang) {
            $es = $lang === 'es';
            $out = "# Tibia Atlas\n\n";
            $out .= ($es
                ? "> La guía de Tibia en español: mapa interactivo con los spawns de cada criatura piso por piso, rutas entre ciudades, casas, buscador de zonas de caza, bestiario, más de 4.000 items con precios, boss tracker y el lore de Tibia. Contenido documentado y con fuentes. No afiliado a CipSoft.\n\n"
                : "> The bilingual atlas of Tibia: an interactive map with every creature's spawns floor by floor, routes between cities, houses, a hunt finder, a bestiary, 4,000+ items with prices, a boss tracker and Tibia lore. Documented, sourced content. Not affiliated with CipSoft.\n\n");
            $out .= ($es ? 'Sitio: ' : 'Site: ').self::SITE."\n";
            $out .= 'Sitemap: '.self::SITE."/sitemap.xml\n";
            $out .= ($es ? 'Cada artículo en Markdown: ' : 'Any article as Markdown: ').self::SITE.'/entry/{slug}.md'."\n";
            $out .= ($es ? 'Generado: ' : 'Generated: ').now()->toDateString()."\n\n";

            foreach (EntryType::cases() as $type) {
                if ($type === EntryType::Item) {
                    continue; // items get their own richer section below
                }
                $entries = Entry::published()->ofType($type)
                    ->with('translations')
                    ->orderByDesc('view_count')
                    ->get(['id', 'slug', 'meta']);
                if ($entries->isEmpty()) {
                    continue;
                }
                $label = $type->labels()[$lang] ?? $type->labels()['en'];
                $out .= "## {$label} ({$entries->count()})\n\n";
                foreach ($entries as $e) {
                    $name = $e->translation($lang)?->name ?? $e->slug;
                    $out .= "- [{$name}](".self::SITE.'/entry/'.$e->slug.')';
                    // Key facts inline so an AI can answer without crawling.
                    if ($type === EntryType::Creature) {
                        $facts = [];
                        $hp = data_get($e->meta, 'hitpoints');
                        $exp = data_get($e->meta, 'experience');
                        $loc = data_get($e->meta, 'location');
                        if (is_numeric($hp)) {
                            $facts[] = $hp.' HP';
                        }
                        if (is_numeric($exp)) {
                            $facts[] = $exp.' XP';
                        }
                        if (is_string($loc) && $loc !== '') {
                            $facts[] = ($es ? 'aparece en ' : 'spawns in ').Str::limit($loc, 90);
                        }
                        if ($facts) {
                            $out .= ' — '.implode('; ', $facts);
                        }
                    }
                    $out .= "\n";
                }
                $out .= "\n";
            }

            // Items with real, searchable content (same filter as the sitemap).
            $items = Entry::ofType(EntryType::Item)
                ->with('translations')
                ->whereRaw(
                    "(jsonb_exists(meta, 'equip_slot')"
                    ." or jsonb_array_length(coalesce(meta->'dropped_by', '[]'::jsonb)) > 0"
                    ." or jsonb_array_length(coalesce(meta->'npc_buy', '[]'::jsonb)) > 0"
                    ." or jsonb_array_length(coalesce(meta->'npc_sell', '[]'::jsonb)) > 0)"
                )
                ->orderBy('slug')
                ->get(['id', 'slug', 'meta']);
            if ($items->isNotEmpty()) {
                $out .= '## '.($es ? 'Items' : 'Items')." ({$items->count()})\n\n";
                foreach ($items as $it) {
                    $name = $it->translation($lang)?->name ?? $it->slug;
                    $out .= "- [{$name}](".self::SITE.'/items/'.$it->slug.')';
                    $facts = [];
                    $cat = data_get($it->meta, 'item_category');
                    $value = data_get($it->meta, 'value');
                    if (is_string($cat) && $cat !== '') {
                        $facts[] = $cat;
                    }
                    if (is_string($value) && preg_match('/\d/', $value)) {
                        $facts[] = ($es ? 'valor ' : 'value ').$value.' gp';
                    }
                    if ($facts) {
                        $out .= ' — '.implode('; ', $facts);
                    }
                    $out .= "\n";
                }
                $out .= "\n";
            }

            return $out;
        });

        return response($body, 200)
            ->header('Content-Type', 'text/plain; charset=utf-8')
            ->header('Cache-Control', 'public, max-age=1800');
    }

    /** One article as clean Markdown — `/entry/{slug}.md`. */
    public function entry(Request $request, string $slug): Response
    {
        $lang = $request->query('lang') === 'en' ? 'en' : 'es';

        $body = Cache::remember("llms:entry:{$slug}:{$lang}", 1800, function () use ($slug, $lang): ?string {
            $entry = Entry::published()
                ->with(['translations', 'sources', 'relatedEntries.translations'])
                ->where('slug', $slug)
                ->first();
            if (! $entry) {
                return null;
            }

            $es = $lang === 'es';
            $tr = $entry->translation($lang);
            $name = $tr?->name ?? $entry->slug;
            $typeLabel = $entry->type->labels()[$lang] ?? $entry->type->labels()['en'];

            $out = "# {$name}\n\n";
            $out .= ($es ? 'Tipo: ' : 'Type: ').$typeLabel."\n";
            $out .= 'URL: '.self::SITE.'/entry/'.$entry->slug."\n";
            if ($entry->updated_at) {
                $out .= ($es ? 'Actualizado: ' : 'Updated: ').$entry->updated_at->toDateString()."\n";
            }
            $out .= "\n";

            foreach ([
                $es ? 'Resumen' : 'Overview' => $tr?->overview,
                'Canon' => $tr?->canon,
                $es ? 'Interpretaciones' : 'Interpretations' => $tr?->interpretations,
                $es ? 'Teorías' : 'Theories' => $tr?->theories,
            ] as $heading => $text) {
                if ($text) {
                    $out .= "## {$heading}\n\n".trim($text)."\n\n";
                }
            }

            $meta = collect($entry->meta ?? [])
                ->reject(fn ($v, $k) => is_array($v) || is_null($v) || $v === '' || in_array($k, ['spawns', 'imported_from', 'wiki_pageid', 'auto_stub', 'artwork', 'origin_image', 'note']));
            if ($meta->isNotEmpty()) {
                $out .= '## '.($es ? 'Datos' : 'Stats')."\n\n";
                foreach ($meta as $k => $v) {
                    $out .= '- '.Str::headline((string) $k).': '.$v."\n";
                }
                $out .= "\n";
            }

            if ($entry->relatedEntries->isNotEmpty()) {
                $out .= '## '.($es ? 'Relacionados' : 'Related')."\n\n";
                foreach ($entry->relatedEntries as $rel) {
                    $relName = $rel->translation($lang)?->name ?? $rel->slug;
                    $out .= "- [{$relName}](".self::SITE.'/entry/'.$rel->slug.")\n";
                }
                $out .= "\n";
            }

            if ($entry->sources->isNotEmpty()) {
                $out .= '## '.($es ? 'Fuentes' : 'Sources')."\n\n";
                foreach ($entry->sources as $src) {
                    $label = $src->title ?: ($src->url ?? 'Source');
                    $out .= $src->url ? "- [{$label}]({$src->url})\n" : "- {$label}\n";
                }
                $out .= "\n";
            }

            return $out;
        });

        if ($body === null) {
            return response(($lang === 'es' ? 'No existe: ' : 'Not found: ').$slug, 404)
                ->header('Content-Type', 'text/plain; charset=utf-8');
        }

        return response($body, 200)
            ->header('Content-Type', 'text/markdown; charset=utf-8')
            ->header('Cache-Control', 'public, max-age=1800');
    }
}
