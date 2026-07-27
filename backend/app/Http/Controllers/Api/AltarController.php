<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AltarPuzzle;
use App\Models\Entry;
use App\Support\ContentCache;
use App\Support\GameDay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * "Altar del Bestiario" — the daily creature silhouette game. One Tibia creature
 * per day, identical for everyone, shown as a grey silhouette resting on an altar.
 * The player gets a single guess to identify it, refreshed at server save.
 *
 * The answer is NEVER sent to the client up front. `today` ships only the puzzle
 * shape (word lengths + a few light stat hints) and the full list of guessable
 * creatures for the autocomplete — but not which one it is. The silhouette itself
 * is streamed from `silhouette` through a neutral URL, because the real sprite URLs
 * embed the creature's name (…/Special:FilePath/Dragon.gif) and would give it away.
 * `guess` scores the single attempt server-side and only then reveals the creature.
 */
class AltarController extends Controller
{
    /** Puzzle shape + light hints + the dictionary of guessable creatures (no answer). */
    public function today(): JsonResponse
    {
        $date = $this->gameDate();
        $answer = $this->answer($date);

        return response()->json([
            'date' => $date,
            'next_save' => $this->nextSave()->toIso8601String(),
            'word_shape' => $this->wordShape($answer['name']),
            'hints' => $answer['meta'] ?? [],
            'pool' => $this->pool()
                ->map(fn ($c) => ['slug' => $c['slug'], 'name' => $c['name']])
                ->values(),
        ]);
    }

    /**
     * Stream today's creature sprite through a name-free URL so the silhouette
     * can't be identified from the image address. Cached for the Tibia day.
     */
    public function silhouette(): Response
    {
        $date = $this->gameDate();
        $answer = $this->answer($date);
        abort_if(empty($answer['image']), 404);

        $cached = Cache::remember(ContentCache::key('altar:silhouette:'.$date), 21600, function () use ($answer) {
            try {
                // Fandom's WAF 403s bare requests; a browser-like header set (UA,
                // Accept, Referer, Sec-Fetch) is required to reach the sprite.
                $resp = Http::withHeaders([
                    'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept' => 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Accept-Language' => 'en-US,en;q=0.9',
                    'Referer' => 'https://tibia.fandom.com/',
                    'Sec-Fetch-Dest' => 'image',
                    'Sec-Fetch-Mode' => 'no-cors',
                    'Sec-Fetch-Site' => 'same-origin',
                ])->timeout(10)->get($answer['image']);
            } catch (\Throwable) {
                return null;
            }
            if (! $resp->successful()) {
                return null;
            }

            return [
                'body' => $resp->body(),
                'type' => $resp->header('Content-Type') ?: 'image/gif',
            ];
        });

        abort_if($cached === null, 404);

        return response($cached['body'], 200, [
            'Content-Type' => $cached['type'],
            // Per-day image; safe to cache hard but must expire by the next save.
            'Cache-Control' => 'public, max-age=1800, s-maxage=3600',
        ]);
    }

    /** Score the single guess against today's answer (server-side). */
    public function guess(Request $request): JsonResponse
    {
        $data = $request->validate([
            'slug' => ['required', 'string', 'max:120'],
        ]);

        $pool = $this->pool();
        $slug = $data['slug'];

        // Reject anything that isn't a real, currently-guessable creature.
        if (! $pool->has($slug)) {
            return response()->json(['valid' => false]);
        }

        $date = $this->gameDate();
        $answer = $this->answer($date);
        $solved = $slug === $answer['slug'];

        // One attempt only: the game is always over, so reveal the creature now.
        return response()->json([
            'valid' => true,
            'date' => $date,
            'solved' => $solved,
            'answer' => [
                'name' => $answer['name'],
                'slug' => $answer['slug'],
                'image' => $answer['image'],
            ],
        ]);
    }

    // ---- Internals -----------------------------------------------------

    /**
     * Today's locked creature as a pool row {id, slug, name, image, meta}. Falls
     * back to loading the entry directly if it has since left the pool.
     *
     * @return array{id:int, slug:string, name:string, image:?string, meta:array<string,mixed>}
     */
    private function answer(string $date): array
    {
        $puzzle = $this->lock($date);
        $row = $this->pool()->firstWhere('id', $puzzle->entry_id);
        if ($row) {
            return $row;
        }

        // Unpublished mid-day: resolve straight from the entry so the day still works.
        $entry = Entry::with(['translations' => fn ($q) => $q->where('locale', 'en')])->find($puzzle->entry_id);
        abort_if($entry === null, 503, 'Today\'s creature is unavailable.');

        return [
            'id' => (int) $entry->id,
            'slug' => $entry->slug,
            'name' => $entry->translations->first()->name ?? ucfirst($entry->slug),
            'image' => $entry->primary_image,
            'meta' => $this->hints($entry->meta ?? []),
        ];
    }

    /** Get (or deterministically lock) the puzzle for a Tibia day. */
    private function lock(string $date): AltarPuzzle
    {
        $existing = AltarPuzzle::where('date', $date)->first();
        if ($existing) {
            return $existing;
        }

        $pool = $this->pool();
        $slugs = $pool->keys()->values();
        $count = $slugs->count();
        abort_if($count === 0, 503, 'No creatures available for the daily puzzle.');

        // Deterministic, same-for-everyone pick; nudge off yesterday's creature so
        // the answer never repeats two days running.
        $index = crc32($date) % $count;
        $previous = AltarPuzzle::orderByDesc('date')->value('entry_id');
        if ($count > 1 && $pool->get($slugs[$index])['id'] === $previous) {
            $index = ($index + 1) % $count;
        }

        return AltarPuzzle::create([
            'date' => $date,
            'entry_id' => $pool->get($slugs[$index])['id'],
        ]);
    }

    /**
     * Every published creature that has a sprite, keyed by slug →
     * {id, slug, name (English), image, meta}. English names keep the answer
     * locale-agnostic — Tibia creature names are proper nouns, same for everyone.
     *
     * @return Collection<string, array{id:int, slug:string, name:string, image:?string, meta:array<string,mixed>}>
     */
    private function pool(): Collection
    {
        $rows = Cache::remember(ContentCache::key('altar:pool'), 600, function () {
            return Entry::query()
                ->where('entries.type', 'creature')
                ->where('entries.status', 'published')
                ->whereNotNull('entries.primary_image')
                ->join('entry_translations as t', function ($join) {
                    $join->on('t.entry_id', '=', 'entries.id')->where('t.locale', '=', 'en');
                })
                ->orderBy('entries.id')
                ->get(['entries.id', 'entries.slug', 'entries.primary_image as image', 'entries.meta', 't.name'])
                ->keyBy('slug')
                ->map(function ($row) {
                    $meta = is_array($row->meta) ? $row->meta : (json_decode((string) $row->meta, true) ?: []);

                    return [
                        'id' => (int) $row->id,
                        'slug' => $row->slug,
                        'name' => $row->name,
                        'image' => $row->image,
                        // Keep only the hint fields — the full meta (spawns, loot,
                        // damage mods…) is huge and would bloat the cached pool.
                        'meta' => $this->hints($meta),
                    ];
                })
                ->all();
        });

        return collect($rows);
    }

    /**
     * Letter count of each space-separated word in the name, e.g. "Orc Warlord"
     * → [3, 7]. Drives the always-visible "_ _ _  _ _ _ _ _ _ _" pattern.
     *
     * @return list<int>
     */
    private function wordShape(string $name): array
    {
        return array_values(array_map(
            fn ($word) => mb_strlen($word),
            array_filter(explode(' ', trim($name)), fn ($w) => $w !== ''),
        ));
    }

    /**
     * A few light, revealable clues drawn from the creature's stats. Never
     * includes the name. Missing stats are simply omitted.
     *
     * @param  array<string,mixed>  $meta
     * @return array<string,mixed>
     */
    private function hints(array $meta): array
    {
        return array_filter([
            'class' => $meta['bestiary_class'] ?? null,
            'hitpoints' => isset($meta['hitpoints']) ? (int) $meta['hitpoints'] : null,
            'difficulty' => $meta['difficulty'] ?? null,
            'weak_to' => $meta['weak_to'] ?? null,
        ], fn ($v) => $v !== null && $v !== '');
    }

    /** The current Tibia day (Y-m-d), with the boundary at server save. */
    private function gameDate(): string
    {
        return GameDay::date();
    }

    /** The next server save instant (for the client's countdown). */
    private function nextSave(): Carbon
    {
        return GameDay::nextSave();
    }
}
