<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Entry;
use App\Services\Hunt\ZoneAnalyzer;
use App\Support\ContentCache;
use App\Support\GearRules;
use App\Support\SetStats;
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

    /**
     * Protection imbuements per element (the shield/armor "…% protection"
     * line): basic 5% → powerful 15%. Physical and holy have no protection
     * imbuement in the game, so they map to null.
     */
    private const PROTECTION_IMBUES = [
        'fire' => 'Dragon Hide',
        'earth' => 'Snake Skin',
        'ice' => 'Quara Scale',
        'energy' => 'Cloud Fabric',
        'death' => 'Lich Shroud',
        'holy' => null,
        'physical' => null,
    ];

    /**
     * "How do I protect myself from <element> here?" — the clicked bar of the
     * zone panel's incoming-damage chart. Returns the best OBTAINABLE gear
     * pieces carrying that elemental resist (top of each slot first, so the
     * answer reads as an outfit, not ten helmets) plus the element's protection
     * imbuement when one exists.
     */
    public function protection(Request $request): JsonResponse
    {
        $element = strtolower((string) $request->string('element'));
        if (! in_array($element, SetStats::ELEMENTS, true)) {
            return response()->json(['message' => 'unknown element'], 422);
        }
        $locale = app()->getLocale();

        $key = ContentCache::key("zone-protection:{$element}:{$locale}");
        $payload = Cache::remember($key, 3600, function () use ($element) {
            $rows = Entry::query()
                ->ofType('item')
                ->whereRaw("jsonb_exists(meta, 'equip_slot')")
                ->whereRaw("coalesce((meta->'resists'->>?)::int, 0) > 0", [$element])
                ->whereRaw(GearRules::OBTAINABLE_SQL)
                ->with(['translations' => fn ($t) => $t->where('locale', 'en')])
                ->get(['id', 'slug', 'meta', 'primary_image']);

            $items = $rows->map(fn (Entry $e) => [
                'slug' => $e->slug,
                'name' => $e->translations->first()?->name ?? $e->slug,
                'image' => $e->primary_image,
                'slot' => (string) ($e->meta['equip_slot'] ?? ''),
                'pct' => (int) ($e->meta['resists'][$element] ?? 0),
                'level' => (int) ($e->meta['level'] ?? 0),
            ])->sortByDesc('pct')->values();

            // Best two per slot, slots ordered by how much their best piece
            // helps — reads as "wear this" advice instead of a helmet parade.
            $bySlot = [];
            foreach ($items as $it) {
                $bySlot[$it['slot']][] = $it;
            }
            $out = [];
            foreach ($bySlot as $pieces) {
                $out[] = array_slice($pieces, 0, 2);
            }
            usort($out, fn ($a, $b) => $b[0]['pct'] <=> $a[0]['pct']);

            return [
                'element' => $element,
                'imbue' => self::PROTECTION_IMBUES[$element] ?? null,
                'slots' => $out,
            ];
        });

        return response()->json($payload);
    }
}
