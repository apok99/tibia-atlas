<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WorldEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Live "what's happening on your world" feed for the map's news ticker. Rows are
 * produced by tibia:etl-houses (house status transitions today); this just reads
 * the latest ones for a world. Locale-agnostic — the frontend renders the label.
 */
class EventController extends Controller
{
    /** How far back the ticker looks; older rows stay in the table but aren't news. */
    private const MAX_AGE_DAYS = 7;

    /**
     * GET /api/events?world=Antica&limit=40
     * → { world, events: [{id, type, ref_id, title, town, meta, occurred_at}] }
     */
    public function index(Request $request): JsonResponse
    {
        $world = trim((string) $request->query('world', 'Antica')) ?: 'Antica';
        $limit = max(1, min(80, (int) $request->query('limit', 40)));

        $events = WorldEvent::query()
            ->where('world', $world)
            // A ticker is for news, not history: anything older than a week is
            // stale even though the rows live 30 days (pruned by tibia:etl-houses).
            // On a quiet world the ticker simply shows the daily digest, or nothing.
            ->where('occurred_at', '>=', now()->subDays(self::MAX_AGE_DAYS))
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get(['id', 'type', 'ref_id', 'title', 'town', 'meta', 'occurred_at']);

        return response()->json([
            'world' => $world,
            'events' => $events,
        ]);
    }
}
