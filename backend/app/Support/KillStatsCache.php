<?php

namespace App\Support;

use Closure;
use Illuminate\Support\Facades\Cache;

/**
 * Version stamp + response cache for the kill-statistics warehouse.
 *
 * The underlying data only changes when the hourly ETL runs, yet every
 * dashboard endpoint used to re-aggregate kill_daily (millions of rows) per
 * request. The ETL bumps the version when it lands new data, so cached
 * payloads are served until then; the TTL is only a backstop.
 *
 * Same versioned-key idea as {@see ContentCache}, kept as a separate stamp so
 * lore edits don't evict kill stats (and vice versa).
 */
class KillStatsCache
{
    private const VERSION_KEY = 'killstats:version';

    /** Backstop TTL — freshness normally comes from the ETL's bump(). */
    public const TTL = 900;

    public static function version(): int
    {
        return (int) Cache::get(self::VERSION_KEY, 1);
    }

    public static function key(string $name): string
    {
        return 'killstats:v'.self::version().':'.$name;
    }

    /** Invalidate every kill-stats cache by advancing the version stamp. */
    public static function bump(): void
    {
        if (! Cache::add(self::VERSION_KEY, 2)) {
            Cache::increment(self::VERSION_KEY);
        }
    }

    /**
     * Cache one endpoint payload. The value is normalised to plain
     * arrays/scalars (via a JSON round-trip, identical to what the HTTP
     * response serialises anyway) — the database cache driver can't restore
     * Collections reliably (`__PHP_Incomplete_Class`).
     *
     * @return array<string, mixed>
     */
    public static function remember(string $name, Closure $fn): array
    {
        return Cache::remember(
            self::key($name),
            self::TTL,
            fn () => json_decode(json_encode($fn()), true),
        );
    }
}
