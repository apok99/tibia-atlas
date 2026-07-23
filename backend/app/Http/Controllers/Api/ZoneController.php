<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Hunt\ZoneAnalyzer;
use App\Support\ContentCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Map zone analysis: the user drags a rectangle on a floor and gets a combat
 * summary of everything spawning inside it. The heavy lifting (bbox filter,
 * elemental aggregates) lives in ZoneAnalyzer.
 */
class ZoneController extends Controller
{
    public function summary(Request $request, ZoneAnalyzer $analyzer): JsonResponse
    {
        $x1 = $request->integer('x1');
        $y1 = $request->integer('y1');
        $x2 = $request->integer('x2');
        $y2 = $request->integer('y2');
        $z = max(0, min(15, $request->integer('z', 7)));
        if ($x1 <= 0 || $y1 <= 0 || $x2 <= 0 || $y2 <= 0) {
            return response()->json(['message' => 'x1, y1, x2, y2 are required'], 422);
        }
        $locale = app()->getLocale();

        // Deterministic in its inputs; repeat drags over the same spot (and the
        // corner-handle nudges that don't change the box) share the entry.
        $key = ContentCache::key("zone-summary:{$x1}:{$y1}:{$x2}:{$y2}:{$z}:{$locale}");
        $payload = Cache::remember($key, 900, fn () => $analyzer->analyze($x1, $y1, $x2, $y2, $z, $locale));

        return response()->json($payload);
    }
}
