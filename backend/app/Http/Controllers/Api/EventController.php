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
