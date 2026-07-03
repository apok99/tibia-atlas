<?php

namespace App\Http\Controllers;

use App\Enums\EntryType;
use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;

/**
 * `/llms-full.txt` — a flat Markdown index of the whole archive, the format AI
 * assistants (ChatGPT, Claude, Perplexity, Gemini) prefer for ingesting a site.
 * It lists every published lore article grouped by type with a direct link, so
 * a model can crawl from here to any entry's server-rendered page.
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
                ? "> El atlas bilingüe de Tibia: mapa interactivo con los spawns de cada criatura piso por piso y rutas entre ciudades, wordle diario, bestiario, libros y el lore de Tibia. Contenido documentado y con fuentes. No afiliado a CipSoft.\n\n"
                : "> The bilingual atlas of Tibia: an interactive map with every creature's spawns floor by floor and routes between cities, a daily wordle, a bestiary, books and Tibia lore. Documented, sourced content. Not affiliated with CipSoft.\n\n");
            $out .= ($es ? 'Sitio: ' : 'Site: ').self::SITE."\n";
            $out .= 'Sitemap: '.self::SITE."/sitemap.xml\n\n";

            foreach (EntryType::cases() as $type) {
                $entries = Entry::published()->ofType($type)
                    ->with('translations')
                    ->orderByDesc('view_count')
                    ->get(['id', 'slug']);
                if ($entries->isEmpty()) {
                    continue;
                }
                $label = $type->labels()[$lang] ?? $type->labels()['en'];
                $out .= "## {$label} ({$entries->count()})\n\n";
                foreach ($entries as $e) {
                    $name = $e->translation($lang)?->name ?? $e->slug;
                    $out .= "- [{$name}](".self::SITE.'/entry/'.$e->slug.")\n";
                }
                $out .= "\n";
            }

            return $out;
        });

        return response($body, 200)
            ->header('Content-Type', 'text/plain; charset=utf-8')
            ->header('Cache-Control', 'public, max-age=1800');
    }
}
