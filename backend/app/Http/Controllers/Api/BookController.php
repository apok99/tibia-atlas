<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Support\ContentCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Public, read-only access to the in-game Tibia library (readable books
 * transcribed from TibiaWiki). Text resolves to the active locale, falling
 * back to the English original when a translation isn't available yet.
 */
class BookController extends Controller
{
    /**
     * The library index: a light list of books (no full text) plus the shelf
     * groups. Supports `?q=` (matches title, author or full text) and
     * `?group=` (a single shelf / location).
     */
    public function index(Request $request): JsonResponse
    {
        $locale = app()->getLocale();
        $q = trim((string) $request->query('q', ''));
        $group = trim((string) $request->query('group', ''));

        $query = Book::query()->with('translations');

        if ($group !== '') {
            $query->where('location_group', $group);
        }

        if ($q !== '') {
            $term = '%'.addcslashes($q, '%_\\').'%';
            $query->where(function ($w) use ($term) {
                $w->where('author', 'ilike', $term)
                    ->orWhereHas('translations', fn ($t) => $t
                        ->where('title', 'ilike', $term)
                        ->orWhere('text', 'ilike', $term));
            });
        }

        $books = $query->get()
            ->map(fn (Book $b) => $this->listItem($b, $locale))
            ->sortBy(fn ($i) => mb_strtolower((string) $i['title']), SORT_NATURAL | SORT_FLAG_CASE)
            ->values();

        // Shelf groups are always computed over the WHOLE library, so the
        // sidebar is stable regardless of the current search/filter. The
        // library only changes on (rare) imports, so cache the aggregates
        // instead of re-grouping on every request.
        $shelf = Cache::remember(ContentCache::key('book-groups'), 3600, function (): array {
            return [
                'groups' => Book::query()
                    ->selectRaw('location_group, count(*) as c')
                    ->groupBy('location_group')
                    ->orderByRaw('count(*) desc')
                    ->get()
                    ->map(fn ($g) => ['name' => $g->location_group, 'count' => (int) $g->c])
                    ->all(),
                'total' => Book::count(),
            ];
        });

        return response()->json([
            'data' => $books,
            'groups' => $shelf['groups'],
            'total' => $shelf['total'],
        ]);
    }

    /** One book with its full text in the active locale. */
    public function show(Request $request, Book $book): JsonResponse
    {
        $locale = app()->getLocale();
        $t = $book->translation($locale);

        return response()->json([
            'data' => [
                'slug' => $book->slug,
                'title' => $t?->title,
                'author' => $book->author,
                'location' => $book->location,
                'group' => $book->location_group,
                'booktype' => $book->booktype,
                'source_url' => $book->source_url,
                'locale' => $t?->locale,
                'available_locales' => $book->translations->pluck('locale')->values(),
                'blurb' => $t?->blurb,
                'text' => $t?->text,
                'is_lore_important' => (bool) $book->is_lore_important,
            ],
        ]);
    }

    /** @return array<string, mixed> */
    private function listItem(Book $b, string $locale): array
    {
        $t = $b->translation($locale);

        return [
            'slug' => $b->slug,
            'title' => $t?->title,
            'author' => $b->author,
            'location' => $b->location,
            'group' => $b->location_group,
            'char_len' => $b->char_len,
            'blurb' => $t?->blurb,
            'is_lore_important' => (bool) $b->is_lore_important,
        ];
    }
}
