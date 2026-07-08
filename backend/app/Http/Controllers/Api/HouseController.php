<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\HouseStatus;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Live house rent status for the map. The pins themselves come from the static
 * houses.json (coords/name/rent); this returns just the per-world CHANGING bit —
 * rented / auctioned / free (+ current bid) — keyed by the real Tibia house id,
 * for the frontend to merge onto the pins. Populated by tibia:etl-houses.
 */
class HouseController extends Controller
{
    /**
     * GET /api/houses?world=Antica → { world, synced_at, houses: { <id>: {status, bid} } }.
     * Keyed by id so the frontend merges in one pass.
     */
    public function index(Request $request): JsonResponse
    {
        $world = trim((string) $request->query('world', 'Antica'));

        $rows = HouseStatus::query()
            ->where('world', $world)
            ->get(['house_id', 'status', 'bid']);

        $houses = [];
        foreach ($rows as $r) {
            $houses[$r->house_id] = $r->bid > 0
                ? ['status' => $r->status, 'bid' => (int) $r->bid]
                : ['status' => $r->status];
        }

        return response()->json([
            'world' => $world,
            'synced_at' => HouseStatus::where('world', $world)->max('synced_at'),
            'houses' => $houses,
        ]);
    }

    /** Distinct worlds that have a status snapshot, for the map's world picker. */
    public function worlds(): JsonResponse
    {
        $worlds = HouseStatus::query()->distinct()->orderBy('world')->pluck('world');

        return response()->json(['data' => $worlds]);
    }
}
