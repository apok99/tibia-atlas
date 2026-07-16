<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MapRoute;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Community routes on the interactive map. Visitors build a named list of
 * waypoints and submit it here; there are no accounts, so a submission is
 * anonymous — we keep an optional author nickname and the request IP for
 * moderation. Everything lands as `pending`; a reviewer flips the status to
 * `published` (via API/DB for now), and only those are served publicly.
 */
class MapRouteController extends Controller
{
    /**
     * Published community routes, most popular first (by likes, then load count,
     * then newest), for the map's route gallery. Paginated — the gallery is a
     * small popover, so it pulls one page at a time (default 6) rather than the
     * whole published set. Response shape matches the frontend `Paginated<T>`.
     */
    public function index(Request $request): JsonResponse
    {
        $perPage = max(1, min(50, (int) $request->integer('per_page', 6)));

        $routes = MapRoute::query()
            ->where('status', 'published')
            ->orderByDesc('likes')
            ->orderByDesc('views')
            ->latest()
            ->paginate($perPage, ['id', 'name', 'description', 'waypoints', 'connect', 'author', 'views', 'likes', 'created_at']);

        return response()->json([
            'data' => $routes->items(),
            'meta' => [
                'current_page' => $routes->currentPage(),
                'last_page' => $routes->lastPage(),
                'total' => $routes->total(),
                'per_page' => $routes->perPage(),
            ],
        ]);
    }

    /** Bump a published route's load counter (drives the "popular" ranking). */
    public function view(MapRoute $route): JsonResponse
    {
        if ($route->status === 'published') {
            $route->increment('views');
        }

        return response()->json(['views' => $route->views]);
    }

    /**
     * Like a published route. Anonymous — the frontend tracks which routes a
     * visitor has liked (localStorage) so it won't double-count; this just bumps
     * the counter, the primary popularity signal for the gallery.
     */
    public function like(MapRoute $route): JsonResponse
    {
        if ($route->status === 'published') {
            $route->increment('likes');
        }

        return response()->json(['likes' => $route->likes]);
    }

    /** Undo a like (visitor un-hearted a route). Never drops below zero. */
    public function unlike(MapRoute $route): JsonResponse
    {
        if ($route->status === 'published' && $route->likes > 0) {
            $route->decrement('likes');
        }

        return response()->json(['likes' => $route->likes]);
    }

    /**
     * Submit a route for review. Stored anonymously (optional nickname + IP) with
     * a `pending` status; nothing is shown publicly until a reviewer approves it.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:2000'],
            'connect' => ['required', 'in:auto,straight'],
            'author' => ['nullable', 'string', 'max:60'],
            'waypoints' => ['required', 'array', 'min:2', 'max:60'],
            'waypoints.*' => ['array', 'size:3'],
            'waypoints.*.*' => ['numeric'],
        ]);

        // Normalise to integer [x, y, z] triples.
        $waypoints = array_map(
            fn ($p) => [(int) $p[0], (int) $p[1], (int) $p[2]],
            $data['waypoints'],
        );

        $route = MapRoute::create([
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'waypoints' => $waypoints,
            'connect' => $data['connect'],
            'author' => $data['author'] ?? null,
            'ip' => $request->ip(),
            'status' => 'pending',
        ]);

        return response()->json(['status' => 'pending', 'id' => $route->id], 201);
    }
}
