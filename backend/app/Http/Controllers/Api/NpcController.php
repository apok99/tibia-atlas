<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TradeNpc;
use App\Support\TravellingNpcs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Merchant NPC lookup for the map's search box: find an NPC by name and get
 * its map spawn tiles back so the map can fly there and trace the "Cómo
 * llegar" route straight to the shop. Travelling traders (Rashid, Yasir)
 * resolve to where they actually stand today, same as the item trade board.
 */
class NpcController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        if (mb_strlen($q) < 2) {
            return response()->json(['data' => []]);
        }

        $npcs = TradeNpc::query()
            ->with('entry')
            ->where('name', 'ilike', '%'.$q.'%')
            ->orderByRaw('(name ilike ?) desc', [$q.'%']) // prefix matches first
            ->orderBy('name')
            ->limit(8)
            ->get();

        $data = [];
        foreach ($npcs as $npc) {
            $travelling = TravellingNpcs::decorate($npc->name);
            $entry = $npc->entry;
            $coords = $travelling === null
                ? $npc->spawns
                : (isset($travelling['today'])
                    ? [$travelling['today']['coords']]
                    : array_column($travelling['spots'] ?? [], 'coords'));

            $data[] = [
                'npc' => $npc->name,
                // Link through to the lore entry only when it's actually readable.
                'slug' => $entry !== null && $entry->status->value === 'published' ? $entry->slug : null,
                'image' => $entry?->primary_image,
                'city' => $travelling['today']['city'] ?? $npc->city,
                'coords' => $coords ?? [],
                'travelling' => $travelling,
            ];
        }

        return response()->json(['data' => $data]);
    }
}
