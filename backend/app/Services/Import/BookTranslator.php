<?php

namespace App\Services\Import;

use App\Models\Book;
use Illuminate\Support\Facades\Http;

/**
 * Generates Spanish translations of the imported Tibia books using the free
 * Google Translate (gtx) endpoint. Translations are machine-made (not official)
 * and stored as the `es` {@see \App\Models\BookTranslation}; the English
 * original is always kept. Idempotent — skips books already translated.
 */
class BookTranslator
{
    private const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

    private const UA = 'Mozilla/5.0 (compatible; TibiaAtlas/1.0)';

    /** Keep each request's text well under the GET URL length limit. */
    private const CHUNK = 1200;

    private function http()
    {
        return Http::withHeaders(['User-Agent' => self::UA])
            ->timeout(20)
            ->retry(3, 500, throw: false);
    }

    /**
     * Translate books missing a Spanish translation.
     *
     * @param  callable(string):void|null  $progress
     * @return array{translated: int, skipped: int, failed: int, total: int}
     */
    public function translateMissing(int $limit = 0, int $sleepMs = 150, bool $refresh = false, ?callable $progress = null): array
    {
        $query = Book::with('translations');
        if (! $refresh) {
            $query->whereDoesntHave('translations', fn ($t) => $t->where('locale', 'es'));
        }
        if ($limit > 0) {
            $query->limit($limit);
        }
        $books = $query->get();

        $stats = ['translated' => 0, 'skipped' => 0, 'failed' => 0, 'total' => $books->count()];

        foreach ($books as $book) {
            $en = $book->translation('en');
            if (! $en || ! $en->text) {
                $stats['skipped']++;

                continue;
            }

            try {
                $title = $en->title ? $this->translate($en->title) : $en->title;
                $text = $this->translate($en->text);
                $blurb = $en->blurb ? $this->translate($en->blurb) : null;

                $book->translations()->updateOrCreate(
                    ['locale' => 'es'],
                    ['title' => $title, 'text' => $text, 'blurb' => $blurb],
                );
                $stats['translated']++;
            } catch (\Throwable $e) {
                $stats['failed']++;
            }

            if ($progress && ($stats['translated'] + $stats['skipped'] + $stats['failed']) % 25 === 0) {
                $progress(sprintf(
                    'translated %d · skipped %d · failed %d / %d',
                    $stats['translated'], $stats['skipped'], $stats['failed'], $stats['total']
                ));
            }

            if ($sleepMs > 0) {
                usleep($sleepMs * 1000);
            }
        }

        return $stats;
    }

    /** Translate a string to Spanish, preserving its line breaks. */
    public function translate(string $text, string $to = 'es'): string
    {
        $out = '';
        foreach ($this->chunk($text) as $chunk) {
            $out .= $this->gtx($chunk, $to);
        }

        // The segment reconstruction can double up blank lines — normalize so
        // paragraph spacing matches the original.
        $out = preg_replace("/\n{3,}/", "\n\n", $out) ?? $out;

        return rtrim($out);
    }

    /**
     * One Google-translate request. Reconstructs line breaks from the segment
     * originals (each returned segment keeps its trailing newline in [1]).
     */
    private function gtx(string $q, string $to): string
    {
        if (trim($q) === '') {
            return $q;
        }

        $resp = $this->http()->get(self::ENDPOINT, [
            'client' => 'gtx',
            'sl' => 'en',
            'tl' => $to,
            'dt' => 't',
            'q' => $q,
        ]);

        if (! $resp->ok()) {
            throw new \RuntimeException('translate failed: HTTP '.$resp->status());
        }

        $segments = $resp->json()[0] ?? [];
        if (! is_array($segments)) {
            return $q;
        }

        $out = '';
        foreach ($segments as $seg) {
            $out .= $seg[0] ?? '';
            // Preserve trailing newline(s) that the original segment carried.
            if (isset($seg[1]) && is_string($seg[1]) && preg_match('/(\n+)$/', $seg[1], $m)) {
                $out .= $m[1];
            }
        }

        return $out;
    }

    /**
     * Split text into pieces no larger than CHUNK chars, breaking on line
     * boundaries (and hard-splitting any single over-long line). The pieces
     * concatenate back to the original.
     *
     * @return list<string>
     */
    private function chunk(string $text): array
    {
        $lines = explode("\n", $text);
        $last = count($lines) - 1;

        $chunks = [];
        $cur = '';
        foreach ($lines as $i => $line) {
            $piece = $line.($i < $last ? "\n" : '');

            // A single line longer than the limit is hard-split by characters.
            if (mb_strlen($piece) > self::CHUNK) {
                if ($cur !== '') {
                    $chunks[] = $cur;
                    $cur = '';
                }
                foreach (mb_str_split($piece, self::CHUNK) as $part) {
                    $chunks[] = $part;
                }

                continue;
            }

            if ($cur !== '' && mb_strlen($cur) + mb_strlen($piece) > self::CHUNK) {
                $chunks[] = $cur;
                $cur = '';
            }
            $cur .= $piece;
        }
        if ($cur !== '') {
            $chunks[] = $cur;
        }

        return $chunks;
    }
}
