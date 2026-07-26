<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\HouseBid;
use App\Models\HouseSale;
use App\Models\HouseStatus;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

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

    /**
     * GET /api/houses/{world}/{id}/bids → the auction price history of one house.
     *
     * Only bid CHANGES are stored, so the series is naturally sparse: a step per
     * time someone actually outbid the previous offer.
     */
    public function bids(Request $request, string $world, int $house): JsonResponse
    {
        $days = max(1, min(365, (int) $request->query('days', 90)));

        $bids = HouseBid::query()
            ->where('world', $world)
            ->where('house_id', $house)
            ->where('observed_at', '>=', now()->subDays($days))
            ->orderBy('observed_at')
            ->get(['bid', 'time_left', 'observed_at'])
            ->map(fn (HouseBid $b) => [
                'bid' => $b->bid,
                'time_left' => $b->time_left,
                'at' => $b->observed_at?->toIso8601String(),
            ]);

        // Past auctions of the same house, so the chart can mark what it sold for.
        $sales = HouseSale::query()
            ->where('world', $world)
            ->where('house_id', $house)
            ->orderBy('sold_at')
            ->get(['price', 'sold_at'])
            ->map(fn (HouseSale $s) => ['price' => $s->price, 'at' => $s->sold_at?->toIso8601String()]);

        return response()->json([
            'world' => $world,
            'house_id' => $house,
            'bids' => $bids,
            'sales' => $sales,
        ]);
    }

    /**
     * GET /api/houses/prices → the house price index: what auctions actually
     * closed at, bucketed by day.
     *
     * Filterable by world and town. Returns the median (not the mean) — a single
     * 150M trophy sale would otherwise drag a whole town's average with it.
     */
    public function prices(Request $request): JsonResponse
    {
        $days = max(7, min(365, (int) $request->query('days', 90)));
        $world = trim((string) $request->query('world', ''));
        $town = trim((string) $request->query('town', ''));

        $q = HouseSale::query()->where('sold_at', '>=', now()->subDays($days));
        if ($world !== '') {
            $q->where('world', $world);
        }
        if ($town !== '') {
            $q->where('town', $town);
        }

        // PERCENTILE_CONT is Postgres-native and does the median in one pass.
        $rows = $q
            ->selectRaw('date_trunc(?, sold_at) AS day', ['day'])
            ->selectRaw('COUNT(*) AS sales')
            ->selectRaw('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) AS median')
            ->selectRaw('MIN(price) AS low, MAX(price) AS high')
            ->groupBy('day')
            ->orderBy('day')
            ->get();

        return response()->json([
            'world' => $world ?: null,
            'town' => $town ?: null,
            'days' => $days,
            'points' => $rows->map(fn ($r) => [
                'day' => (string) $r->day,
                'sales' => (int) $r->sales,
                'median' => (int) round((float) $r->median),
                'low' => (int) $r->low,
                'high' => (int) $r->high,
            ]),
        ]);
    }

    /** Towns that have recorded at least one sale, for the price-index filter. */
    public function priceTowns(): JsonResponse
    {
        return response()->json([
            'data' => HouseSale::query()->distinct()->orderBy('town')->pluck('town'),
        ]);
    }

    /**
     * GET /api/houses/{world}/{id} — live detail for ONE house, proxied straight
     * from TibiaData's per-house endpoint. The town lists the ETL consumes carry
     * no owner name, so the map popup fetches this on demand when a rented house
     * is opened. Trimmed to what the popup shows.
     */
    public function show(string $world, int $house): JsonResponse
    {
        $base = rtrim((string) env('TIBIADATA_BASE_URL', 'https://api.tibiadata.com'), '/');

        try {
            $resp = Http::timeout(15)->retry(2, 800)
                ->withHeaders(['User-Agent' => 'TibiaAtlas/1.0 (+map house lookup)'])
                ->get("{$base}/v4/house/".rawurlencode($world).'/'.$house);
        } catch (\Throwable $e) {
            return response()->json(['found' => false, 'error' => 'upstream_unreachable'], 502);
        }

        if (! $resp->successful()) {
            return response()->json(['found' => false, 'error' => 'upstream_error'], 502);
        }

        $h = $resp->json('house');
        if (! is_array($h) || empty($h['houseid'])) {
            // TibiaData answers 200 with an empty block for unknown world/id pairs.
            return response()->json(['found' => false]);
        }

        $status = $h['status'] ?? [];
        $rental = $status['rental'] ?? [];
        $auction = $status['auction'] ?? [];
        $str = fn ($v) => is_string($v) && $v !== '' ? $v : null;

        return response()->json([
            'found' => true,
            'house' => [
                'id' => (int) $h['houseid'],
                'world' => $h['world'] ?? $world,
                'name' => $h['name'] ?? null,
                'rented' => (bool) ($status['is_rented'] ?? false),
                'auctioned' => (bool) ($status['is_auctioned'] ?? false),
                'owner' => $str($rental['owner'] ?? null),
                'paid_until' => $str($rental['paid_until'] ?? null),
                'bid' => (int) ($auction['current_bid'] ?? 0),
                'bidder' => $str($auction['current_bidder'] ?? null),
                'auction_end' => $str($auction['auction_end'] ?? null),
            ],
        ]);
    }

    /** Distinct worlds that have a status snapshot, for the map's world picker. */
    public function worlds(): JsonResponse
    {
        $worlds = HouseStatus::query()->distinct()->orderBy('world')->pluck('world');

        return response()->json(['data' => $worlds]);
    }
}
