<?php

namespace App\Services\Import;

use App\Models\Book;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Imports the readable in-game Tibia books from the community TibiaWiki
 * (Category:Book Texts). Each book page transcludes {{Infobox Book}} whose
 * `text` parameter holds the actual book contents; we parse that plus the
 * title/author/location and store an English {@see \App\Models\BookTranslation}.
 *
 * Idempotent by slug, so bulk runs can resume safely.
 */
class BookImporter
{
    private const API = 'https://tibia.fandom.com/api.php';

    private const UA = 'TibiaAtlas/1.0 (lore research project; contact: contact@tibiaatlas.test)';

    private const CATEGORY = 'Book Texts';

    private function http()
    {
        return Http::acceptJson()
            ->withHeaders(['User-Agent' => self::UA])
            ->timeout(20)
            ->retry(3, 400, throw: false);
    }

    /**
     * Import (or refresh) every readable book. Returns counts.
     *
     * @param  callable(string):void|null  $progress  optional per-batch reporter
     * @return array{imported: int, updated: int, skipped: int, failed: int, total: int}
     */
    public function importAll(int $limit = 0, ?callable $progress = null): array
    {
        $titles = $this->listCategory(self::CATEGORY, $limit > 0 ? $limit : 100000);
        $stats = ['imported' => 0, 'updated' => 0, 'skipped' => 0, 'failed' => 0, 'total' => count($titles)];

        // Batch-fetch wikitext 50 pages per request (MediaWiki cap).
        foreach (array_chunk($titles, 50) as $chunk) {
            $pages = $this->fetchWikitextBatch($chunk);
            foreach ($pages as $pageid => $page) {
                try {
                    $result = $this->store($page['title'], (int) $pageid, $page['wikitext']);
                    $stats[$result]++;
                } catch (\Throwable $e) {
                    $stats['failed']++;
                }
            }
            if ($progress) {
                $progress(sprintf(
                    'imported %d · updated %d · skipped %d · failed %d / %d',
                    $stats['imported'], $stats['updated'], $stats['skipped'], $stats['failed'], $stats['total']
                ));
            }
        }

        return $stats;
    }

    /**
     * Parse one book page's wikitext and upsert it.
     *
     * @return 'imported'|'updated'|'skipped'
     */
    private function store(string $pageTitle, int $pageid, string $wikitext): string
    {
        if (! preg_match('/\{\{\s*Infobox[ _]Book/i', $wikitext)) {
            return 'skipped';
        }

        $title = $this->cleanInline($this->field($wikitext, 'title'));
        $text = $this->cleanText($this->field($wikitext, 'text'));

        // Books with no real contents (just markup leftovers) aren't worth a page.
        if ($text === '') {
            return 'skipped';
        }

        // A book's display title falls back to its page name when the in-game
        // book is "Untitled" / "(Untitled)" or the field is blank.
        $displayTitle = $title;
        if ($displayTitle === '' || preg_match('/^\(?\s*untitled\s*\)?$/i', $displayTitle)) {
            $displayTitle = preg_replace('/\s*\(Book\)\s*$/i', '', $pageTitle) ?: $pageTitle;
        }

        $author = $this->cleanInline($this->field($wikitext, 'author'));
        $location = $this->cleanInline($this->field($wikitext, 'location'));
        $blurb = $this->cleanInline($this->field($wikitext, 'blurb'));
        if (in_array(strtolower($blurb), ['', '?'], true)) {
            $blurb = null;
        }
        $booktype = $this->cleanInline($this->field($wikitext, 'booktype')) ?: null;
        $group = $this->shelf($this->field($wikitext, 'returnpage'), $location);
        $url = 'https://tibia.fandom.com/wiki/'.rawurlencode(str_replace(' ', '_', $pageTitle));

        $slug = $this->uniqueSlug($pageTitle, $url);

        $book = Book::firstOrNew(['slug' => $slug]);
        $isNew = ! $book->exists;
        $book->fill([
            'booktype' => $booktype,
            'author' => $author ?: null,
            'location' => $location ?: null,
            'location_group' => $group,
            'source_url' => $url,
            'char_len' => Str::length($text),
        ])->save();

        $book->translations()->updateOrCreate(
            ['locale' => 'en'],
            ['title' => $displayTitle, 'text' => $text, 'blurb' => $blurb],
        );

        return $isNew ? 'imported' : 'updated';
    }

    /**
     * A stable, readable slug from the page name (minus the "(Book)" suffix),
     * disambiguated if a different book already claimed it.
     */
    private function uniqueSlug(string $pageTitle, string $url): string
    {
        $base = Str::slug(preg_replace('/\s*\(Book\)\s*$/i', '', $pageTitle) ?: $pageTitle);
        if ($base === '') {
            $base = 'book';
        }

        $slug = $base;
        $n = 1;
        while (true) {
            $existing = Book::where('slug', $slug)->first();
            if (! $existing || $existing->source_url === $url) {
                return $slug;
            }
            $slug = $base.'-'.(++$n);
        }
    }

    /**
     * Resolve the reading-shelf group: the wiki "returnpage" (e.g. "Thais
     * Libraries", "Secret Library"), falling back to the location, then a
     * generic bucket.
     */
    private function shelf(string $returnpage, string $location): string
    {
        $g = str_replace('{{!}}', '|', $returnpage);
        // [[Target|Label]] / Target|Label → prefer the human label.
        $g = preg_replace('/\[\[|\]\]/', '', $g) ?? $g;
        if (str_contains($g, '|')) {
            $parts = array_filter(array_map('trim', explode('|', $g)));
            $g = end($parts) ?: '';
        }
        $g = trim($this->cleanInline($g));

        if ($g === '') {
            // Use a city/place mentioned in the location as a rough shelf.
            $loc = $this->cleanInline($location);
            $g = $loc !== '' ? Str::of($loc)->before(',')->before(' church')->trim()->toString() : '';
        }

        return $g !== '' ? $g : 'Unsorted';
    }

    /**
     * Extract a (possibly multi-line) infobox field value from the wikitext.
     */
    private function field(string $wikitext, string $name): string
    {
        // Capture from "| name =" up to the next "\n| key =" or the closing "}}".
        // NB: only spaces/tabs after "=" — NOT \s* — so an EMPTY field doesn't
        // swallow the following line (e.g. a blank author eating "returnpage").
        $re = '/\n\s*\|\s*'.preg_quote($name, '/').'\s*=[ \t]*(.*?)(?=\n\s*\|\s*[A-Za-z0-9_]+\s*=|\n\s*\}\})/s';
        if (! preg_match($re, "\n".$wikitext, $m)) {
            return '';
        }

        // Drop the empty "||" separator some infoboxes leave after a value.
        return trim(preg_replace('/[\s|]+$/', '', $m[1]) ?? $m[1]);
    }

    /**
     * Clean a book's body text while PRESERVING line breaks (books have verses,
     * stanzas and paragraphs): <br> → newline, then strip the rest of the markup.
     */
    private function cleanText(string $text): string
    {
        if ($text === '') {
            return '';
        }
        // Line breaks first, before tags are stripped.
        $text = preg_replace('/<br\s*\/?>/i', "\n", $text) ?? $text;
        $text = str_replace(['{{!}}'], '|', $text);
        // {{Otext|...}} / nested simple templates: unwrap or drop.
        $text = preg_replace('/\{\{[^{}]*\}\}/', '', $text) ?? $text;
        // [[target|label]] → label ; [[target]] → target
        $text = preg_replace('/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/', '$1', $text) ?? $text;
        $text = preg_replace('/<ref[^>]*>.*?<\/ref>/is', '', $text) ?? $text;
        $text = preg_replace('/<\/?[^>]+>/', '', $text) ?? $text;
        $text = str_replace(["'''", "''"], '', $text);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5);
        // Drop empty brackets left behind by stripped templates/links, e.g.
        // "in a chest ()" → "in a chest".
        $text = preg_replace('/\s*[\(\[]\s*[\)\]]/', '', $text) ?? $text;

        // Tidy: trim each line, collapse 3+ blank lines, no leading/trailing space.
        $lines = array_map(fn ($l) => rtrim($l), explode("\n", $text));
        $text = implode("\n", $lines);
        $text = preg_replace("/\n{3,}/", "\n\n", $text) ?? $text;

        return trim($text);
    }

    /** Single-line clean (titles, authors, locations, blurbs). */
    private function cleanInline(string $text): string
    {
        $text = $this->cleanText($text);

        return trim(preg_replace('/\s+/', ' ', $text) ?? $text);
    }

    /**
     * Batch-fetch the raw wikitext of up to 50 pages.
     *
     * @param  list<string>  $titles
     * @return array<int, array{title: string, wikitext: string}>
     */
    private function fetchWikitextBatch(array $titles): array
    {
        $json = $this->http()->get(self::API, [
            'action' => 'query',
            'format' => 'json',
            'prop' => 'revisions',
            'rvprop' => 'content',
            'rvslots' => 'main',
            'redirects' => 1,
            'titles' => implode('|', $titles),
        ])->json();

        $out = [];
        foreach ((array) data_get($json, 'query.pages', []) as $pageid => $pg) {
            if (($pageid < 0) || isset($pg['missing'])) {
                continue;
            }
            $rev = $pg['revisions'][0] ?? [];
            // Wikitext lives under the literal "*" key.
            $wt = $rev['slots']['main']['*'] ?? $rev['*'] ?? '';
            $out[(int) $pageid] = [
                'title' => $pg['title'] ?? '',
                'wikitext' => is_string($wt) ? $wt : '',
            ];
        }

        return $out;
    }

    /**
     * List up to $limit main-namespace page titles in a TibiaWiki category.
     *
     * @return list<string>
     */
    public function listCategory(string $category, int $limit = 100000): array
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
}
