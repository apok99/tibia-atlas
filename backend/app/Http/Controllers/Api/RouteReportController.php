<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RouteReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Route-bug reports from the interactive map. When a "Cómo llegar" route looks
 * wrong, a visitor submits the two endpoints (+ an optional note + a snapshot of
 * the computed itinerary) here. Write-only from the public: it lands as `open`
 * and is read back for a fix pass via `php artisan tibia:route-reports`.
 */
class RouteReportController extends Controller
{
    /**
     * Record a route-bug report. Anonymous (request IP kept for abuse control),
     * IP-throttled at the route level. The itinerary `plan` is a client-built
     * summary — validated loosely (it's diagnostic, not authoritative), size-
     * capped so a payload can't balloon.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from' => ['required', 'array', 'size:3'],
            'from.*' => ['numeric'],
            'to' => ['required', 'array', 'size:3'],
            'to.*' => ['numeric'],
            'from_label' => ['nullable', 'string', 'max:120'],
            'to_label' => ['nullable', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:2000'],
            'plan' => ['nullable', 'array'],
            'total_tiles' => ['nullable', 'integer', 'min:0'],
            'partial' => ['nullable', 'boolean'],
            'hash' => ['nullable', 'string', 'max:2000'],
            'view_floor' => ['nullable', 'integer', 'min:0', 'max:15'],
            'lang' => ['nullable', 'string', 'max:5'],
        ]);

        $report = RouteReport::create([
            'from_x' => (int) $data['from'][0],
            'from_y' => (int) $data['from'][1],
            'from_floor' => (int) $data['from'][2],
            'from_label' => $data['from_label'] ?? null,
            'to_x' => (int) $data['to'][0],
            'to_y' => (int) $data['to'][1],
            'to_floor' => (int) $data['to'][2],
            'to_label' => $data['to_label'] ?? null,
            'note' => $data['note'] ?? null,
            // Keep the itinerary compact regardless of what the client sent.
            'plan' => isset($data['plan']) ? $this->trimPlan($data['plan']) : null,
            'total_tiles' => $data['total_tiles'] ?? null,
            'partial' => $data['partial'] ?? false,
            'hash' => $data['hash'] ?? null,
            'view_floor' => $data['view_floor'] ?? null,
            'lang' => $data['lang'] ?? null,
            'ip' => $request->ip(),
            'status' => 'open',
        ]);

        return response()->json(['status' => 'open', 'id' => $report->id], 201);
    }

    /**
     * Defensive server-side trim of the itinerary: cap the number of legs and, on
     * walk legs, drop any full per-tile path down to its endpoints. The frontend
     * already sends a summary, but a report row must never carry a megabyte of
     * coordinates from a hand-crafted payload.
     */
    private function trimPlan(array $plan): array
    {
        $legs = $plan['legs'] ?? null;
        if (is_array($legs)) {
            $plan['legs'] = array_map(function ($leg) {
                if (is_array($leg) && isset($leg['path']) && is_array($leg['path'])) {
                    $path = $leg['path'];
                    $leg['path'] = count($path) > 2 ? [$path[0], $path[count($path) - 1]] : $path;
                }

                return $leg;
            }, array_slice($legs, 0, 80));
        }

        return $plan;
    }
}
