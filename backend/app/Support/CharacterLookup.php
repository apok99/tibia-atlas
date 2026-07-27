<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Lightweight "does this Tibia character exist?" check against TibiaData, used to
 * gate the daily score boards. The full character payload (deaths, houses, guild)
 * lives in CharacterController; this only needs the identity fields the board
 * renders, so it caches a tiny row and survives a lot more traffic.
 *
 * The result is three-state, and only 'found' may take a board slot: a name has
 * to be positively confirmed to be ranked. That matters because TibiaData does
 * NOT answer a clean 404 for an unknown character — it 502s — so "the upstream
 * errored" and "that character is made up" are the same observation from here.
 * Accepting on error would let any string onto the board.
 */
class CharacterLookup
{
    /** A confirmed character is stable; cache it for a few hours. */
    private const TTL_FOUND = 6 * 3600;

    /** A miss is often a fresh character or a typo; re-check soon. */
    private const TTL_MISSING = 600;

    /**
     * status:
     *   'found'       — confirmed; `character` is filled in.
     *   'missing'     — TibiaData answered, and there is no such character.
     *   'unavailable' — TibiaData could not be reached or errored; existence unknown.
     *
     * @return array{status: 'found'|'missing'|'unavailable', character: array{name: string, world: ?string, level: ?int, vocation: ?string}|null}
     */
    public static function lookup(string $name): array
    {
        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 40) {
            return ['status' => 'missing', 'character' => null];
        }

        $key = 'char:verify:'.mb_strtolower($name);
        $cached = Cache::get($key);
        if ($cached !== null) {
            // 'missing' is stored as a marker string so a negative result caches too.
            return $cached === 'missing'
                ? ['status' => 'missing', 'character' => null]
                : ['status' => 'found', 'character' => $cached];
        }

        $base = rtrim((string) env('TIBIADATA_BASE_URL', 'https://api.tibiadata.com'), '/');

        try {
            $resp = Http::timeout(10)->retry(2, 500)
                ->withHeaders(['User-Agent' => 'TibiaAtlas/1.0 (+daily game boards)'])
                ->get("{$base}/v4/character/".rawurlencode($name));
        } catch (\Throwable) {
            return ['status' => 'unavailable', 'character' => null];
        }

        if (! $resp->successful()) {
            // A 404 (or TibiaData's own 404-in-JSON) is a real "no such character";
            // anything else — including the 502 it serves for unknown names — is
            // indistinguishable from an outage, so it stays 'unavailable'.
            $upstreamCode = (int) $resp->json('information.status.http_code', 0);
            if ($resp->status() === 404 || $upstreamCode === 404) {
                Cache::put($key, 'missing', self::TTL_MISSING);

                return ['status' => 'missing', 'character' => null];
            }

            return ['status' => 'unavailable', 'character' => null];
        }

        $char = $resp->json('character.character');
        // TibiaData answers 200 with an empty character block for unknown names.
        if (! is_array($char) || empty($char['name'])) {
            Cache::put($key, 'missing', self::TTL_MISSING);

            return ['status' => 'missing', 'character' => null];
        }

        $row = [
            'name' => (string) $char['name'],
            'world' => $char['world'] ?? null,
            'level' => isset($char['level']) ? (int) $char['level'] : null,
            'vocation' => $char['vocation'] ?? null,
        ];
        Cache::put($key, $row, self::TTL_FOUND);

        return ['status' => 'found', 'character' => $row];
    }
}
