<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Hunt\HuntFinder;
use App\Support\ContentCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Hunt Finder: given a level + vocation + solo/team mode, rank the best hunting
 * zones for that player, with a per-creature breakdown. The scoring — gear
 * derivation, offensive affinity, reward and danger — lives in HuntFinder.
 */
class HuntController extends Controller
{
    public function index(Request $request, HuntFinder $finder): JsonResponse
    {
        $level = max(1, min(2000, $request->integer('level', 1)));
        $vocation = strtolower((string) $request->string('vocation'));
        $mode = (string) $request->string('mode') === 'team' ? 'team' : 'solo';
        $locale = app()->getLocale();

        // Optional real equipment (entry ids from the map's character gear):
        // when present the finder scores against that set instead of deriving
        // one. Sorted + capped so equivalent selections share a cache entry.
        $gear = collect(explode(',', (string) $request->string('gear')))
            ->map(fn ($v) => (int) trim($v))
            ->filter(fn ($v) => $v > 0)
            ->unique()
            ->sort()
            ->take(12)
            ->values()
            ->all();

        // Deterministic in its inputs and moderately expensive (scores every
        // creature, clusters every spawn), so cache the computed payload.
        $gearKey = $gear === [] ? 'none' : implode('-', $gear);
        $key = ContentCache::key("hunts:{$level}:{$vocation}:{$mode}:{$locale}:{$gearKey}");
        $payload = Cache::remember($key, 900, fn () => $finder->find($level, $vocation, $mode, $locale, $gear));

        return response()->json($payload);
    }
}
