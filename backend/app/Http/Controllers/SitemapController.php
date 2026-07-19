<?php

namespace App\Http\Controllers;

use App\Enums\EntryType;
use App\Models\Entry;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * XML sitemaps, generated from the database and cached. A sitemap index points
 * at one map of hub/feature pages and one of every published lore article, each
 * URL carrying es/en hreflang alternates so both languages get indexed.
 */
class SitemapController extends Controller
{
    private const SITE = 'https://tibiaatlas.com';

    public function index(): Response
    {
        $body = Cache::remember('sitemap:index', 3600, function () {
            $maps = ['pages', 'lore', 'items'];
            // Real lastmod (latest content change), not the cache-build time.
            $last = Entry::query()->max('updated_at');
            $last = $last ? \Illuminate\Support\Carbon::parse($last)->toAtomString() : now()->toAtomString();
            $xml = '<?xml version="1.0" encoding="UTF-8"?>'."\n";
            $xml .= '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'."\n";
            foreach ($maps as $m) {
                $xml .= '  <sitemap><loc>'.self::SITE."/sitemap-{$m}.xml</loc><lastmod>{$last}</lastmod></sitemap>\n";
            }
            $xml .= '</sitemapindex>';

            return $xml;
        });

        return $this->xml($body);
    }

    /** Atom feed of the latest published articles — a cheap freshness signal. */
    public function feed(): Response
    {
        $body = Cache::remember('feed:atom', 1800, function () {
            $entries = Entry::published()->with('translations')
                ->orderByDesc('updated_at')->limit(50)->get();
            $updated = $entries->first()?->updated_at?->toAtomString() ?? now()->toAtomString();

            $xml = '<?xml version="1.0" encoding="UTF-8"?>'."\n";
            $xml .= '<feed xmlns="http://www.w3.org/2005/Atom">'."\n";
            $xml .= '  <title>Tibia Atlas</title>'."\n";
            $xml .= '  <subtitle>La guía de Tibia en español — mapa, bestiario, items y lore</subtitle>'."\n";
            $xml .= '  <link href="'.self::SITE.'/feed.xml" rel="self"/><link href="'.self::SITE.'"/>'."\n";
            $xml .= '  <id>'.self::SITE.'/</id>'."\n";
            $xml .= '  <updated>'.$updated.'</updated>'."\n";
            foreach ($entries as $e) {
                $tr = $e->translation('es');
                $name = htmlspecialchars($tr?->name ?? $e->slug, ENT_XML1);
                $url = self::SITE.'/entry/'.$e->slug;
                $summary = htmlspecialchars(Str::limit(trim((string) preg_replace('/\s+/', ' ', (string) ($tr?->overview ?? ''))), 300), ENT_XML1);
                $xml .= '  <entry><title>'.$name.'</title><link href="'.$url.'"/><id>'.$url.'</id>';
                $xml .= '<updated>'.($e->updated_at?->toAtomString() ?? $updated).'</updated>';
                if ($summary !== '') {
                    $xml .= '<summary>'.$summary.'</summary>';
                }
                $xml .= '</entry>'."\n";
            }
            $xml .= '</feed>';

            return $xml;
        });

        return response($body, 200)
            ->header('Content-Type', 'application/atom+xml; charset=utf-8')
            ->header('Cache-Control', 'public, max-age=1800');
    }

    public function section(string $section): Response
    {
        return match ($section) {
            'pages' => $this->xml(Cache::remember('sitemap:pages', 3600, fn () => $this->pages())),
            'lore' => $this->xml(Cache::remember('sitemap:lore', 1800, fn () => $this->lore())),
            'items' => $this->xml(Cache::remember('sitemap:items', 3600, fn () => $this->items())),
            default => abort(404),
        };
    }

    private function pages(): string
    {
        // Only URLs that really render in the SPA: the map lives at "/" (/map
        // 301s home), the old /history and /quests routes are retired, and
        // browse/npc|city|character|item redirect — none of those belong here.
        $paths = ['', 'browse', 'items', 'killstats', 'soundtrack', 'wordle', 'geo', 'altar', 'rashid', 'about'];
        $retired = ['npc', 'city', 'character', 'item'];
        foreach (EntryType::values() as $t) {
            if (! in_array($t, $retired, true)) {
                $paths[] = 'browse/'.$t;
            }
        }

        // Hub pages surface DB content, so their honest lastmod is the latest
        // content change (Google ignores maps whose lastmod looks fabricated).
        $last = Entry::published()->max('updated_at');
        $last = $last ? \Illuminate\Support\Carbon::parse($last)->toAtomString() : null;

        $urls = [];
        foreach ($paths as $p) {
            $loc = self::SITE.($p ? '/'.$p : '');
            $urls[] = $this->url($loc, $last, $p === '' ? '1.0' : '0.7');
        }

        return $this->wrap($urls);
    }

    private function lore(): string
    {
        $urls = [];
        Entry::published()
            ->select('slug', 'updated_at', 'primary_image')
            ->orderByDesc('view_count')
            ->chunk(2000, function ($chunk) use (&$urls) {
                foreach ($chunk as $e) {
                    $urls[] = $this->url(
                        self::SITE.'/entry/'.$e->slug,
                        $e->updated_at?->toAtomString(),
                        '0.8',
                        $e->primary_image,
                    );
                }
            });

        return $this->wrap($urls);
    }

    /**
     * Item detail pages. Items are a large draft catalogue, so only those with
     * real, searchable content are listed — equippable gear, items a creature
     * drops, or items an NPC trades — not bare decoration with no data.
     */
    private function items(): string
    {
        $urls = [];
        Entry::ofType(EntryType::Item)
            ->select('slug', 'updated_at', 'primary_image')
            ->whereRaw(
                "(jsonb_exists(meta, 'equip_slot')"
                ." or jsonb_array_length(coalesce(meta->'dropped_by', '[]'::jsonb)) > 0"
                ." or jsonb_array_length(coalesce(meta->'npc_buy', '[]'::jsonb)) > 0"
                ." or jsonb_array_length(coalesce(meta->'npc_sell', '[]'::jsonb)) > 0)"
            )
            ->orderBy('id')
            ->chunk(2000, function ($chunk) use (&$urls) {
                foreach ($chunk as $e) {
                    $urls[] = $this->url(
                        self::SITE.'/items/'.$e->slug,
                        $e->updated_at?->toAtomString(),
                        '0.6',
                        $e->primary_image,
                    );
                }
            });

        return $this->wrap($urls);
    }

    /** A <url> node with es/en hreflang alternates and an optional image. */
    private function url(string $loc, ?string $lastmod, string $priority, ?string $image = null): string
    {
        $loc = htmlspecialchars($loc, ENT_XML1);
        $node = "  <url>\n    <loc>{$loc}</loc>\n";
        if ($lastmod) {
            $node .= "    <lastmod>{$lastmod}</lastmod>\n";
        }
        if ($image && str_starts_with($image, 'http')) {
            $node .= '    <image:image><image:loc>'.htmlspecialchars($image, ENT_XML1)."</image:loc></image:image>\n";
        }
        // Clean URL = Spanish (self-canonical); ?lang=en = English variant.
        // Matches the canonical/hreflang scheme in seo.tsx / crawler.blade.php.
        $node .= "    <xhtml:link rel=\"alternate\" hreflang=\"es\" href=\"{$loc}\"/>\n";
        $node .= "    <xhtml:link rel=\"alternate\" hreflang=\"en\" href=\"{$loc}?lang=en\"/>\n";
        $node .= "    <xhtml:link rel=\"alternate\" hreflang=\"x-default\" href=\"{$loc}\"/>\n";
        $node .= "    <priority>{$priority}</priority>\n  </url>";

        return $node;
    }

    /** @param list<string> $urls */
    private function wrap(array $urls): string
    {
        return '<?xml version="1.0" encoding="UTF-8"?>'."\n"
            .'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">'."\n"
            .implode("\n", $urls)."\n"
            .'</urlset>';
    }

    private function xml(string $body): Response
    {
        return response($body, 200)
            ->header('Content-Type', 'application/xml; charset=utf-8')
            ->header('Cache-Control', 'public, max-age=3600');
    }
}
