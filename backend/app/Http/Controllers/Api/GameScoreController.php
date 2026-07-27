<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GameScore;
use App\Support\CharacterLookup;
use App\Support\GameDay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * The daily score boards for the three puzzle games. One board per game per Tibia
 * day, top 10, ranked by attempts and then by elapsed time — the boards wipe
 * themselves at server save simply because every query filters on the current
 * game day (App\Support\GameDay).
 *
 * A run is tied to the Tibia character the player linked on the map ("tu
 * personaje"), and the name is verified against TibiaData before it can take a
 * slot, so the board ranks real characters instead of anonymous browsers. Only
 * solved runs are accepted, and only an improvement overwrites a character's
 * existing run for the day.
 */
class GameScoreController extends Controller
{
    /** The three games that have a board, and how many tries each allows. */
    private const MAX_ATTEMPTS = [
        'wordle' => 6,
        'altar' => 1,
        'geo' => 1,
    ];

    /** Board size. */
    private const TOP = 10;

    /**
     * Floor/ceiling for a submitted run, in ms. The floor rejects an impossible
     * "solved in 40ms" (a scripted POST); the ceiling caps a tab left open
     * overnight so it can't overflow the column.
     */
    private const MIN_MS = 800;

    private const MAX_MS = 12 * 3600 * 1000;

    /**
     * GET /api/games/{game}/board[?char=Name]
     * → { game, date, next_save, players, top: [row…], you: row|null }
     *
     * `char` asks for that character's own standing too, so a player ranked
     * outside the top 10 still sees where they landed.
     */
    public function index(Request $request, string $game): JsonResponse
    {
        $this->assertGame($game);
        $date = GameDay::date();
        $rows = $this->rankedRows($game, $date);
        $char = trim((string) $request->query('char', ''));

        return response()->json([
            'game' => $game,
            'date' => $date,
            'next_save' => GameDay::nextSave()->toIso8601String(),
            'players' => $rows->count(),
            'top' => $rows->take(self::TOP)->values(),
            'you' => $char === '' ? null : $this->standing($rows, $char),
        ]);
    }

    /**
     * POST /api/games/{game}/board  { char_name, attempts, time_ms }
     * → { ok, improved, date, next_save, players, top: [row…], you: row|null }
     *
     * A slot needs a character TibiaData confirms, so an unconfirmed name is
     * refused (422) — `char_not_found` when the name is definitively unknown,
     * `char_unverified` when TibiaData couldn't answer. The client keeps the run
     * and retries the second case on a later visit.
     */
    public function store(Request $request, string $game): JsonResponse
    {
        $this->assertGame($game);

        $data = $request->validate([
            'char_name' => ['required', 'string', 'min:2', 'max:40'],
            'attempts' => ['required', 'integer', 'min:1', 'max:'.self::MAX_ATTEMPTS[$game]],
            'time_ms' => ['required', 'integer', 'min:'.self::MIN_MS, 'max:'.self::MAX_MS],
        ]);

        $lookup = CharacterLookup::lookup($data['char_name']);
        if ($lookup['status'] !== 'found') {
            return response()->json([
                'ok' => false,
                'error' => $lookup['status'] === 'missing' ? 'char_not_found' : 'char_unverified',
            ], 422);
        }
        // TibiaData's spelling is canonical — it fixes the player's capitalisation.
        $char = $lookup['character'];

        $date = GameDay::date();
        $key = GameScore::keyFor($char['name']);
        $existing = GameScore::where(['game' => $game, 'date' => $date, 'char_key' => $key])->first();

        $improved = true;
        if ($existing === null) {
            GameScore::create([
                'game' => $game,
                'date' => $date,
                'char_name' => $char['name'],
                'char_key' => $key,
                'world' => $char['world'],
                'level' => $char['level'],
                'vocation' => $char['vocation'],
                'attempts' => $data['attempts'],
                'time_ms' => $data['time_ms'],
            ]);
        } elseif ($existing->isBeatenBy($data['attempts'], $data['time_ms'])) {
            $existing->update([
                'attempts' => $data['attempts'],
                'time_ms' => $data['time_ms'],
                // Refresh the identity snapshot too — the player may have levelled.
                'char_name' => $char['name'],
                'world' => $char['world'] ?? $existing->world,
                'level' => $char['level'] ?? $existing->level,
                'vocation' => $char['vocation'] ?? $existing->vocation,
            ]);
        } else {
            // Today's stored run is already better; keep it.
            $improved = false;
        }

        $rows = $this->rankedRows($game, $date);

        return response()->json([
            'ok' => true,
            'improved' => $improved,
            'game' => $game,
            'date' => $date,
            'next_save' => GameDay::nextSave()->toIso8601String(),
            'players' => $rows->count(),
            'top' => $rows->take(self::TOP)->values(),
            'you' => $this->standing($rows, $char['name']),
        ]);
    }

    // ---- Internals -----------------------------------------------------

    private function assertGame(string $game): void
    {
        abort_unless(array_key_exists($game, self::MAX_ATTEMPTS), 404);
    }

    /**
     * Every solver of the day, in board order, each already carrying its rank.
     * The full day is small (one row per character), so ranking in PHP keeps the
     * "your standing" lookup free of a second query.
     *
     * @return Collection<int, array{rank:int, char_name:string, world:?string, level:?int, vocation:?string, attempts:int, time_ms:int}>
     */
    private function rankedRows(string $game, string $date): Collection
    {
        return GameScore::query()
            ->where('game', $game)
            ->where('date', $date)
            ->orderBy('attempts')
            ->orderBy('time_ms')
            // Deterministic tiebreak: whoever got there first on an exact tie.
            ->orderBy('id')
            ->get(['char_name', 'world', 'level', 'vocation', 'attempts', 'time_ms'])
            ->values()
            ->map(fn ($row, $i) => [
                'rank' => $i + 1,
                'char_name' => $row->char_name,
                'world' => $row->world,
                'level' => $row->level,
                'vocation' => $row->vocation,
                'attempts' => (int) $row->attempts,
                'time_ms' => (int) $row->time_ms,
            ]);
    }

    /**
     * One character's row out of the ranked day, or null if they haven't solved it.
     *
     * @param  Collection<int, array<string, mixed>>  $rows
     * @return array<string, mixed>|null
     */
    private function standing(Collection $rows, string $name): ?array
    {
        $key = GameScore::keyFor($name);

        return $rows->first(fn ($row) => GameScore::keyFor($row['char_name']) === $key);
    }
}
