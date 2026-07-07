<?php

namespace App\Http\Controllers;

use App\Enums\EntryType;
use App\Models\Entry;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;

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
            $maps = ['pages', 'lore'];
            $now = now()->toAtomString();
            $xml = '<?xml version="1.0" encoding="UTF-8"?>'."\n";
            $xml .= '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'."\n";
            foreach ($maps as $m) {
                $xml .= '  <sitemap><loc>'.self::SITE."/sitemap-{$m}.xml</loc><lastmod>{$now}</lastmod></sitemap>\n";
            }
            $xml .= '</sitemapindex>';

            return $xml;
        });

        return $this->xml($body);
    }

    public function section(string $section): Response
    {
        return match ($section) {
            'pages' => $this->xml(Cache::remember('sitemap:pages', 3600, fn () => $this->pages())),
            'lore' => $this->xml(Cache::remember('sitemap:lore', 1800, fn () => $this->lore())),
            default => abort(404),
        };
    }

    private function pages(): string
    {
        $paths = ['', 'browse', 'items', 'map', 'history', 'timeline', 'quests', 'killstats', 'soundtrack', 'wordle'];
        foreach (EntryType::values() as $t) {
            $paths[] = 'browse/'.$t;
        }

        $urls = [];
        foreach ($paths as $p) {
            $loc = self::SITE.($p ? '/'.$p : '');
            $urls[] = $this->url($loc, null, $p === '' ? '1.0' : '0.7');
        }

        return $this->wrap($urls);
    }

    private function lore(): string
    {
        $urls = [];
        Entry::published()
            ->select('slug', 'updated_at')
            ->orderByDesc('view_count')
            ->chunk(2000, function ($chunk) use (&$urls) {
                foreach ($chunk as $e) {
                    $urls[] = $this->url(
                        self::SITE.'/entry/'.$e->slug,
                        $e->updated_at?->toAtomString(),
                        '0.8',
                    );
                }
            });

        return $this->wrap($urls);
    }

    /** A <url> node with es/en hreflang alternates. */
    private function url(string $loc, ?string $lastmod, string $priority): string
    {
        $loc = htmlspecialchars($loc, ENT_XML1);
        $node = "  <url>\n    <loc>{$loc}</loc>\n";
        if ($lastmod) {
            $node .= "    <lastmod>{$lastmod}</lastmod>\n";
        }
        $node .= "    <xhtml:link rel=\"alternate\" hreflang=\"es\" href=\"{$loc}?lang=es\"/>\n";
        $node .= "    <xhtml:link rel=\"alternate\" hreflang=\"en\" href=\"{$loc}?lang=en\"/>\n";
        $node .= "    <xhtml:link rel=\"alternate\" hreflang=\"x-default\" href=\"{$loc}\"/>\n";
        $node .= "    <priority>{$priority}</priority>\n  </url>";

        return $node;
    }

    /** @param list<string> $urls */
    private function wrap(array $urls): string
    {
        return '<?xml version="1.0" encoding="UTF-8"?>'."\n"
            .'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'."\n"
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
