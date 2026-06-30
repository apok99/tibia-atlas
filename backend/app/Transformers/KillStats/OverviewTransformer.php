<?php

namespace App\Transformers\KillStats;

use Illuminate\Support\Collection;

/**
 * Assembles the dashboard hero overview payload from the raw overview
 * aggregates: headline totals, the live world population broken down by region
 * and PvP type, the busiest worlds, and the players-online history.
 */
class OverviewTransformer
{
    public function __construct(private KillPointTransformer $points) {}

    /**
     * @param  Collection<int, \stdClass>  $series  global daily activity
     * @param  Collection<int, \stdClass>  $onlineHistory
     * @param  Collection<int, \stdClass>  $worlds  live world population
     * @return array<string, mixed>
     */
    public function build(
        ?string $latest,
        ?\stdClass $totals,
        int $exp24h,
        Collection $series,
        Collection $onlineHistory,
        int $onlinePeak,
        Collection $worlds,
    ): array {
        return [
            'latest' => $latest,
            'totals' => [
                'players_killed_24h' => (int) ($totals->pk_24h ?? 0),
                'killed_24h' => (int) ($totals->k_24h ?? 0),
                'players_killed_7d' => (int) ($totals->pk_7d ?? 0),
                'killed_7d' => (int) ($totals->k_7d ?? 0),
                'exp_24h' => $exp24h,
                'active_races' => (int) ($totals->active_races ?? 0),
                'players_online' => (int) $worlds->sum('players_online'),
                'worlds' => $worlds->count(),
            ],
            'series' => $this->points->collection($series, KillPointTransformer::DAY),
            'online_history' => $onlineHistory->map(fn ($r) => [
                'time' => substr((string) $r->captured_at, 0, 16), // YYYY-MM-DD HH:MM
                'players_online' => (int) $r->players_online,
                'worlds_online' => (int) $r->worlds_online,
            ])->values(),
            'online_peak' => $onlinePeak,
            'regions' => $this->population($worlds, fn ($w) => $w->location ?: 'Unknown'),
            'pvp' => $this->population($worlds, fn ($w) => $w->pvp_type ?: 'Unknown'),
            'top_worlds' => $worlds
                ->sortByDesc('players_online')
                ->take(12)
                ->map(fn ($w) => ['name' => $w->name, 'players_online' => (int) $w->players_online])
                ->values(),
        ];
    }

    /**
     * Group the live worlds by a key (region/pvp) into population buckets.
     *
     * @param  Collection<int, \stdClass>  $worlds
     * @param  callable(\stdClass): string  $by
     * @return Collection<int, array<string, mixed>>
     */
    private function population(Collection $worlds, callable $by): Collection
    {
        return $worlds
            ->groupBy($by)
            ->map(fn ($g, $k) => [
                'name' => $k,
                'players_online' => (int) $g->sum('players_online'),
                'worlds' => $g->count(),
            ])
            ->sortByDesc('players_online')
            ->values();
    }
}
