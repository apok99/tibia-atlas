<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Entry;
use App\Models\WordlePuzzle;
use App\Support\ContentCache;
use App\Support\GameDay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

/**
 * "Bestiordle" — the daily creature word game. One 6-letter Tibia creature
 * (English name) per day, identical for everyone, refreshed at server save.
 *
 * The answer is NEVER sent to the client up front: `today` ships only the puzzle
 * shape and the list of valid guesses (every 6-letter creature name), and `guess`
 * scores each attempt server-side, revealing the creature only once the game is
 * over (solved or out of attempts). The list of valid words is the answer pool
 * too, exactly like a real word game — you still have to find which one it is.
 */
class WordleController extends Controller
{
    /** Word length rotates through these, one per day. */
    private const LENGTHS = [4, 5, 6, 7];

    private const MAX_ATTEMPTS = 6;

    /** Puzzle shape + dictionary of valid guesses (no answer). */
    public function today(): JsonResponse
    {
        $date = $this->gameDate();
        $length = $this->lengthFor($date);
        $this->answerFor($date); // lock today's pick

        return response()->json([
            'date' => $date,
            'length' => $length,
            'difficulty' => $this->difficulty($length),
            'max_attempts' => self::MAX_ATTEMPTS,
            'next_save' => $this->nextSave()->toIso8601String(),
            'words' => $this->pool($length)->keys()->values(),
        ]);
    }

    /** Score a single guess against today's answer (server-side). */
    public function guess(Request $request): JsonResponse
    {
        $data = $request->validate([
            'guess' => ['required', 'string', 'min:4', 'max:7'],
            'attempt' => ['nullable', 'integer', 'min:1', 'max:'.self::MAX_ATTEMPTS],
        ]);

        $date = $this->gameDate();
        $length = $this->lengthFor($date);
        $guess = strtolower($data['guess']);
        $pool = $this->pool($length);

        // Reject anything that isn't a real creature of today's length — no row burnt.
        if (! preg_match('/^[a-z]{'.$length.'}$/', $guess) || ! $pool->has($guess)) {
            return response()->json(['valid' => false]);
        }

        $puzzle = $this->answerFor($date);
        $answer = $puzzle->word;

        $result = $this->score($guess, $answer);
        $solved = $guess === $answer;
        $attempt = (int) ($data['attempt'] ?? 1);
        $finished = $solved || $attempt >= self::MAX_ATTEMPTS;

        $payload = [
            'valid' => true,
            'date' => $date,
            'result' => $result,
            'solved' => $solved,
        ];

        // Reveal the creature only when the game is actually over.
        if ($finished) {
            $entry = $pool->get($answer);
            $payload += [
                'answer' => $answer,
                'name' => $entry['name'] ?? ucfirst($answer),
                'slug' => $entry['slug'] ?? null,
                'image' => $entry['image'] ?? null,
            ];
        }

        return response()->json($payload);
    }

    // ---- Internals -----------------------------------------------------

    /**
     * Per-position feedback, with correct two-pass handling of repeated letters:
     * exact hits are claimed first, then "present" only consumes remaining copies.
     *
     * @return list<'correct'|'present'|'absent'>
     */
    private function score(string $guess, string $answer): array
    {
        $len = strlen($answer);
        $result = array_fill(0, $len, 'absent');
        $remaining = array_count_values(str_split($answer));

        for ($i = 0; $i < $len; $i++) {
            if ($guess[$i] === $answer[$i]) {
                $result[$i] = 'correct';
                $remaining[$guess[$i]]--;
            }
        }
        for ($i = 0; $i < $len; $i++) {
            if ($result[$i] === 'correct') {
                continue;
            }
            $c = $guess[$i];
            if (($remaining[$c] ?? 0) > 0) {
                $result[$i] = 'present';
                $remaining[$c]--;
            }
        }

        return $result;
    }

    /** Get (or deterministically lock) the puzzle for a Tibia day. */
    private function answerFor(string $date): WordlePuzzle
    {
        $existing = WordlePuzzle::where('date', $date)->first();
        if ($existing) {
            return $existing;
        }

        $pool = $this->pool($this->lengthFor($date));
        $words = $pool->keys()->values();
        $count = $words->count();
        abort_if($count === 0, 503, 'No creatures available for the daily puzzle.');

        // Deterministic, same-for-everyone pick; nudge off yesterday's word so the
        // answer never repeats two days running.
        $index = crc32($date) % $count;
        $previous = WordlePuzzle::orderByDesc('date')->value('word');
        if ($count > 1 && $words[$index] === $previous) {
            $index = ($index + 1) % $count;
        }

        $word = $words[$index];

        return WordlePuzzle::create([
            'date' => $date,
            'entry_id' => $pool->get($word)['id'],
            'word' => $word,
        ]);
    }

    /**
     * Every published creature whose English name is exactly $length A-Z letters,
     * keyed by the lowercased word → {id, slug, name, image}.
     *
     * @return Collection<string, array{id:int, slug:string, name:string, image:?string}>
     */
    private function pool(int $length): Collection
    {
        // Cache a plain array (not a Collection object) so it survives any cache
        // driver's (un)serialization cleanly, then rehydrate.
        $rows = Cache::remember(ContentCache::key('wordle:pool:'.$length), 600, function () use ($length) {
            return Entry::query()
                ->where('entries.type', 'creature')
                ->where('entries.status', 'published')
                ->join('entry_translations as t', function ($join) {
                    $join->on('t.entry_id', '=', 'entries.id')->where('t.locale', '=', 'en');
                })
                ->whereRaw("t.name ~ '^[A-Za-z]{".$length."}$'")
                ->orderBy('entries.id')
                ->get(['entries.id', 'entries.slug', 'entries.primary_image as image', 't.name'])
                ->keyBy(fn ($row) => strtolower($row->name))
                ->map(fn ($row) => [
                    'id' => (int) $row->id,
                    'slug' => $row->slug,
                    'name' => $row->name,
                    'image' => $row->image,
                ])
                ->all();
        });

        return collect($rows);
    }

    /** Today's word length — rotates 4→5→6→7, one step per calendar day. */
    private function lengthFor(string $date): int
    {
        $day = (int) floor(Carbon::parse($date)->startOfDay()->getTimestamp() / 86400);

        return self::LENGTHS[$day % count(self::LENGTHS)];
    }

    /** Difficulty label key derived from the word length. */
    private function difficulty(int $length): string
    {
        return match ($length) {
            4 => 'easy',
            5 => 'medium',
            6 => 'hard',
            default => 'expert',
        };
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
