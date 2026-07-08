<?php

namespace App\Services\KillStats;

use App\Queries\KillStats\BossRespawnQuery;
use App\Queries\KillStats\BossWatchQuery;
use App\Queries\KillStats\CreatureKillStatsQuery;
use App\Queries\KillStats\ExperienceRankingQuery;
use App\Queries\KillStats\KillOverviewQuery;
use App\Queries\KillStats\KillStatsMetaQuery;
use App\Queries\KillStats\RaceRankingQuery;
use App\Queries\KillStats\RaceSeriesQuery;
use App\Support\KillStatsCache;
use App\Transformers\KillStats\BossRespawnTransformer;
use App\Transformers\KillStats\BossWatchTransformer;
use App\Transformers\KillStats\CreatureKillStatsTransformer;
use App\Transformers\KillStats\ExperienceRankingTransformer;
use App\Transformers\KillStats\KillPointTransformer;
use App\Transformers\KillStats\OverviewTransformer;
use App\Transformers\KillStats\RaceRankingTransformer;
use Illuminate\Support\Carbon;

/**
 * Read-side application service for the kill-statistics dashboard. Every public
 * method assembles one endpoint's payload by delegating to a query (DB access)
 * and a transformer (output shape); the controller just returns the result.
 */
class KillStatsService
{
    public function __construct(
        private KillStatsMetaQuery $meta,
        private RaceRankingQuery $ranking,
        private RaceSeriesQuery $series,
        private CreatureKillStatsQuery $creature,
        private ExperienceRankingQuery $experience,
        private KillOverviewQuery $overview,
        private BossWatchQuery $bossWatch,
        private BossRespawnQuery $bossRespawn,
        private RespawnAnalyzer $respawnAnalyzer,
        private KillPointTransformer $points,
        private RaceRankingTransformer $rankingTransformer,
        private ExperienceRankingTransformer $experienceTransformer,
        private OverviewTransformer $overviewTransformer,
        private BossWatchTransformer $bossWatchTransformer,
        private BossRespawnTransformer $bossRespawnTransformer,
        private CreatureKillStatsTransformer $creatureTransformer,
    ) {}

    /** @return array<string, mixed> */
    public function meta(): array
    {
        return KillStatsCache::remember('meta', fn () => $this->meta->summary());
    }

    /** @return array<string, mixed> */
    public function worlds(): array
    {
        return KillStatsCache::remember('worlds', fn () => ['data' => $this->meta->worlds()]);
    }

    /** @return array<string, mixed> */
    public function ranking(string $window, string $world, string $metric, int $limit): array
    {
        $key = 'ranking:'.$window.':'.rawurlencode($world).':'.$metric.':'.$limit;

        return KillStatsCache::remember($key, fn () => [
            'window' => $window,
            'metric' => $metric,
            'world' => $world,
            'data' => $this->rankingTransformer->collection(
                $this->ranking->get($window, $world, $metric, $limit),
            ),
        ]);
    }

    /** @return array<string, mixed> */
    public function series(string $race, string $world, string $granularity): array
    {
        $key = 'series:'.rawurlencode($race).':'.rawurlencode($world).':'.$granularity;

        return KillStatsCache::remember($key, function () use ($race, $world, $granularity) {
            $base = ['race' => $race, 'world' => $world, 'granularity' => $granularity];

            $raceId = $this->series->raceId($race);
            if (! $raceId) {
                return [...$base, 'data' => []];
            }

            $rows = $this->series->get($raceId, $world, $granularity);
            $precision = $granularity === 'day' ? KillPointTransformer::DAY : KillPointTransformer::MONTH;

            return [...$base, 'data' => $this->points->collection($rows, $precision)];
        });
    }

    /** @return array<string, mixed> */
    public function entry(string $slug): array
    {
        return KillStatsCache::remember('entry:'.rawurlencode($slug), function () use ($slug) {
            $race = $this->creature->raceForSlug($slug);
            if (! $race) {
                return ['linked' => false, 'race' => null, 'latest' => null, 'popularity' => null, 'series' => []];
            }

            $expEach = is_numeric($race->exp_each) ? (int) $race->exp_each : null;

            $latest = null;
            $popularity = null;
            $latestDate = $this->creature->latestDate($race->id);
            if ($latestDate) {
                $row = $this->creature->totalsOn($race->id, $latestDate);
                $latest = $this->creatureTransformer->latest($latestDate, $row, $expEach);
                $popularity = $this->creatureTransformer->popularity($this->creature->popularityOn($race->id, $latestDate));
            }

            return [
                'linked' => true,
                'race' => $race->name,
                'latest' => $latest,
                'popularity' => $popularity,
                'series' => $this->points->collection($this->creature->dailySeries($race->id), KillPointTransformer::DAY),
            ];
        });
    }

    /** @return array<string, mixed> */
    public function experience(string $window, string $world, int $limit): array
    {
        $key = 'experience:'.$window.':'.rawurlencode($world).':'.$limit;

        return KillStatsCache::remember($key, fn () => [
            'window' => $window,
            'world' => $world,
            'data' => $this->experienceTransformer->collection(
                $this->experience->get($window, $world, $limit),
            ),
        ]);
    }

    /**
     * @param  string  $world  'all' or a world name — scopes the kill TOTALS only
     *                         (online population, history and pulse stay network-wide).
     * @return array<string, mixed>
     */
    public function overview(string $world = 'all'): array
    {
        return KillStatsCache::remember('overview:'.rawurlencode($world), function () use ($world) {
            $latest = $this->overview->latestDate();
            $worldId = $this->overview->worldId($world);

            return $this->overviewTransformer->build(
                latest: $latest,
                totals: $latest ? $this->overview->totals($latest, $worldId) : null,
                exp24h: $latest ? $this->overview->experience24h($latest, $worldId) : 0,
                series: $latest ? $this->overview->activitySeries($latest) : collect(),
                onlineHistory: $this->overview->onlineHistory(),
                onlinePeak: $this->overview->onlinePeak(),
                worlds: $this->overview->worlds(),
            );
        });
    }

    /**
     * @param  string  $type  'raid' (rare world bosses) or 'daily' (per-cooldown
     *                        bosses killed across most worlds every day).
     * @param  string|null  $world  null → heat aggregated across all worlds;
     *                              a world name → heat scoped to that world.
     * @return array<string, mixed>
     */
    public function bosses(int $limit, string $type = 'raid', ?string $world = null): array
    {
        $key = "bosses:{$type}:{$limit}:".($world ?? 'all');

        return KillStatsCache::remember($key, function () use ($limit, $type, $world) {
            $latest = $this->bossWatch->latestDate();
            $rows = $latest
                ? $this->bossWatch->rows($latest, (int) config('killstats.raid_max_worlds'), $type, $world)
                : collect();

            return [
                'latest' => $latest,
                'type' => $type,
                'world' => $world,
                'data' => $this->bossWatchTransformer->collection($rows, config('killstats.iconic_raid_bosses'), $limit, $type, $world),
            ];
        });
    }

    /** @return array<string, mixed> */
    public function boss(string $slug): array
    {
        return KillStatsCache::remember('boss:'.rawurlencode($slug), function () use ($slug) {
            $race = $this->bossRespawn->raceForSlug($slug);
            if (! $race) {
                return ['linked' => false, 'race' => null];
            }

            $latestDate = $this->bossRespawn->latestDate($race->id);
            $shaped = $this->bossRespawnTransformer->build(
                $this->bossRespawn->currentStatus($race->id, $latestDate),
                $this->bossRespawn->lastKillPerWorld($race->id),
                Carbon::today(),
            );

            return [
                'linked' => true,
                'race' => $race->name,
                'is_boss' => $race->rank === 'Boss',
                'latest_date' => $latestDate,
                'summary' => $shaped['summary'],
                'worlds' => $shaped['worlds'],
                'respawn' => $this->respawnAnalyzer->model($this->bossRespawn->killEvents($race->id)),
            ];
        });
    }
}
