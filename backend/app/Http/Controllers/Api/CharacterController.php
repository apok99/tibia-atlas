<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * Thin proxy to TibiaData's character endpoint, feeding the map's "your
 * character" overlay. We fetch /v4/character/{name} and return a trimmed shape:
 * enough to identify the char (level, vocation, world) and to plot it on the
 * atlas (its house, its recent deaths). Locale-agnostic — TibiaData names are
 * English and the frontend renders the labels.
 */
class CharacterController extends Controller
{
    /**
     * GET /api/character/{name}
     * → { found, character: { name, level, vocation, sex, world, residence,
     *     guild: {name, rank}|null, houses: [{name, town, houseid}],
     *     last_login, deaths: [{time, level, reason, killers: [{name, player}]}] } }
     */
    public function show(Request $request, string $name): JsonResponse
    {
        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 40) {
            return response()->json(['found' => false, 'error' => 'invalid_name'], 422);
        }

        $base = rtrim((string) env('TIBIADATA_BASE_URL', 'https://api.tibiadata.com'), '/');

        try {
            $resp = Http::timeout(15)->retry(2, 800)
                ->withHeaders(['User-Agent' => 'TibiaAtlas/1.0 (+map character lookup)'])
                ->get("{$base}/v4/character/".rawurlencode($name));
        } catch (\Throwable $e) {
            return response()->json(['found' => false, 'error' => 'upstream_unreachable'], 502);
        }

        if (! $resp->successful()) {
            return response()->json(['found' => false, 'error' => 'upstream_error'], 502);
        }

        $char = $resp->json('character.character');
        if (! is_array($char) || empty($char['name'])) {
            // TibiaData returns 200 with an empty character block for unknown names.
            return response()->json(['found' => false]);
        }

        $guild = $char['guild'] ?? null;
        $houses = array_map(fn ($h) => [
            'name' => $h['name'] ?? null,
            'town' => $h['town'] ?? null,
            'houseid' => isset($h['houseid']) ? (int) $h['houseid'] : null,
        ], is_array($char['houses'] ?? null) ? $char['houses'] : []);

        // Keep the most recent handful of deaths; each with a compact killer list.
        $deaths = array_map(fn ($d) => [
            'time' => $d['time'] ?? null,
            'level' => isset($d['level']) ? (int) $d['level'] : null,
            'reason' => $d['reason'] ?? null,
            'killers' => array_map(fn ($k) => [
                'name' => $k['name'] ?? null,
                'player' => (bool) ($k['player'] ?? false),
            ], is_array($d['killers'] ?? null) ? array_slice($d['killers'], 0, 8) : []),
        ], is_array($resp->json('character.deaths')) ? array_slice($resp->json('character.deaths'), 0, 10) : []);

        return response()->json([
            'found' => true,
            'character' => [
                'name' => $char['name'],
                'level' => isset($char['level']) ? (int) $char['level'] : null,
                'vocation' => $char['vocation'] ?? null,
                'sex' => $char['sex'] ?? null,
                'world' => $char['world'] ?? null,
                'residence' => $char['residence'] ?? null,
                'guild' => is_array($guild) && ! empty($guild['name'])
                    ? ['name' => $guild['name'], 'rank' => $guild['rank'] ?? null]
                    : null,
                'houses' => array_values(array_filter($houses, fn ($h) => $h['name'] !== null)),
                'last_login' => $char['last_login'] ?? null,
                'deaths' => $deaths,
            ],
        ]);
    }
}
