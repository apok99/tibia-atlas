<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

/**
 * A single monotonically-increasing version stamp for all published-content
 * caches (glossary, facets, …). Embedding the version in each cache key means
 * an edit invalidates everything at once — just bump the counter — without
 * having to enumerate every locale/type permutation, which the database cache
 * driver can't tag.
 */
class ContentCache
{
    private const VERSION_KEY = 'content:version';

    /** Current content version (1 if never bumped). */
    public static function version(): int
    {
        return (int) Cache::get(self::VERSION_KEY, 1);
    }

    /**
     * Build a versioned cache key. Any content write bumps the version, so old
     * entries become unreachable and lapse by their own TTL.
     */
    public static function key(string $name): string
    {
        return 'content:v'.self::version().':'.$name;
    }

    /** Invalidate every content cache by advancing the version stamp. */
    public static function bump(): void
    {
        // `add` seeds the counter atomically the first time; afterwards
        // `increment` advances it. Avoids a get-then-set race.
        if (! Cache::add(self::VERSION_KEY, 2)) {
            Cache::increment(self::VERSION_KEY);
        }
    }
}
